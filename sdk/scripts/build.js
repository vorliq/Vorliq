const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");

fs.mkdirSync(dist, { recursive: true });
fs.copyFileSync(path.join(root, "src", "index.js"), path.join(dist, "vorliq-sdk.js"));
fs.copyFileSync(path.join(root, "src", "signer.js"), path.join(dist, "signer.js"));
fs.copyFileSync(path.join(root, "src", "address.js"), path.join(dist, "address.js"));

console.log("Built dist/vorliq-sdk.js");
