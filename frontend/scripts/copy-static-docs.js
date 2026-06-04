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
const rootPitchHtml = fs
  .readFileSync(path.join(docsSource, "pitch.html"), "utf8")
  .replace('href="style.css" data-docs-rebuilt-style', 'href="docs/style.css" data-docs-rebuilt-style');
fs.writeFileSync(path.join(publicRoot, "pitch.html"), rootPitchHtml);

fs.mkdirSync(sdkTarget, { recursive: true });
fs.copyFileSync(path.join(repoRoot, "sdk", "README.md"), path.join(sdkTarget, "README.md"));

console.log("Copied docs and SDK README into frontend public assets.");
