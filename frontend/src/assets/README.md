# Vorliq frontend brand assets

- **`logo.png`** — the rasterized Vorliq logo the app actually renders. It is
  imported by the top navigation (`src/components/ProductShell.js`).
- **`logo.svg`** — the **source-of-truth brand logo vector** (master art). It is
  intentionally kept even though it is **not** imported by the app bundle (the
  app ships `logo.png`). Do **not** delete it in a dependency/asset sweep just
  because it has no import: it is the vector original the PNG is derived from.
- **`inter-latin.woff2`** — the self-hosted Inter font, loaded via `@font-face`
  in `src/index.css`.
