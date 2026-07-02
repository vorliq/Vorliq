// Shared helpers for the local write-path journeys. API helpers drive the chain
// plumbing (wallet creation, mining, funding) so the specs can focus on the
// user-facing UI journey; UI helpers reuse the app's real flows.
const crypto = require("crypto");
const { expect } = require("@playwright/test");

const NODE_PORT = process.env.E2E_NODE_PORT || "5000";
const FLASK_PORT = process.env.E2E_FLASK_PORT || "5001";
const AUTHORIZATION_DOMAIN = "vorliq.authority.v1";
const API = `http://127.0.0.1:${NODE_PORT}/api`;

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    method: options.method || "GET",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch (error) {
    json = { raw: text };
  }
  return { status: response.status, data: json };
}

async function createWallet() {
  let { status, data } = await api("/wallet/create", { method: "POST" });
  if (status >= 500) {
    // The single-process Flask node occasionally times out under the suite's
    // concurrent mining load; one retry after a beat covers that transient
    // without masking real failures (a second 5xx still fails the test).
    await new Promise((resolve) => setTimeout(resolve, 2000));
    ({ status, data } = await api("/wallet/create", { method: "POST" }));
  }
  expect(status, `wallet create should succeed (${status}: ${JSON.stringify(data)})`).toBeLessThan(300);
  return data; // { address, public_key, private_key }
}

async function getBalance(address) {
  const { data } = await api(`/wallet/balance?address=${encodeURIComponent(address)}`);
  return Number(data.balance) || 0;
}

// Mine a single block, retrying with an alternate miner if the fair-mining rule
// (no two consecutive blocks from the same address) rejects it.
async function mineBlock(primary, alternate) {
  let res = await api("/mine", { method: "POST", body: { miner_address: primary } });
  if (res.status >= 300 && alternate) {
    res = await api("/mine", { method: "POST", body: { miner_address: alternate } });
  }
  return res;
}

// Two long-lived miner wallets, created once and reused across all helpers so the
// suite does not churn through the wallet-create budget.
let minerPair = null;
async function miners() {
  if (!minerPair) {
    minerPair = { a: await createWallet(), b: await createWallet() };
  }
  return minerPair;
}

// Fund the community treasury (via mining rewards) until the faucet will pay out.
async function ensureTreasuryFunded(minConfirmed = 25) {
  const { a, b } = await miners();
  for (let i = 0; i < 40; i += 1) {
    const summary = await api("/faucet/summary");
    const treasury = Number(summary.data?.summary?.treasury_balance) || 0;
    if (treasury >= minConfirmed) return treasury;
    await mineBlock(i % 2 === 0 ? a.address : b.address, i % 2 === 0 ? b.address : a.address);
  }
  return Number((await api("/faucet/summary")).data?.summary?.treasury_balance) || 0;
}

// Give a wallet a spendable balance by mining blocks crediting it directly
// (no faucet, so the per-fingerprint faucet limit is never consumed).
async function fundWalletByMining(address, blocks = 2) {
  const { a } = await miners();
  for (let i = 0; i < blocks; i += 1) {
    await mineBlock(address, a.address);
    await mineBlock(a.address, address); // alternate so `address` can mine again
  }
  return getBalance(address);
}

// Mine a handful of blocks (alternating miners) to confirm whatever is pending.
async function mineSome(count = 3) {
  const { a, b } = await miners();
  for (let i = 0; i < count; i += 1) {
    await mineBlock(i % 2 === 0 ? a.address : b.address, i % 2 === 0 ? b.address : a.address);
  }
}

// Give a wallet a SPENDABLE balance via the faucet (a treasury transfer, which
// is spendable once confirmed, unlike immature mining rewards) and mine it in. A
// unique User-Agent per claim keeps the faucet's per-fingerprint limit clear.
async function fundWalletSpendable(address) {
  const claim = await api("/faucet/claim", {
    method: "POST",
    body: { wallet_address: address },
    headers: { "User-Agent": `VorliqE2E-faucet-${Math.random().toString(36).slice(2)}` },
  });
  const txId = claim.data?.claim?.tx_id;
  if (txId) await confirmTransaction(txId, address);
  return getBalance(address);
}

// Mine until a given transaction id is confirmed in a block, returning its block.
async function confirmTransaction(txId, fromAddress) {
  const { a, b } = await miners();
  for (let i = 0; i < 12; i += 1) {
    await mineBlock(i % 2 === 0 ? a.address : b.address, i % 2 === 0 ? b.address : a.address);
    const { data } = await api(`/transactions/${encodeURIComponent(txId)}`);
    const tx = data.transaction || data;
    if (tx && (tx.block_index != null || tx.block_hash || tx.status === "confirmed")) return tx;
  }
  return null;
}

// --- Signed-authority request signing (mirrors backend/middleware/signedAuthorization) ---
function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`)
      .join(",")}}`;
  }
  throw new Error("unsupported value in canonicalJson");
}

function sha256Hex(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

// Build a signed-authority body and POST it (used to author a forum post for a
// wallet directly, so the avatar journey has a post to open).
async function postSigned(path, action, actorField, wallet, body) {
  const payload = { ...body, [actorField]: wallet.address };
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = `e2e-${crypto.randomUUID()}`;
  const bodyHash = sha256Hex(canonicalJson(payload));
  const message = canonicalJson({ action, body_hash: bodyHash, domain: AUTHORIZATION_DOMAIN, nonce, timestamp, wallet: wallet.address });
  const signature = crypto.sign("sha256", Buffer.from(message, "utf8"), wallet.private_key).toString("hex");
  return api(path, {
    method: "POST",
    body: {
      ...payload,
      authorization: { wallet: wallet.address, public_key: wallet.public_key, signature, message, timestamp, nonce, action, body_hash: bodyHash, domain: AUTHORIZATION_DOMAIN },
    },
  });
}

async function createForumPost(wallet, { title, body, category = "general" }) {
  const res = await postSigned("/forum/post", "forum.post", "author_address", wallet, { title, body, category });
  expect(res.status, `forum post should be created (got ${res.status}: ${JSON.stringify(res.data)})`).toBeLessThan(300);
  return res.data;
}

// Seed the community lending pool via the test-only Flask endpoint, then mine it
// in, so a test loan can be funded from a positive pool balance.
async function seedLendingPool(amount = 60) {
  const res = await fetch(`http://127.0.0.1:${FLASK_PORT}/test/seed-lending-pool`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount }),
  });
  expect(res.status, "lending pool seed endpoint should be enabled and succeed").toBeLessThan(300);
  await mineSome(1);
}

// Mine (alternating miners) until an address holds at least `minBalance`.
async function fundWalletToThreshold(address, minBalance) {
  const { a } = await miners();
  for (let i = 0; i < 12; i += 1) {
    if ((await getBalance(address)) >= minBalance) break;
    await mineBlock(address, a.address);
    await mineBlock(a.address, address);
  }
  return getBalance(address);
}

async function createLoanRequest(wallet, { amount, reason }) {
  const res = await postSigned("/lending/request", "lending.request", "requester_address", wallet, { amount, reason });
  expect(res.status, `loan request should be created (${res.status}: ${JSON.stringify(res.data)})`).toBeLessThan(300);
  return res.data.loan_id || res.data.loan?.loan_id;
}

async function voteOnLoan(wallet, loanId, vote) {
  const res = await postSigned("/lending/vote", "lending.vote", "voter_address", wallet, { loan_id: loanId, vote });
  expect(res.status, `loan vote should succeed (${res.status}: ${JSON.stringify(res.data)})`).toBeLessThan(300);
  return res.data;
}

async function repayLoan(wallet, loanId) {
  const res = await postSigned("/lending/repay", "lending.repay", "repayer_address", wallet, { loan_id: loanId });
  expect(res.status, `loan repayment should succeed (${res.status}: ${JSON.stringify(res.data)})`).toBeLessThan(300);
  return res.data;
}

async function createProposal(wallet, { title, description, category = "general", parameter = "documented-value" }) {
  const res = await postSigned("/governance/propose", "governance.propose", "proposer_address", wallet, {
    title,
    description,
    category,
    parameter,
  });
  expect(res.status, `proposal should be created (${res.status}: ${JSON.stringify(res.data)})`).toBeLessThan(300);
  return res.data.proposal_id || res.data.proposal?.proposal_id;
}

async function voteOnProposal(wallet, proposalId, vote) {
  const res = await postSigned("/governance/vote", "governance.vote", "voter_address", wallet, { proposal_id: proposalId, vote });
  expect(res.status, `proposal vote should succeed (${res.status}: ${JSON.stringify(res.data)})`).toBeLessThan(300);
  return res.data;
}

// Apply the same onboarding-complete + motion-disable init as the page fixture,
// for pages created in a second browser context (e.g. a recipient watching the
// notification bell). Must be called before the first navigation.
async function prepPage(page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("vorliq_onboarding_complete", "true");
    } catch (error) {
      /* ignore */
    }
    const install = () => {
      const style = document.createElement("style");
      style.textContent =
        "*,*::before,*::after{animation-duration:1ms!important;animation-delay:0ms!important;" +
        "animation-iteration-count:1!important;transition-duration:1ms!important;" +
        "transition-delay:0ms!important;scroll-behavior:auto!important}";
      (document.head || document.documentElement).appendChild(style);
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", install, { once: true });
    } else {
      install();
    }
  });
}

// Log a known wallet into the browser using the REAL private-key import UI we
// ship, so signed actions (avatar, votes, loans) work with `password` afterwards.
async function importWalletViaUI(page, privateKeyPem, password) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: /private key/i }).click();
  await page.getByPlaceholder(/BEGIN PRIVATE KEY/i).fill(privateKeyPem);
  await page.getByLabel(/New Browser Password/i).fill(password);
  await page.getByLabel(/Confirm Browser Password/i).fill(password);
  await page.getByLabel(/responsible for keeping/i).check();
  await page.getByRole("button", { name: /import private key and sign in/i }).click();
  // A wallet with no chain record shows a confirm step; proceed through it.
  const proceed = page.getByRole("button", { name: /sign in anyway/i });
  try {
    await proceed.waitFor({ state: "visible", timeout: 4000 });
    await proceed.click();
  } catch (error) {
    /* had a chain record; no confirm step */
  }
  await page.waitForURL(/\/(account|dashboard)/, { timeout: 20_000 });
}

// Fail with a clear message naming the page and viewport if the layout overflows
// horizontally (the classic responsive break). Runs on every journey step.
async function assertNoHorizontalOverflow(page, pageName) {
  const width = page.viewportSize()?.width;
  const overflow = await page.evaluate(() => {
    const el = document.documentElement;
    return el.scrollWidth - el.clientWidth;
  });
  expect(
    overflow,
    `Horizontal overflow on "${pageName}" at ${width}px viewport: page is ${overflow}px wider than the screen (layout break).`
  ).toBeLessThanOrEqual(2);
}

module.exports = {
  api,
  assertNoHorizontalOverflow,
  createWallet,
  createForumPost,
  createLoanRequest,
  createProposal,
  fundWalletSpendable,
  fundWalletToThreshold,
  mineSome,
  prepPage,
  repayLoan,
  seedLendingPool,
  voteOnLoan,
  voteOnProposal,
  getBalance,
  mineBlock,
  ensureTreasuryFunded,
  fundWalletByMining,
  confirmTransaction,
  importWalletViaUI,
};
