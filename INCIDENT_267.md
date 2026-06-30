# INCIDENT 267 — Deploy gate fails with "CONSECUTIVE_MINER_VIOLATION at #267"

Read-only investigation, 2026-06-30. No chain data, consensus code, deploy.yml,
or production state was modified. Conclusion below separates **facts** (verified)
from **hypothesis** (best-supported interpretation).

## Summary

Every production deploy since `064409c` (2026-06-29) fails at the deploy's
post-restart chain-readiness gate, printing
`{"main":{"code":"CONSECUTIVE_MINER_VIOLATION","index":267,...},"backup":{...267...}}`.
The live site is healthy and the running node reports `chain_valid:true` at
height ~7968 (and rising). **The "#267" message is a red herring. The deploy
fails on a timeout: the blockchain node is not finished starting up within the
gate's 30-second window, so `/diagnostics` returns empty and the gate gives up.**
This is a deploy-gate timing problem plus a misleading diagnostic — **not**
consensus corruption and **not** caused by any code change this session.

## Facts (verified)

1. **Live production chain is valid and advancing.** `https://vorliq.org/api/health`
   → `{"success":true}`; `/api/diagnostics` → `chain_valid:true`, height moved
   7959 → 7968 across a few minutes (mining active). So the in-memory chain is
   not corrupt.

2. **No relevant code/config changed this session.** `git log 5fefc29..HEAD`
   (last green deploy → now) shows **zero** changes to:
   - `tools/diagnose_chain_startup.py` (one commit ever, `8edfdd7`; identical at
     `5fefc29`),
   - `.github/workflows/deploy.yml`,
   - `blockchain/blockchain.py`, `blockchain/app.py` (consensus/validation).
   The session changed only tests, frontend, docs, the backend lockfile, and
   blockchain dep pins — nothing in the gate, the diagnostic, or consensus.

3. **The deploy gate cannot fail on the consecutive-miner rule.** The gate polls
   `/diagnostics`, whose validity comes from `Blockchain.chain_valid_fast()` =
   `is_chain_valid(enforce_block_spacing=False)`. In `is_chain_valid`, BOTH
   spacing checks (minimum block time AND the same-miner anti-monopoly gap) are
   inside `if enforce_block_spacing:` — so with `enforce_block_spacing=False` the
   consecutive-miner rule is **never evaluated**. The gate can only fail on a
   structural/transaction problem or on the node being unreachable.

4. **`diagnose_chain_startup.py`'s consecutive-miner check is gap-less (stricter
   than the real rule).** Lines 52-53:
   `if current_miner and previous_miner and current_miner == previous_miner: return ...CONSECUTIVE_MINER_VIOLATION`.
   It has **no `< SAME_MINER_MIN_GAP` condition**, unlike the real rule in
   `is_chain_valid`. On a single-miner production chain (the server fallback
   miner mines most blocks), consecutive same-miner blocks separated by >60s are
   perfectly valid but this check flags the first such pair unconditionally.
   `#267` is simply the lowest index where two consecutive blocks share a miner
   — not a special or corrupt block. The diagnostic stops at the first failure,
   so it never reaches its own transaction check (line 55).

5. **The gate failed on a timeout, not a validity result.** In the deploy log,
   after backend health succeeded at `05:00:23`, the final `BLOCKCHAIN_RESPONSE`
   echoed at `05:00:53` (end of the 10×3s loop) was an **empty line**, and the
   token `chain_valid` never appears in any `/diagnostics` *response* in the
   whole log (only inside the workflow's own `grep` command text). So
   `curl http://localhost:5001/diagnostics` returned **nothing** for the full 30
   seconds — the blockchain node (Flask, port 5001) was not yet serving.
   `/api/health` success is the **backend** (Node, 5000), which comes up
   independently of the chain node.

6. **Access limits of this investigation.** The on-disk `chain.json` /
   `chain.json.bak` files live on the production droplet (159.65.24.177),
   reachable only with the deploy SSH key, which is a GitHub Actions secret and
   is **not on this machine** (no private key in `~/.ssh`). The live
   `/api/chain/block/267` read endpoint also returned `UPSTREAM_ERROR`
   repeatedly (heavy lookup on a large chain, proxy timeout). Therefore Steps
   1.2/1.3 (byte-level comparison of the on-disk main vs backup vs live block
   #267) and a direct measurement of node restart duration **could not be
   performed**. The conclusion rests on items 1-5, which do not require that
   access.

## Hypothesis (best-supported)

**Root cause:** the blockchain node's startup — loading and fully re-validating
the now-~8000-block chain — exceeds the deploy's 30-second chain-readiness
window. The gate polls `/diagnostics` on port 5001, gets empty responses for the
whole window (node still starting), times out, and runs
`diagnose_chain_startup.py`, which reads the on-disk chain directly and emits a
**spurious** `CONSECUTIVE_MINER_VIOLATION at #267` (gap-less check). The chain is
valid; no consensus rule is actually violated.

**Why it started failing now and not before 2026-06-25:** the only variable that
changed is chain **size**. Startup re-validation is O(n) with per-block crypto;
as the chain grew it crossed the 30-second gate threshold. Items 2 (no code
change) + 5 (empty responses) + 1 (live chain valid) make "the same gate, same
code, larger chain, slower startup" the coherent explanation.

## Classification

- (a) stale/incorrect on-disk file from a reset — **not supported / unverifiable**
  (live chain valid; couldn't read on-disk files, but the empty-response evidence
  points to "not started yet," not "loaded an invalid file").
- (b) retroactive rule strictness on historical blocks — **partially true of the
  diagnostic only**: `diagnose_chain_startup.py` applies a stricter (gap-less)
  consecutive-miner check than the real rule, which is why its output is
  misleading. But this is **not** what fails the deploy (item 3) — the gate never
  evaluates that rule.
- (c) genuine chain corruption/tampering — **not supported** (live chain valid
  and advancing at 7968).
- (d) **deploy-gate timing** (node startup > 30s window on a large chain), plus a
  misleading diagnostic — **this is the supported conclusion.**

**Isolated vs systemic:** the `#267` flag is systemic to single-miner operation
(every consecutive same-miner pair trips the gap-less check); `#267` is just the
first such index. It is not an isolated corrupt block.

## Recommendation (DO NOT ACT — awaiting human sign-off)

Recommended order, all **non-consensus, no chain-data mutation**:

1. **Widen the deploy's chain-readiness gate (deploy.yml).** Increase the retry
   window (e.g., poll `/diagnostics` for several minutes, and/or first wait until
   port 5001 answers at all) so the node finishes loading the large chain before
   the gate times out. This directly addresses the measured failure (empty
   responses during a too-short window). — *This is the primary fix.*
2. **Fix `diagnose_chain_startup.py` lines 52-53** to include the
   `< SAME_MINER_MIN_GAP` gap condition, matching the real consensus rule, so the
   diagnostic stops emitting spurious `CONSECUTIVE_MINER_VIOLATION` on healthy
   single-miner chains and future incident response isn't misled.
3. **Optionally** reduce node startup cost on large chains (trusted fast-load /
   memoized validation) and/or evaluate chain pruning to bound on-disk size —
   larger changes, separate review.

A definitive confirmation of the 30s-threshold hypothesis would come from one
SSH-read on the droplet (time `systemctl restart vorliq-blockchain` and watch how
long until `curl localhost:5001/diagnostics` answers `chain_valid:true`) — this
needs the deploy key, which is not available in this environment.

**No remediation (1, 2, or 3) has been implemented. Awaiting explicit
confirmation before any change.**

---

## Update 2026-06-30 — Item 1 fix result + NEW finding (Step 4.5 stop)

**Item 1 (widened chain gate) worked.** Deploy run `28451038438` (commit
`e126ba0`) got PAST the chain-readiness gate inside "Deploy to production server"
(the original failure point) and progressed through every intermediate step to
the very last one. The original symptom is fixed.

**The failure moved to the final step "Run public production readiness gate"**
(`tools/check_readiness.js https://vorliq.org`), which reported:
`FAIL Blockchain/Chain valid, FAIL Network/Public node active, FAIL Mining status,
FAIL Treasury summary, FAIL Faucet summary` (exit 2).

**Why (refined root cause — same reload wall, a later gate):** after my widened
gate passes, the deploy restarts `vorliq-blockchain` THREE more times — in
"Configure transactional email provider" (deploy.yml:537), "Configure community
lending vote threshold" (562) and "Configure governance quorum" (586). The public
readiness gate (622) runs immediately after that last restart. Log timing: the
governance restart finished 14:17:53; the readiness gate then ran until 14:27:45
(~10 minutes) and still failed — the large-chain node was not fully serving its
heavier endpoints in that window.

**This is now broader than a deploy-gate timeout and ties to the deferred Item 3.**
Evidence the node is operationally strained at this chain size (~7986 blocks):
even now, post-deploy, `https://vorliq.org/api/diagnostics` returns
`chain_valid:true` (memoised, cheap) while `https://vorliq.org/api/mining/status`
returns `UPSTREAM_ERROR` ("Blockchain service is currently unavailable") — the
heavier read endpoints time out through the backend proxy. The chain itself is
healthy and advancing (height rose 7968 → 7986 during this work).

**Two compounding problems identified, neither fixed (awaiting direction):**
1. The deploy restarts `vorliq-blockchain` 4× per run (once in the deploy step,
   then once each in the email/lending/governance config steps) — each forces a
   full ~8000-block reload. These restarts re-apply env values that rarely change;
   making them conditional (restart only if the value actually changed) would
   remove 3 of the 4 reloads per deploy.
2. The node is slow enough on a ~8000-block chain that heavier endpoints time out
   even at steady state — this is the deferred Item 3 (startup/runtime performance,
   pruning/checkpointing) surfacing operationally, arguably no longer safe to defer.

**Per Step 4.5: STOPPED. No further changes made. Item 2 (diagnostic gap fix) and
Item 1 (widened gate) are committed and pushed (`e126ba0`); both are correct and
remain in place. The remaining work needs an explicit decision (see options in the
report).**
