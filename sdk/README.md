# Vorliq SDK

The Vorliq SDK is the official JavaScript library for building applications on the Vorliq blockchain network. It gives developers a small, practical client for creating wallets, checking VLQ balances, signing transactions locally with SECP256K1, mining blocks, reading lending and exchange data, watching for new blocks, and creating payment URLs that can be turned into QR codes.

## Responsible Use

Vorliq is experimental open-source community blockchain software. VLQ has no guaranteed market value and should not be represented as a guaranteed-value asset, investment product, bank deposit, or promised source of income. Applications built with this SDK should clearly disclose the experimental status of the network, the self-custody model, and the fact that users are responsible for their own keys, actions, local laws, and risk decisions.

Developers should not collect or store users private keys unless they fully understand custody risk and have a strong security model. In most cases, applications should sign locally on the user's device, avoid logging private keys, avoid sending keys to servers, and give users plain warnings before they create transactions, exchange offers, lending requests, mining actions, governance votes, or treasury votes.

Install the SDK from the `sdk` folder in this repository while it is being developed locally. From the project root, run `cd sdk`, then run `npm install`, and then run `npm run build`. Applications can import the built SDK from `dist/vorliq-sdk.js`. The default node is `https://vorliq.org`, but you can pass any compatible Vorliq node URL when you create the client.

```js
const { VorliqSDK } = require("./dist/vorliq-sdk");

const vorliq = new VorliqSDK({ nodeUrl: "https://vorliq.org" });
```

Production applications should prefer the lightweight and paginated methods when they do not need the entire blockchain. The `getChain` method remains available for compatibility and local tooling, but it downloads the full chain and can become expensive as the network grows. For dashboards, explorers, and account history, use `getChainSummary`, `getBlocks`, `getTransactions`, `getPendingTransactions`, `getTransaction`, `getBlock`, `getAddressHistory`, and `getLeaderboard`.

```js
const { VorliqSDK } = require("./dist/vorliq-sdk");

async function main() {
  const vorliq = new VorliqSDK({ nodeUrl: "https://vorliq.org" });
  const summary = await vorliq.getChainSummary();
  const firstPage = await vorliq.getBlocks(25, 0);
  const walletHistory = await vorliq.getAddressHistory("VLQ_ADDRESS_HERE", { limit: 25 });
  const pending = await vorliq.getPendingTransactions({ limit: 10 });
  const leaderboard = await vorliq.getLeaderboard(10, 0);

  console.log("Height:", summary.block_height);
  console.log("Newest blocks:", firstPage.blocks.length);
  console.log("Wallet transactions:", walletHistory.transactions.length);
  console.log("Pending transactions:", pending.transactions.length);
  console.log("Top holders:", leaderboard.holders);
}

main().catch(console.error);
```

The transaction lifecycle APIs distinguish pending transactions from confirmed transactions. A send result should be treated as pending until a block includes it.

```js
const { VorliqSDK } = require("./dist/vorliq-sdk");

async function main() {
  const vorliq = new VorliqSDK({ nodeUrl: "https://vorliq.org" });
  const transactions = await vorliq.getTransactions({ status: "all", limit: 20 });
  const pending = await vorliq.getPendingTransactions({ limit: 10 });

  if (transactions.transactions[0]) {
    const tx = await vorliq.getTransaction(transactions.transactions[0].tx_id);
    console.log("Transaction status:", tx.status);
  }

  const genesis = await vorliq.getBlock(0);
  console.log("Genesis hash:", genesis.hash);
  console.log("Pending count:", pending.transactions.length);
}

main().catch(console.error);
```

Developers can also verify the live network metadata before showing production status, connecting to a public node, or displaying trust information. The manifest is safe public data and includes the project URLs, deployed commit hash, chain summary, diagnostics, SDK version, incident activity, and generation time.

```js
const { VorliqSDK } = require("./dist/vorliq-sdk");

async function main() {
  const vorliq = new VorliqSDK({ nodeUrl: "https://vorliq.org" });
  const manifest = await vorliq.getNetworkManifest();

  console.log("Project:", manifest.project.name);
  console.log("Website:", manifest.urls.website);
  console.log("Current commit:", manifest.deployment.commit_hash);
  console.log("Chain height:", manifest.chain_summary.block_height);
  console.log("Active incidents:", manifest.incidents.active);
}

main().catch(console.error);
```

Public member profiles are linked to wallet addresses. They are not verified legal identities, and applications should treat every profile field as public community content. Do not store private keys, wallet passwords, recovery phrases, or secrets in profile fields.

```js
const { VorliqSDK } = require("./dist/vorliq-sdk");

async function main() {
  const vorliq = new VorliqSDK({ nodeUrl: "https://vorliq.org" });
  const profile = await vorliq.saveProfile({
    wallet_address: "VLQ_ADDRESS_HERE",
    display_name: "Community Miner",
    bio: "Running a Vorliq node and helping new members.",
    avatar_style: "cyan",
    website: "https://example.com"
  });
  const topProfiles = await vorliq.getTopProfiles(10);

  console.log("Saved profile:", profile.display_name);
  console.log("Top reputation:", topProfiles);
}

main().catch(console.error);
```

Community lending records now expose a lifecycle from `pending_vote` through issuance, active repayment tracking, and confirmed `repaid` status. Approval does not mean funds are confirmed; applications should link users to the issuance transaction and wait for mining confirmation before treating a loan as active.

```js
const { VorliqSDK } = require("./dist/vorliq-sdk");

async function main() {
  const vorliq = new VorliqSDK({ nodeUrl: "https://vorliq.org" });
  const summary = await vorliq.getLendingSummary();
  const activeLoans = await vorliq.getLoans({ status: "active", limit: 10 });

  if (activeLoans[0]) {
    const loan = await vorliq.getLoan(activeLoans[0].loan_id);
    const myLoans = await vorliq.getMyLoans(loan.requester_address);

    console.log("Lending summary:", summary);
    console.log("Loan status:", loan.status);
    console.log("Borrowed loans:", myLoans.borrowed.length);
  }
}

main().catch(console.error);
```

To get a wallet balance, create a client and pass the wallet address to `getBalance`. This complete example prints the balance as a number.

```js
const { VorliqSDK } = require("./dist/vorliq-sdk");

async function main() {
  const vorliq = new VorliqSDK({ nodeUrl: "https://vorliq.org" });
  const balance = await vorliq.getBalance("VLQ_ADDRESS_HERE");
  console.log(`Balance: ${balance} VLQ`);
}

main().catch(console.error);
```

To create a new wallet, call `createWallet`. The returned object contains the address, public key, and private key. Store the private key securely because Vorliq cannot recover it for you. Applications built with the SDK should not send private keys to their own servers, analytics tools, logs, or support systems. If an application stores a private key, it should encrypt it locally with a password chosen by the user.

```js
const { VorliqSDK } = require("./dist/vorliq-sdk");

async function main() {
  const vorliq = new VorliqSDK({ nodeUrl: "https://vorliq.org" });
  const wallet = await vorliq.createWallet();
  console.log("Address:", wallet.address);
  console.log("Public key:", wallet.public_key);
  console.log("Private key:", wallet.private_key);
}

main().catch(console.error);
```

To send VLQ, provide the sender address, sender private key, sender public key, recipient address, and amount. The SDK signs the transaction locally before it sends anything to the node, using the same signing payload as the Vorliq web app.

```js
const { VorliqSDK } = require("./dist/vorliq-sdk");

async function main() {
  const vorliq = new VorliqSDK({ nodeUrl: "https://vorliq.org" });
  const result = await vorliq.sendTransaction(
    "VLQ_SENDER_ADDRESS",
    "-----BEGIN EC PRIVATE KEY-----\nYOUR_PRIVATE_KEY\n-----END EC PRIVATE KEY-----",
    "-----BEGIN PUBLIC KEY-----\nYOUR_PUBLIC_KEY\n-----END PUBLIC KEY-----",
    "VLQ_RECEIVER_ADDRESS",
    5
  );
  console.log(result);
}

main().catch(console.error);
```

To subscribe to new blocks, pass a callback to `subscribeToBlocks`. The SDK polls the configured node every thirty seconds and calls your function whenever chain height increases. The returned function stops the subscription.

```js
const { VorliqSDK } = require("./dist/vorliq-sdk");

const vorliq = new VorliqSDK({ nodeUrl: "https://vorliq.org" });

const unsubscribe = vorliq.subscribeToBlocks((block) => {
  console.log(`New block #${block.index}: ${block.hash}`);
});

setTimeout(() => {
  unsubscribe();
  console.log("Stopped watching for blocks.");
}, 180000);
```

To create a payment QR code URL, call `createPaymentURL` with the recipient address and optional amount. The returned `vorliq://pay` URL can be encoded by any QR code library or displayed in your payment flow.

```js
const { VorliqSDK } = require("./dist/vorliq-sdk");

const vorliq = new VorliqSDK();
const paymentUrl = vorliq.createPaymentURL("VLQ_RECEIVER_ADDRESS", 12.5);

console.log(paymentUrl);
console.log(vorliq.parsePaymentURL(paymentUrl));
```
