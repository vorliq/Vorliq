# Vorliq SDK

The Vorliq SDK is the official JavaScript library for building applications on the Vorliq blockchain network. It gives developers a small, practical client for creating wallets, checking VLQ balances, signing transactions locally with SECP256K1, mining blocks, reading lending and exchange data, watching for new blocks, and creating payment URLs that can be turned into QR codes.

Install the SDK from the `sdk` folder in this repository while it is being developed locally. From the project root, run `cd sdk`, then run `npm install`, and then run `npm run build`. Applications can import the built SDK from `dist/vorliq-sdk.js`. The default node is `https://vorliq.org`, but you can pass any compatible Vorliq node URL when you create the client.

```js
const { VorliqSDK } = require("./dist/vorliq-sdk");

const vorliq = new VorliqSDK({ nodeUrl: "https://vorliq.org" });
```

Production applications should prefer the lightweight and paginated methods when they do not need the entire blockchain. The `getChain` method remains available for compatibility and local tooling, but it downloads the full chain and can become expensive as the network grows. For dashboards, explorers, and account history, use `getChainSummary`, `getBlocks`, `getAddressTransactions`, and `getLeaderboard`.

```js
const { VorliqSDK } = require("./dist/vorliq-sdk");

async function main() {
  const vorliq = new VorliqSDK({ nodeUrl: "https://vorliq.org" });
  const summary = await vorliq.getChainSummary();
  const firstPage = await vorliq.getBlocks(25, 0);
  const walletHistory = await vorliq.getAddressTransactions("VLQ_ADDRESS_HERE", 25, 0);
  const leaderboard = await vorliq.getLeaderboard(10, 0);

  console.log("Height:", summary.block_height);
  console.log("Newest blocks:", firstPage.blocks.length);
  console.log("Wallet transactions:", walletHistory.transactions.length);
  console.log("Top holders:", leaderboard.holders);
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
