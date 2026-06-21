// One-off brand asset generator (run with: node generate-brand-assets.js).
// Renders branded HTML with Chromium and screenshots it to produce pixel-exact
// PNGs in frontend/public: a 1200x630 Open Graph image and 192/512 PWA icons,
// all on the locked brand palette (dark #0A0E1A, teal #00A896).
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const PUBLIC_DIR = path.resolve(__dirname, "..", "frontend", "public");
// Inline the logo as a data URI: file:// images are blocked under setContent's
// about:blank origin, so a base64 data URI is the reliable way to embed it.
const LOGO_URL = `data:image/png;base64,${fs.readFileSync(path.join(PUBLIC_DIR, "logo.png")).toString("base64")}`;

const ogHtml = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0}
  .wrap{width:1200px;height:630px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:center;
    padding:90px;background:radial-gradient(circle at 82% 18%, rgba(0,168,150,0.22), transparent 55%), #0A0E1A;
    color:#E6F0FF;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}
  .brand{display:flex;align-items:center;gap:22px;margin-bottom:40px}
  .brand img{width:84px;height:84px;border-radius:18px}
  .brand .name{font-size:54px;font-weight:900;letter-spacing:-1px}
  h1{font-size:72px;line-height:1.05;margin:0 0 26px;font-weight:900}
  h1 .accent{color:#00A896}
  p{font-size:30px;line-height:1.4;margin:0;color:#A9BDD6;max-width:980px}
  .rule{height:8px;width:160px;background:#00A896;border-radius:5px;margin-top:46px}
</style></head><body>
  <div class="wrap">
    <div class="brand"><img src="${LOGO_URL}"/><span class="name">Vorliq</span></div>
    <h1>Your Community's Bank.<br/><span class="accent">Your Rules.</span></h1>
    <p>A community savings bank built on its own blockchain with the VLQ coin.</p>
    <div class="rule"></div>
  </div>
</body></html>`;

function iconHtml(size, pad) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
   html,body{margin:0;padding:0}
   .icon{width:${size}px;height:${size}px;box-sizing:border-box;display:flex;align-items:center;justify-content:center;
     background:#0A0E1A;padding:${pad}px}
   .icon img{width:100%;height:100%;object-fit:contain}
  </style></head><body><div class="icon"><img src="${LOGO_URL}"/></div></body></html>`;
}

(async () => {
  const browser = await chromium.launch();
  try {
    const ogPage = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
    await ogPage.setContent(ogHtml, { waitUntil: "networkidle" });
    await ogPage.screenshot({ path: path.join(PUBLIC_DIR, "og-image.png") });
    await ogPage.close();

    for (const [size, pad] of [[192, 22], [512, 60]]) {
      const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
      await page.setContent(iconHtml(size, pad), { waitUntil: "networkidle" });
      await page.screenshot({ path: path.join(PUBLIC_DIR, `icon-${size}.png`) });
      await page.close();
    }
    // eslint-disable-next-line no-console
    console.log("Generated og-image.png, icon-192.png, icon-512.png in frontend/public");
  } finally {
    await browser.close();
  }
})();
