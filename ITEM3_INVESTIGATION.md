# Item 3 Investigation — Node Restart-Recovery Performance

Investigation: 2026-06-30 (read-only). Updated 2026-07-01 with the firmed-up runway,
two factual corrections found while reading the code (the auto-prune is already
count-based, not disk-based; the snapshot archive is balance-only, not per-block), and
the A.3 verification results. As of 2026-07-01 the safe read-path clarity fixes and
tests are implemented; enabling the prune in production (irreversible) is held pending
sign-off on K. This document answers the four scoping questions; see INCIDENT_267.md for
the incident that surfaced this.

## Runway (firmed up 2026-07-01)

**Bottom line: roughly two to four weeks of runway before even the *widened*
240s deploy gate is at risk; the original 30s gate is already long exceeded,
which is why #267 happened. The fix (count-based pruning) is already built and
just needs enabling with the right K.**

**Data and its limits (honest about what is and isn't measurable).** The one hard
datapoint is from the incident: at chain height ~8000 the node takes roughly
**77 seconds** from restart to serving `/diagnostics` with a valid chain, because
it fully re-validates the chain on startup before serving anything (Q1c). Current
height is **8036** (`/diagnostics`, 2026-07-01). A genesis-anchored average block
rate is **not obtainable** from here: the per-block read endpoints proxy through
the backend and currently return `UPSTREAM_ERROR`, there is no local SSH key to
the droplet, and the signed snapshot archive stores balances/supply, not the
genesis block. `/diagnostics` is additionally cached and showed the tip frozen at
height 8036 for 20+ minutes during these checks, so a clean live-rate sample was
also unavailable. So the numbers below are anchored on the 77s@8000 datapoint and
`block_time_target = 60s` (the fastest sustainable single-miner cadence,
≈1,440 blocks/day), not on a genesis rate.

**Per-block validation cost:** 77s / 8000 ≈ **0.0096 s/block**, treating
restart-to-serve as ~proportional to block count (validation re-hashes every
block and re-verifies every transaction). This is a first-order model and is more
likely a *floor* than a ceiling: if transaction count per block grows, validation
becomes super-linear.

**Gate-crossing projections (linear model):**

- 240s widened gate ≈ 240 / 0.0096 ≈ **25,000 blocks** → ~16,960 blocks from now.
  - At the fastest cadence (1,440 blocks/day): ≈ **12 days** (worst-case-fast floor).
  - At observed mixed/idle cadence (~600–1,000 blocks/day): ≈ **17–28 days**.
- 30s original gate ≈ 3,125 blocks → **already exceeded** (root cause of #267).

**Implication for K:** target validation well under 60s (so the smoke tests' 8s
per-call timeouts are only ever hit in steady state, never during validation).
60s / 0.0096 ≈ 6,250 blocks is the upper bound; with margin for super-linearity,
**K = 5,000** (~48s estimated, ≈ 3.5–5 days of hot history at current cadence).
No lower bound forces K higher: balances, supply, treasury, economics and
leaderboard all seed from the prune commitment (verified post-prune), so only the
per-block explorer/audit reads want more history, and the accepted product
decision is that those pre-prune reads are unavailable (now a clear 410, see Q3).
**Caveat for the K decision:** enabling K = 5,000 at the current height of 8,036
immediately and irreversibly prunes blocks 0–~3,035 from this node's queryable
history. If retaining more browsable history matters more than the <60s target
(the 240s gate tolerates ~200s of validation), a larger K is viable; that is a
product call.

## Q1 — What exactly is slow, and why

**Q1c (most important): startup validation is BLOCKING.** In `blockchain/app.py`,
`saved_blockchain = storage.load_chain()` (line 271) then `_assert_startup_chain_valid()`
(line 303) runs **at import, before `app.run()`** (line 3858). It calls
`is_chain_valid(enforce_block_spacing=False)` over the entire chain and
`raise SystemExit` if it fails. The Flask app does not begin serving any request
until this O(n) pass completes. This is the ~77s window: the node answers nothing
(so `/diagnostics` returns empty, and every heavier endpoint with it) until full
validation finishes. `is_chain_valid` re-hashes every block, re-checks proof of
work and links, and runs `_chain_transactions_are_valid` over the whole ledger
(signature + balance checks), which is likely the dominant cost.

**Q1a — `/api/snapshot/verify` is a full-chain operation.** This is a backend
(Node, :5000) route the heartbeat calls; it produces/verifies a signed snapshot,
which scans the whole chain (O(n) hashing + signature work). heartbeat.js wraps it
in try/catch and logs "Snapshot check skipped before heartbeat" on its 8s timeout,
so the snapshot check itself is **non-fatal**. Its real harm is indirect: it is
CPU-heavy and, run concurrently with the registry calls, can starve the node's
handling of those calls during the recovery window.

**Q1b — the registry register/heartbeat is LIGHT; its failures are symptoms.**
`/registry/heartbeat` (app.py:2755) only reads the registry, calls
`get_block_height()` (O(1)), updates and saves the registry. It does not scan the
chain. So the deploy's `Heartbeat failed: Blockchain service is currently
unavailable` and `Registry registration failed: connect ECONNREFUSED
127.0.0.1:5000` are downstream effects of (1) the node still being in/near its
blocking startup window, (2) the concurrent full-chain snapshot work starving the
node, and (3) a transient backend not-yet-up. This distinction matters: the fix is
**not** to speed up the registry endpoint (already O(1)); it is to remove the
full-chain startup/snapshot cost from the critical window.

## Q2 — Trusted-state (fast-load) option

The node would skip full re-validation on restart when resuming from a known-recent
valid state.

- **What could constitute "trusted recent state":** the node already validates the
  full chain successfully on a clean shutdown/restart. A trusted-load could write a
  signed "last-validated-tip" marker (height + block hash + a hash/HMAC over the
  chain file, keyed by a node-held secret) after each successful full validation,
  and on the next start validate only that the on-disk chain still matches the
  marker (cheap) plus re-validate from the marked height forward.
- **Security tradeoff:** this **reduces** the startup integrity check. An attacker
  who can write to the droplet's filesystem could, if they also obtained the
  marker-signing secret, present a tampered chain that passes the cheap check. The
  current behaviour (full re-validation every start) catches on-disk tampering
  unconditionally. So trusted-load trades a real (if narrow) safety property for
  startup speed. It is consensus-adjacent and should not be implemented without an
  explicit decision and a concrete safeguard (e.g. always full-validate if the
  marker is missing/mismatched; keep the marker secret in `/etc/vorliq` with 600
  perms; still verify the tip's proof of work and the prune commitment cheaply).
- **How often restarts actually happen:** essentially only on deploys (and rare
  crashes/reboots). So trusted-load would be used mainly to make deploys clean —
  its security characteristics matter at exactly the moment (a compromised box)
  where you least want a weakened check.
- **Existing mechanism to extend:** `chain_valid_fast()` already memoises validity
  by tip, and `is_chain_valid(enforce_block_spacing=False)` already separates
  structural integrity from admission policy. A trusted-load would build on these,
  not start from scratch.

## Q3 — Pruning compatibility inventory

**Pruning already exists and is consensus-safe.** `blockchain.py` maintains a
`prune_point` commitment (height, block hash, `total_issued`, `balances`, plus a
snapshot hash and back-link). `is_chain_valid` verifies the prune commitment
first, then the retained blocks normally, with balances **seeded from the prune
snapshot** (lines 190, 1067, 1148-1186). **Correction to the first draft (verified
2026-07-01):** the auto-prune is **already count-based, not disk-based**.
`app._auto_prune_if_enabled()` fires when `len(chain) >= KEEP_BLOCKS + BATCH` and
calls `_prune_chain_to(KEEP_BLOCKS)` after every mined block. It does not fire today
only because it is **disabled by default** (`VORLIQ_CHAIN_PRUNE_ENABLED=false`) and
`VORLIQ_CHAIN_PRUNE_KEEP_BLOCKS` defaults to **10,000** (above the current height, so
even if enabled it would not yet trigger). There is no disk-size trigger; that was an
error in the first draft. The real constraint is validation **time**, which scales
with **retained block count**. So the remaining work is not to *write* a count-based
trigger but to **choose K and enable it** (plus make the read paths honest about the
prune boundary — done, see below).

**Consumers of historical (pre-tip) chain data — what a prune would affect:**
~43 direct `self.chain` iterations in `blockchain/*.py`, and these endpoints scan
or read old blocks:
- `/chain/blocks`, `/chain/block/<index_or_hash>` — block explorer; would 404 on
  pruned blocks.
- `/audit/chain`, `/audit/treasury`, `/audit/governance`, `/audit/lending`,
  `/audit/exchange`, `/audit/registry` — audit exports over history.
- `/treasury/transparency` — full treasury inflow/outflow history.
- `/economics`, `/economics/overview`, `/leaderboard` — derived from chain scans.

What survives a prune: **balances**, **total supply**, treasury balance, and the
chain's **validity**, all seeded from the prune-point commitment and cryptographically
anchored. What is **permanently lost** from this node: the **individual pre-prune
blocks and their transactions**. **Correction to the first draft:** the signed
snapshot archive (`backend/snapshotArchive.js`) stores a *balance/supply* snapshot plus
a signature — it does **not** store the dropped blocks. So pruned blocks cannot be
"served from the archive"; there is no per-block cold store to read them back from.
A request for a pruned block now returns a clear **HTTP 410** with the prune-point
context (verified in the A.3 harness), not a generic 404 and not a 500.

- **No cold-storage block query layer exists.** Building one (keep last K hot, serve
  older blocks from a compressed/indexed archive on demand) would preserve full
  explorer/audit access, but it is a separate, larger piece of work than enabling the
  rolling prune. It is *not* what "enable pruning" does today.
- **Viable K:** no finite K serves "every historical block query from the hot chain" —
  the explorer/audit features inherently want full history. So enabling the prune is a
  product decision: **accept that individual pre-prune blocks/transactions become
  unretrievable** (balances/supply preserved and provable; per-block reads return 410),
  or first build the cold-storage query layer. Balances/governance/lending **current
  state** do not need history (they seed from the commitment), so the user-facing money
  features are unaffected; the affected surfaces are the **explorer/audit/transparency
  per-block** read paths.

## Recommendation (for sign-off — NOT implemented)

**Primary: pursue count/height-based pruning, building on the existing prune
mechanism, with a decision on historical-read access.** It directly bounds the
startup validation cost (the actual root cause), is already consensus-safe
(balances and validity preserved by the prune commitment), and needs no weakening
of the startup integrity check. The required decision is product, not consensus:
how much history to keep hot (K), and whether pre-prune explorer/audit reads are
served from the signed snapshot archive or via a new cold-storage query layer.

**Secondary / complementary: make startup validation non-blocking** so the node
serves recent state while validating in the background, OR move snapshot generation
off the heartbeat's critical path. These reduce the deploy-window symptoms without
changing what is validated. The non-blocking change is lower-risk than trusted-load
because it still fully validates — it just stops blocking serving on it. This pairs
well with pruning.

**Do not recommend trusted-load as the first move:** it trades a real on-disk
tamper-detection property for speed, at exactly the compromised-box moment it
matters, and pruning achieves the same startup-time goal without that tradeoff.

**Suggested order for a future, separately-approved iteration:** (1) confirm the
real block rate from the genesis timestamp to firm up the runway; (2) decide K and
the historical-read policy; (3) implement count-based pruning + (optionally)
non-blocking startup validation; (4) keep the 240s gate + warmup as the safety net.

No implementation has been done. Awaiting sign-off on the approach before any code.
