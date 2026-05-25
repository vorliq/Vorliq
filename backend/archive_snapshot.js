#!/usr/bin/env node

const { createSnapshotArchive, verifyArchiveItem } = require("./snapshotArchive");

async function main() {
  const item = await createSnapshotArchive();
  const verification = verifyArchiveItem(item);
  if (!verification.verified) {
    console.error("Vorliq snapshot archive generation failed verification");
    verification.errors.forEach((error) => console.error(`- ${error}`));
    process.exit(1);
  }
  console.log("Vorliq snapshot archived");
  console.log(`Snapshot hash: ${item.snapshot_hash}`);
  console.log(`Chain height: ${item.chain_height}`);
  console.log(`Latest block hash: ${item.latest_block_hash}`);
  console.log(`Signature status: ${verification.signature_status}`);
  console.log(`Public key id: ${verification.public_key_id || "unavailable"}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Vorliq snapshot archive generation failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
};
