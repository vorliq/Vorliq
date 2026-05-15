# Vorliq SDK

The Vorliq SDK is the official JavaScript library for building applications on the Vorliq blockchain network. It gives developers a small, practical client for creating wallets, checking VLQ balances, signing transactions locally with SECP256K1, mining blocks, reading lending and exchange data, watching for new blocks, and creating payment URLs that can be turned into QR codes.

Install the SDK from the `sdk` folder in this repository while it is being developed locally. From the project root, run `cd sdk`, then run `npm install`, and then run `npm run build`. Applications can import the built SDK from `dist/vorliq-sdk.js`. The default node is `https://vorliq.org`, but you can pass any compatible Vorliq node URL when you create the client.

```js
const { VorliqSDK } = require("./dist/vorliq-sdk");

const vorliq = new VorliqSDK({ nodeUrl: "https://vorliq.org" });
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

To create a new wallet, call `createWallet`. The returned object contains the address, public key, and private key. Store the private key securely because Vorliq cannot recover it for you.

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
