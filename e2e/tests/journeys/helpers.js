// Shared helpers for the local write-path journeys. API helpers drive the chain
// plumbing (wallet creation, mining, funding) so the specs can focus on the
// user-facing UI journey; UI helpers reuse the app's real flows.
const crypto = require("crypto");
const { expect } = require("@playwright/test");

const NODE_PORT = process.env.E2E_NODE_PORT || "5000";
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
  const { status, data } = await api("/wallet/create", { method: "POST" });
  expect(status, "wallet create should succeed").toBeLessThan(300);
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
  fundWalletSpendable,
  mineSome,
  getBalance,
  mineBlock,
  ensureTreasuryFunded,
  fundWalletByMining,
  confirmTransaction,
  importWalletViaUI,
};
