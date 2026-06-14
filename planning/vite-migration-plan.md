# Vite Migration Plan (proposal — not executed)

Status: proposal for a future dedicated phase. No code has been migrated. The
current app is Create React App (`react-scripts` 5.0.1). The security pressure
that originally motivated this is resolved (see the npm `overrides` in
`frontend/package.json`; `npm audit` is at 0 high / 0 critical), so this is a
maintainability / build-speed / performance-tooling move, not urgent.

## Why migrate (later)

- `react-scripts` / CRA is effectively unmaintained; the residual `npm audit`
  moderates are all CRA-major dev tooling that only a framework change clears.
- Vite gives much faster dev start/HMR, a smaller and more controllable build,
  native code-splitting, and first-class control over `<head>` (which unlocks
  the font-preload LCP win noted in the performance audit that CRA makes awkward).
- It removes the hashed-asset-in-index.html limitation that currently blocks a
  clean `<link rel="preload">` for the self-hosted Inter font.

## Scope / target

- React 19 + React Router 7 (no version changes required; both fully support Vite).
- Build tool: `vite` + `@vitejs/plugin-react`.
- Keep the existing Tailwind (v3) + hand-written `index.css` design system as-is.
- Output a static `build/` (or `dist/`) that nginx serves exactly as today.

## Risk areas and how each maps over

### 1. Theme-before-paint inline script (highest-value, must not regress)
`public/index.html` sets `data-theme` from `localStorage` *before paint* to avoid
a flash. Vite uses `index.html` at the project root as the entry and preserves
inline `<script>` in `<head>`.
- Action: move `index.html` to the project root, keep the inline theme script
  verbatim in `<head>`, before the module script.
- Validate: load with `localStorage.vorliq_theme=light` and confirm no
  dark→light flash (the existing `accessibility.spec.js` token check + a manual
  first-paint check).

### 2. Route-based code-splitting / lazy imports
The app already uses `React.lazy` + `Suspense` for ~43 routes. These are
bundler-agnostic and work unchanged under Vite (Rollup handles the dynamic
`import()` splits, generally producing *better* chunking than CRA/webpack).
- Action: none structural; verify chunk output and that `Suspense` fallback
  (`<div className="page">`/`BrandLoader`) still renders.
- Risk: low. Watch for any eager/lazy boundary that relied on webpack chunk names.

### 3. Environment variables (`REACT_APP_*` -> `VITE_*` / `import.meta.env`)
CRA exposes `process.env.REACT_APP_*`; Vite exposes `import.meta.env.VITE_*`.
- Action: inventory all `process.env.REACT_APP_*` usages in `frontend/src` and
  rename to `VITE_*`, switching reads to `import.meta.env`. Update any `.env`
  files and the deploy/CI environment. (Current usage looks minimal — the API
  base is same-origin `/api` — so this is expected to be small, but it must be
  audited exhaustively before cutover.)
- Risk: medium if any env var is read at build time in a non-obvious spot.
  Mitigation: grep `process.env` across `src` and the build scripts; add a
  shim/compat note for anything that must stay.

### 4. Build output directory & nginx
nginx serves `/home/vorliq/app/frontend/build` (see
`deployment/vorliq_nginx_ssl.conf`). Vite defaults to `dist/`.
- Action: set Vite `build.outDir = 'build'` (and `base: '/'`) so the output path
  and `/static/`-style references match, OR update the nginx `root` and the
  `location /static/` block to Vite's `assets` directory. Prefer keeping
  `build/` to avoid touching nginx.
- Also: the `prebuild` step (`scripts/copy-static-docs.js`) that copies `/docs`
  into the build must run as a Vite `buildStart`/pre-build step or stay as an
  npm `prebuild` script.
- Risk: medium — asset path/`base` mismatches are the classic Vite-migration
  breakage. Validate by diffing the served asset URLs before/after.

### 5. PWA / manifest / service worker
`public/manifest.json` exists; **no service worker is registered** (confirmed in
the security phase — CRA's workbox output was inert). So there is no SW to port.
- Action: keep `manifest.json` in `public/` (Vite copies `public/` verbatim).
  Do not add a service worker unless explicitly wanted.
- Risk: low.

### 6. Jest -> Vitest (test runner)
CRA bundles Jest via `react-scripts test`. Vite pairs naturally with Vitest, but
Jest can also be kept standalone.
- Option A (lower churn): keep Jest, configure it independently (babel-jest +
  jsdom) so the 172 existing unit tests run unchanged.
- Option B (cleaner long-term): migrate to Vitest (`jsdom` env,
  `@testing-library/react`). Most tests port with minimal changes; watch for
  Jest-specific globals/mocks.
- Risk: medium. Recommend Option A for the cutover, Vitest as a follow-up.

### 7. Playwright E2E
E2E runs against a *served build* (`E2E_BASE_URL`), so it is build-tool-agnostic.
- Action: none, as long as the build output is served the same way. Re-run the
  full suite (route-smoke x2 viewports, accessibility, regression) against the
  Vite build.
- Risk: low.

### 8. Tailwind + PostCSS
Tailwind v3 works with Vite via `postcss.config.js` (already present for CRA).
- Action: ensure `postcss.config.js` / `tailwind.config.js` are picked up by
  Vite (they are, by default). Confirm `corePlugins.preflight:false` still holds.
- Risk: low.

## Suggested validation order (when picked up)

1. Stand up Vite alongside CRA on a branch; get `vite build` producing `build/`
   with `base:'/'` and the theme script intact. Diff asset URLs vs. CRA output.
2. `CI=true` build green; serve locally; manual first-paint theme check (no flash).
3. Run the 172 unit tests (Jest kept, or Vitest) green.
4. Run the full Playwright suite against the Vite build (route-smoke both
   viewports, accessibility both themes, regression sweep) green.
5. Env-var audit: grep `process.env`, confirm every read is migrated.
6. Lighthouse before/after on `/`, `/dashboard`, `/blockchain`, `/forum`;
   confirm no regression and capture the font-preload LCP improvement.
7. Confirm `prebuild` docs copy still runs and `/docs` is present in output.
8. Deploy to a staging path or low-traffic window; verify nginx serves assets,
   readiness pass, and the full pipeline (CI -> Deploy -> E2E) green before
   cutover.

## Opportunistic wins unlocked by the migration

- **Font preload for LCP:** with Vite controlling `<head>`, add
  `<link rel="preload" as="font" type="font/woff2" crossorigin>` for the
  self-hosted Inter woff2 (CRA's content-hashed filename makes this awkward
  today). The performance audit found LCP is text (`<h1>`/`.subtitle`) using
  Inter with `font-display: swap`, so earlier font fetch should tighten LCP.
- Smaller/cleaner vendor chunking and faster CI builds.

## Explicitly out of scope for the migration itself

- No backend/wallet/key/blockchain-core/admin-protection changes.
- No design-system or routing redesign — it is a build-tool swap, behavior-identical.
