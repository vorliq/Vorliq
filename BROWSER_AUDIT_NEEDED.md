# Browser-Dependent Audit — Remaining Checklist

Status of the Ship-Phase frontend audit (Iteration 4, updated 2026-07-02).
This file lists exactly what has been verified and how. All five wallet flows
are now resolved (verified or n/a); the remaining unchecked items are the
deeper per-route passes listed under "Follow-ups still NOT done". Nothing below
should be treated as "passing" until executed.

## Already verified (no browser, or partial real browser)

- **Static a11y/code checks (done):** no `<img>` without `alt`; `:focus { outline:none }`
  paired with a global `:focus-visible` ring + skip link (modern best practice);
  the 5 `div onClick` are all correctly-marked modal/drawer backdrops
  (`aria-hidden`/`role="presentation"`) with accessible dialogs.
- **Lazy loading (done):** `React.lazy` + `Suspense` for non-critical pages;
  initial JS bundle **192 kB gzipped** (< 300 kB target).
- **Images (done):** all in-app UI images < 50 kB; the only larger files are a
  gitignored docs logo and the OG meta image (not in the app render path).
- **Color contrast (done, offline, real math):** WCAG relative-luminance ratios
  computed against the theme tokens. All text-on-background pairings pass
  **except** the light-theme teal accent (#00a896 on white = 2.98:1) — **fixed**
  by darkening the light-theme `--accent-cyan/--accent-green/--primary` to
  `#00796b` (5.32:1). Dark theme unchanged (6.59:1).
- **Real browser, landing page only (done):** Chromium via Playwright confirmed
  **0px horizontal overflow** at 320/375/768/1024/1440px and a **visible keyboard
  focus** indicator on the first focus stop. The landing page is the only route
  that renders meaningfully without the backend.

## Tooling is ready

Playwright **and** its Chromium binary are installed (`e2e/` has `@playwright/test`;
the browser is cached under `~/AppData/Local/ms-playwright`). The remaining checks
below can be executed by a future session that brings up the full stack:

```
# Terminal 1: blockchain node    cd blockchain && VORLIQ_DATA_DIR=$PWD/data .venv/Scripts/python app.py
# Terminal 2: backend            cd backend && node index.js          (needs backend/.env)
# Terminal 3: frontend dev       cd frontend && npm start             (proxies API to backend)
# Then drive http://localhost:3000 with Playwright (chromium.launch()).
```

The viewport/focus audit logic used for the landing page (extend `ROUTES` to the
full list below): launch chromium → for each route, `page.goto`, set each viewport
width, compare `document.documentElement.scrollWidth` vs `window.innerWidth`
(>1px = overflow); press Tab and read `getComputedStyle(activeElement)` for a
visible outline/box-shadow.

## Per-route checklist — EXECUTED 2026-06-30 (Iteration 5)

Run against the full local stack (node:5001 + backend:5000 + served build) via
`e2e/browser-audit.js` and `e2e/browser-state-audit.js` (Playwright/Chromium).
52 routes audited.

- ✓ **No horizontal overflow at 320/375/768/1024/1440px** — 260/260 viewport
  checks pass across all 52 routes.
- ✓ **Keyboard focus visible** — 52/52 routes show a visible focus indicator on
  the first focus stops (the global `:focus-visible` ring). NOTE: the script
  samples the first 5 Tab stops per route, not the entire tab sequence; a full
  tab-order walk per route is still a deeper check (left as a follow-up below).
- ✓ **Error state degrades gracefully** — 8/8 representative data routes
  (blockchain, governance, treasury, leaderboard, economics, network-health,
  exchange, forum) with the API forced to 500: no blank page, no leaked
  internals (stack traces / URLs), no React render crash.
- ✓ **Empty state degrades gracefully** — same 8 routes with empty API payloads:
  no blank page, no crash; state-appropriate copy on most.
- ✓ **Touch targets (standalone) ≥ 44×44 at 320px** — the only genuinely
  undersized standalone targets (compact social icons, 40×40) were fixed to
  44×44 and re-verified. Remaining audit-flagged items are NOT defects:
  the visually-hidden skip link (1×1, keyboard-only) and inline text links are
  exempt under WCAG 2.5.8; CTA buttons/logo at 34–42px meet WCAG 2.1 **AA**
  (≥24×24 target-size minimum). They do not all meet the stricter 44×44
  AAA/mobile-HIG guideline — that is a design choice, recorded here, not a bug.

Follow-ups still NOT done (deeper than this pass):
- [ ] Full per-route tab-order walk (every stop, not just the first 5) + logical
      order vs visual layout
- [ ] Loading-state screenshots (spinner/aria-busy mid-fetch) per route — error
      and empty states were verified explicitly; loading was only observed
      implicitly (pages never went blank)
- [ ] Data-state formatting spot-check per route with seeded data
- [ ] Authenticated routes (dashboard/account/settings/send/wallet) in their
      signed-in data state — needs an in-app wallet (see wallet section)

## Wallet flows — EXECUTED 2026-06-30 (Iteration 5)

ARCHITECTURE FINDING: Vorliq's wallet is **browser-native** — keys are generated
and encrypted in the browser (elliptic), stored as `vorliq_wallet` in
localStorage. There is **no external wallet extension** (no MetaMask). So the
directive's MetaMask-shaped flows map to Vorliq as follows, verified via
`e2e/wallet-flow-audit.js` (Playwright, against the local stack):

- ✓ **Flow 1 — first-time wallet creation**: PASS. /register with password +
  consents creates the encrypted `vorliq_wallet`, redirects to /account, shows
  the authenticated dashboard.
- ✓ **Flow 5 — disconnect / sign out**: PASS. The "Sign Out" control returns to
  /login and shows the sign-in/unlock UI (encrypted backup may remain; the
  unlocked session is cleared).
- n/a **Flow 2 — wrong network**: Vorliq is a single chain. There is no
  multi-network concept; Settings exposes a per-device node URL, but no
  "wrong network" detection/switch exists by design. Not applicable.
- ✓ **Flow 3 — send transaction**: VERIFIED 2026-07-02 via
  `e2e/tests/journeys/04-send.spec.js` (`npm run e2e:local`, real Chromium at
  mobile/tablet/desktop against a self-booted isolated local stack). The stack
  mines to fund the treasury, the faucet funds a fresh wallet with spendable
  VLQ, and the journey verifies the full path: fill send form → local signing
  with the wallet password → broadcast (transaction hash shown) → mined →
  "confirmed in block" with a working block link → the recipient's notification
  bell updates in realtime over the socket → the wallet history "Sent" filter
  shows the outgoing row.
- ✓ **Flow 4 — reject transaction**: VERIFIED 2026-07-02 in the same journey.
  Vorliq signs in-browser (no external signer popup), so "rejecting in the
  wallet" is refusing to authorize the local signing: a wrong wallet password
  surfaces a visible error and the mempool is asserted to contain **nothing**
  from the sender — no broadcast without authorization.

## How Flows 3 & 4 were unblocked (2026-07-02)

The blocker was test funds plus harness-level rate limiting. The local e2e
stack (e2e/playwright.local.config.js) already mines with relaxed block spacing
to fund the treasury; what actually blocked the journeys was backend abuse
gating: the wallet-create velocity gate and the faucet per-IP distinct-wallet
gate did not honor the harness's `VORLIQ_DISABLE_RATE_LIMITS` flag (the express
rate limiters did), and the backend's abuse state persisted into
`backend/data`, so one tripped 24h block broke every later run. Both gates now
honor the flag (production behaviour unchanged — the flag is only set by the
harness) and the harness isolates `VORLIQ_BACKEND_DATA_DIR` per run.
