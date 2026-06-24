const axios = require("axios");

const { sendEmail } = require("./mailer");
const { logInfo, logError } = require("./logger");

// Weekly digest. Every Monday 08:00 UTC the Node service emails a 7-day summary
// to each member who opted into the digest (Settings → Email notifications) and
// has personal activity that week. A member with no activity gets no email. The
// content: current VLQ balance, VLQ received this week, governance proposals they
// voted on and the outcome, loans they're involved in and the status, and the
// three most active forum posts of the week. Delivery goes through the shared
// transactional mailer (logged instead of sent if no provider is configured).

const flaskUrl = process.env.FLASK_URL || "http://localhost:5001";
const WEEK_SECONDS = 7 * 24 * 60 * 60;

function adminToken() {
  return String(process.env.ADMIN_TOKEN || "").trim();
}

async function flaskGet(pathname, params) {
  const res = await axios.get(`${flaskUrl}${pathname}`, { params, timeout: 8000 });
  return res.data || {};
}

async function digestRecipients() {
  const token = adminToken();
  if (!token) {
    logError("[digest] ADMIN_TOKEN not set; cannot read digest recipients.");
    return [];
  }
  try {
    const res = await axios.get(`${flaskUrl}/notifications/digest-recipients`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 8000,
    });
    return Array.isArray(res.data?.recipients) ? res.data.recipients : [];
  } catch (error) {
    logError(`[digest] could not load recipients: ${error.message}`);
    return [];
  }
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function ts(item) {
  return num(item.block_timestamp ?? item.timestamp ?? item.created_at);
}

function concludedAt(proposal) {
  return Math.max(num(proposal.created_at), num(proposal.executed_at), num(proposal.cancelled_at), num(proposal.timestamp));
}

// The three most active forum posts of the week, ranked by votes + replies. Falls
// back to the most active overall if fewer than three posts saw activity.
async function topForumPosts(cutoff) {
  try {
    const data = await flaskGet("/forum/posts", { limit: 50, offset: 0 });
    const posts = Array.isArray(data.posts) ? data.posts : [];
    const scored = posts.map((post) => {
      const replies = Array.isArray(post.replies) ? post.replies : [];
      const replyCount = replies.length || num(post.reply_count);
      const activeThisWeek = ts(post) >= cutoff || replies.some((r) => num(r.timestamp) >= cutoff);
      return {
        title: post.title || "(untitled)",
        score: num(post.vote_count) + replyCount,
        activeThisWeek,
      };
    });
    const active = scored.filter((p) => p.activeThisWeek);
    const pool = active.length >= 3 ? active : scored;
    return pool.sort((a, b) => b.score - a.score).slice(0, 3);
  } catch (error) {
    logError(`[digest] top forum posts failed: ${error.message}`);
    return [];
  }
}

async function buildMemberDigest(wallet, nowSec, topPosts) {
  const cutoff = nowSec - WEEK_SECONDS;

  let balance = null;
  try {
    const b = await flaskGet("/balance", { address: wallet });
    balance = num(b.balance);
  } catch (error) {
    logError(`[digest] balance for ${wallet} failed: ${error.message}`);
  }

  let received = [];
  try {
    const addr = await flaskGet("/chain/address", { address: wallet });
    received = (Array.isArray(addr.confirmed_incoming) ? addr.confirmed_incoming : [])
      .filter((t) => num(t.block_timestamp ?? t.timestamp) >= cutoff)
      .map((t) => ({ amount: num(t.amount), category: t.category || "transfer" }));
  } catch (error) {
    logError(`[digest] received for ${wallet} failed: ${error.message}`);
  }

  let proposals = [];
  try {
    const gov = await flaskGet("/governance/my", { address: wallet });
    proposals = (Array.isArray(gov.voted) ? gov.voted : [])
      .filter((p) => concludedAt(p) >= cutoff)
      .map((p) => ({ title: p.title || "a proposal", status: String(p.status || "open").replace(/_/g, " ") }));
  } catch (error) {
    logError(`[digest] governance for ${wallet} failed: ${error.message}`);
  }

  let loans = [];
  try {
    const lend = await flaskGet("/lending/my", { address: wallet });
    const involved = [...(Array.isArray(lend.borrowed) ? lend.borrowed : []), ...(Array.isArray(lend.voted) ? lend.voted : [])];
    const ongoing = new Set(["active", "overdue", "repayment_pending", "approved", "pending_vote"]);
    loans = involved
      .filter((l) => ts(l) >= cutoff || ongoing.has(String(l.status || "")))
      .map((l) => ({ amount: num(l.amount), status: String(l.status || "pending").replace(/_/g, " ") }));
  } catch (error) {
    logError(`[digest] lending for ${wallet} failed: ${error.message}`);
  }

  const hasActivity = received.length > 0 || proposals.length > 0 || loans.length > 0;
  return { wallet, balance, received, proposals, loans, topPosts, hasActivity };
}

function formatVlq(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}

function renderDigest(digest) {
  const lines = [];
  lines.push("Your Vorliq week in review");
  lines.push("");
  if (digest.balance != null) lines.push(`Your VLQ balance: ${formatVlq(digest.balance)} VLQ`);

  const totalReceived = digest.received.reduce((sum, r) => sum + r.amount, 0);
  if (digest.received.length > 0) {
    lines.push("");
    lines.push(`VLQ received this week: ${formatVlq(totalReceived)} VLQ across ${digest.received.length} transaction(s).`);
  }
  if (digest.proposals.length > 0) {
    lines.push("");
    lines.push("Governance proposals you voted on:");
    digest.proposals.forEach((p) => lines.push(`  - "${p.title}" — ${p.status}`));
  }
  if (digest.loans.length > 0) {
    lines.push("");
    lines.push("Loans you're involved in:");
    digest.loans.forEach((l) => lines.push(`  - ${formatVlq(l.amount)} VLQ — ${l.status}`));
  }
  if (digest.topPosts.length > 0) {
    lines.push("");
    lines.push("Most active forum posts this week:");
    digest.topPosts.forEach((p) => lines.push(`  - "${p.title}" (${p.score} votes + replies)`));
  }
  lines.push("");
  lines.push("See more at https://vorliq.org — you can turn this digest off any time in Settings → Email notifications.");

  const text = lines.join("\n");
  const html = `<div style="font-family:system-ui,sans-serif;line-height:1.55">${lines
    .map((l) => (l ? `<p style="margin:6px 0">${l.replace(/^\s+/, (m) => "&nbsp;".repeat(m.length))}</p>` : "<br/>"))
    .join("")}</div>`;
  return { subject: "Your Vorliq week in review", text, html };
}

async function runWeeklyDigest(nowSec = Math.floor(Date.now() / 1000)) {
  const recipients = await digestRecipients();
  if (recipients.length === 0) {
    logInfo("[digest] no opted-in recipients; nothing to send.");
    return { recipients: 0, sent: 0, skippedNoActivity: 0 };
  }
  const cutoff = nowSec - WEEK_SECONDS;
  const topPosts = await topForumPosts(cutoff);

  let sent = 0;
  let skippedNoActivity = 0;
  for (const recipient of recipients) {
    try {
      const digest = await buildMemberDigest(recipient.wallet_address, nowSec, topPosts);
      if (!digest.hasActivity) {
        skippedNoActivity += 1;
        continue;
      }
      const { subject, text, html } = renderDigest(digest);
      await sendEmail({ to: recipient.email, subject, text, html });
      sent += 1;
    } catch (error) {
      logError(`[digest] failed for ${recipient.wallet_address}: ${error.message}`);
    }
  }
  logInfo(`[digest] weekly digest run complete: ${sent} sent, ${skippedNoActivity} skipped (no activity), ${recipients.length} opted in.`);
  return { recipients: recipients.length, sent, skippedNoActivity };
}

module.exports = { runWeeklyDigest, buildMemberDigest, renderDigest, topForumPosts, digestRecipients };
