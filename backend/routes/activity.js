const express = require("express");
const axios = require("axios");
const { sendCachedJson } = require("../cache");
const { handleRouteError } = require("./routeError");

const router = express.Router();
const flaskUrl = process.env.FLASK_URL || "http://localhost:5001";

// A transfer is "large" (and worth surfacing on the public feed) at or above
// this many VLQ. System/mining/treasury movements are excluded separately so
// the feed shows genuine member-to-member activity, not protocol payouts.
const LARGE_TX_VLQ = Number(process.env.ACTIVITY_LARGE_TX_VLQ || 10);
const SYSTEM_ADDRESSES = new Set(["SYSTEM", "VORLIQ_TREASURY"]);
const MAX_EVENTS = 24;

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// Build the public network activity timeline. Everything here is already
// visible in the block explorer — block headers, confirmed transfers, open
// governance proposals, and community loan requests — so no authentication is
// required and nothing private (balances, keys, drafts) is ever included.
function buildEvents(blocks, proposals, loans) {
  const events = [];

  for (const block of blocks) {
    const index = block.index;
    const reward = (block.mining_reward_transactions || []).reduce(
      (sum, tx) => sum + num(tx.amount),
      0
    );
    events.push({
      kind: "block",
      timestamp: num(block.timestamp),
      title: `Block #${index} mined`,
      miner: block.miner_address || null,
      amount: reward || null,
      link: `/block/${index}`,
    });

    for (const tx of block.transactions || []) {
      const category = tx.category || tx.type;
      const amount = num(tx.amount);
      const sender = tx.sender_address || tx.sender;
      const receiver = tx.receiver_address || tx.recipient;
      const isTransfer = category === "transfer" || category === undefined;
      if (
        isTransfer &&
        amount >= LARGE_TX_VLQ &&
        !SYSTEM_ADDRESSES.has(sender) &&
        !SYSTEM_ADDRESSES.has(receiver)
      ) {
        events.push({
          kind: "transaction",
          timestamp: num(tx.block_timestamp || tx.timestamp || block.timestamp),
          title: `${amount} VLQ transferred`,
          sender,
          receiver,
          amount,
          link: `/tx/${tx.tx_id}`,
        });
      }
    }
  }

  for (const proposal of proposals) {
    events.push({
      kind: "proposal",
      timestamp: num(proposal.created_at || proposal.timestamp),
      title: proposal.title ? `Proposal: ${proposal.title}` : "New governance proposal",
      proposer: proposal.proposer_address || null,
      link: "/governance",
    });
  }

  for (const loan of loans) {
    events.push({
      kind: "loan",
      timestamp: num(loan.created_at || loan.timestamp),
      title: `Loan requested: ${num(loan.amount)} VLQ`,
      requester: loan.requester_address || null,
      amount: num(loan.amount),
      link: "/lending",
    });
  }

  return events.sort((a, b) => b.timestamp - a.timestamp).slice(0, MAX_EVENTS);
}

router.get("/api/activity", async (req, res) => {
  try {
    // Short cache: the feed is refetched by every dashboard whenever a new block
    // arrives over the socket, so without this a burst of clients would fan out
    // three upstream calls each. Public data, so a few seconds stale is fine.
    return sendCachedJson(req, res, "network-activity", 4000, async () => {
      const [blocksRes, proposalsRes, loansRes] = await Promise.allSettled([
        axios.get(`${flaskUrl}/chain/blocks`, { params: { limit: 12, offset: 0 } }),
        axios.get(`${flaskUrl}/governance/proposals`, { params: { limit: 8, offset: 0 } }),
        axios.get(`${flaskUrl}/lending/loans`, { params: { limit: 8, offset: 0 } }),
      ]);

      const blocks = blocksRes.status === "fulfilled" ? blocksRes.value.data?.blocks || [] : [];
      const proposals =
        proposalsRes.status === "fulfilled" ? proposalsRes.value.data?.proposals || [] : [];
      const loansRaw = loansRes.status === "fulfilled" ? loansRes.value.data?.loans : null;
      const loans = Array.isArray(loansRaw)
        ? loansRaw
        : loansRaw && typeof loansRaw === "object"
          ? Object.values(loansRaw)
          : [];

      return { status: 200, data: { success: true, events: buildEvents(blocks, proposals, loans) } };
    });
  } catch (error) {
    return handleRouteError(res, error, "GET /api/activity", "Unable to load network activity.");
  }
});

module.exports = router;
