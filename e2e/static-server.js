// Minimal, dependency-free static server for the built React app, used by the
// local end-to-end suite. Serves files from frontend/build and falls back to
// index.html for client-side routes (SPA), so deep links like /dashboard work.
const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..", "frontend", "build");
const port = Number(process.env.E2E_STATIC_PORT || 3000);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

function send(res, status, body, type) {
  res.writeHead(status, { "Content-Type": type || "text/plain" });
  res.end(body);
}

const server = http.createServer((req, res) => {
  try {
    const urlPath = decodeURIComponent(req.url.split("?")[0]);
    let filePath = path.join(root, urlPath);
    // Prevent path traversal outside the build root.
    if (!filePath.startsWith(root)) return send(res, 403, "Forbidden");
    if (urlPath === "/" || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(root, "index.html"); // SPA fallback
    }
    const ext = path.extname(filePath).toLowerCase();
    const data = fs.readFileSync(filePath);
    send(res, 200, data, TYPES[ext] || "application/octet-stream");
  } catch (error) {
    send(res, 500, "Static server error");
  }
});

server.listen(port, "127.0.0.1", () => {
  // eslint-disable-next-line no-console
  console.log(`E2E static server serving ${root} on http://127.0.0.1:${port}`);
});
