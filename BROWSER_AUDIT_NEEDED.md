# Browser-Dependent Audit — Remaining Checklist

Status of the Ship-Phase frontend audit (Iteration 4). This file lists exactly
what has been verified and what still requires a **running full app stack** and,
for wallet flows, a **wallet extension with funds** — neither of which the
autonomous environment can fully provide. Nothing below should be treated as
"passing" until executed.

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

## Per-route checklist (NOT yet verified — needs the running stack)

Routes (from `frontend/src/App.js`): `/`, `/account`, `/achievements`, `/admin`,
`/admin/analytics`, `/ambassador`, `/audit`, `/blockchain`, `/bootstrap`, `/chat`,
`/community`, `/community-treasury`, `/dashboard`, `/economics`, `/exchange`,
`/faucet`, `/features`, `/forum`, `/governance`, `/growth`, `/health`,
`/leaderboard`, `/lending`, `/login`, `/migration-readiness`, `/mine`, `/network`,
`/network-health`, `/nodes/compare`, `/notifications`, `/peers/propagation`,
`/price`, `/privacy`, `/profile`, `/profile/:address`, `/profiles`, `/readiness`,
`/receive`, `/register`, `/registry`, `/releases`, `/roadmap`, `/send`,
`/settings`, `/snapshot`, `/snapshot-archive`, `/stats`, `/status`, `/terms`,
`/transparency`, `/treasury`, `/vlq`, `/wallet`, `/whitepaper`.

For **each** route:
- [ ] Loading state renders (not a blank page) — throttle/intercept to observe
- [ ] Error state renders human-readable copy (backend down) — no stack traces/URLs
- [ ] Empty state renders explanatory copy (fresh/empty account)
- [ ] Data state: numbers/dates/addresses formatted; long hashes truncate, don't overflow
- [ ] Tab order logical; focus visible at every stop
- [ ] No horizontal overflow at 320/375/768/1024/1440px
- [ ] Touch targets ≥ 44×44px at 320/375px
- [ ] No console errors / React key warnings / 404s

## Wallet flows (NOT verifiable here — needs a wallet extension + funds)

Requires a real browser with the Vorliq wallet flow exercised end to end, plus a
test wallet with VLQ. Each flow from the prior directive (Task 4.3):
- [ ] First-time wallet connection (connect, address shown, persistence)
- [ ] Wrong-network detection + switch
- [ ] Send transaction (validation, pending, submitted, confirmed, balance update)
- [ ] Reject transaction (returns to form, values preserved, retry)
- [ ] Disconnect (state cleared, persists across reload)

## What would unblock the rest

Either (1) run this checklist against a **locally running full stack**
(blockchain + backend + `npm start` frontend) with a seeded test account and a
browser driving it via the now-installed Playwright, **or** (2) run it against
the **deployed staging URL** from a machine with the Vorliq wallet flow and
testnet/local funds available. The wallet-flow items specifically need funds and
the wallet UI; a headless browser alone does not satisfy them.
