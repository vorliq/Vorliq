const { VorliqSDK } = require("../dist/vorliq-sdk");

async function main() {
  const vorliq = new VorliqSDK({ nodeUrl: "https://vorliq.org" });

  const wallet = await vorliq.createWallet();
  console.log("Created wallet:", wallet.address);

  const balance = await vorliq.getBalance(wallet.address);
  console.log(`Balance: ${balance} VLQ`);

  const unsubscribe = vorliq.subscribeToBlocks((block) => {
    console.log(`New block mined: #${block.index} ${block.hash}`);
  });

  console.log("Subscribed to new blocks. Press Ctrl+C to stop.");
  process.on("SIGINT", () => {
    unsubscribe();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
