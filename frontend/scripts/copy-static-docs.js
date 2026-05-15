const fs = require("fs");
const path = require("path");

const frontendRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(frontendRoot, "..");
const publicRoot = path.join(frontendRoot, "public");

const docsSource = path.join(repoRoot, "docs");
const docsTarget = path.join(publicRoot, "docs");
const sdkTarget = path.join(publicRoot, "sdk");

fs.rmSync(docsTarget, { recursive: true, force: true });
fs.cpSync(docsSource, docsTarget, { recursive: true });
fs.copyFileSync(path.join(docsSource, "pitch.html"), path.join(publicRoot, "pitch.html"));

fs.mkdirSync(sdkTarget, { recursive: true });
fs.copyFileSync(path.join(repoRoot, "sdk", "README.md"), path.join(sdkTarget, "README.md"));

console.log("Copied docs and SDK README into frontend public assets.");
