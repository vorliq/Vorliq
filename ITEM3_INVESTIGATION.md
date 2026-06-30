# Item 3 Investigation — Node Restart-Recovery Performance

Read-only investigation, 2026-06-30. No code or config changed. No implementation.
This document answers the four scoping questions and recommends an approach for
sign-off. See INCIDENT_267.md for the incident that surfaced this.

## Runway (read this first)

One real data point: at chain height ~8000 the node takes roughly 77 seconds from
restart until it serves `/diagnostics` with a valid chain, because it fully
re-validates the chain on startup before it serves anything (see Q1c). The
deploy's chain gate and warmup ceiling are both ~240s, and the smoke tests' own
timeouts are 8s.

A precise runway needs two measurements not safely obtainable on live production:
(a) the genesis timestamp, for the real block-production rate, and (b) a
validation-time-vs-height curve. With what is available: block height is ~8033,
block_time_target is 60s, block_time_min 30s. Deploys began failing (30s startup
exceeded) around 2026-06-29 and last succeeded 2026-06-25, so the chain crosses
roughly one of these thresholds on the order of days-to-weeks, not months. The
240s ceilings buy time but are not a fix — they will be exceeded as the chain
grows, and the relationship may be worse than linear if transaction-count
dominates validation cost. **Treat this as weeks-to-a-few-months of runway, and
confirm with a genesis-timestamp rate calculation before deprioritising.**

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
snapshot** (lines 190, 1067, 1148-1186). A signed snapshot archives the pruned
state. The deploy even has an auto-prune, but it triggers on **disk size (500MB)**,
which the 133MB chain never reaches — so it never fires. The real constraint is
validation **time**, which scales with **retained block count**, not disk. A
count/height-based prune (keep the last K blocks) would bound startup validation
to O(K) and directly fix the root cause.

**Consumers of historical (pre-tip) chain data — what a prune would affect:**
~43 direct `self.chain` iterations in `blockchain/*.py`, and these endpoints scan
or read old blocks:
- `/chain/blocks`, `/chain/block/<index_or_hash>` — block explorer; would 404 on
  pruned blocks.
- `/audit/chain`, `/audit/treasury`, `/audit/governance`, `/audit/lending`,
  `/audit/exchange`, `/audit/registry` — audit exports over history.
- `/treasury/transparency` — full treasury inflow/outflow history.
- `/economics`, `/economics/overview`, `/leaderboard` — derived from chain scans.

What survives a prune: **balances** (seeded from the prune snapshot), the chain's
**validity**, current tip and recent blocks, and the **signed snapshot archive** of
the dropped state. What is lost from the hot chain: direct explorer/audit access to
**individual pre-prune blocks and transactions**.

- **Archive/cold-storage pattern:** the signed snapshot archive is already a
  cold-storage seed. A fuller version (keep last K hot, serve older blocks from a
  compressed/indexed archive on demand) would preserve explorer/audit access while
  keeping the hot chain small. This is more work than a plain rolling prune.
- **Viable K:** no single finite K satisfies "every historical query, instantly,
  from the hot chain" — the audit/explorer features inherently want full history.
  So plain pruning requires a product decision: either accept that pre-prune blocks
  are served from the archive (slower / via snapshot) rather than the hot chain, or
  build the cold-storage query layer. Balances/governance/lending **current state**
  do not need full history (they are seeded), so the user-facing money features are
  fine; the affected features are the **transparency/explorer/audit** read paths.

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
