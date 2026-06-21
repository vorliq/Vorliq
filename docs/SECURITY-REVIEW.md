# Vorliq security review

Full-platform attack-surface review. Each item lists what was checked, the
finding, and the resolution or — where a residual risk is accepted — the reason.

## 1. Signed-authorization coverage on write paths

**Checked:** every `router.post` write endpoint against the signed-authority
allowlist (`backend/middleware/signedAuthorization.js` `AUTHORITY_ROUTES`) and
against Flask's independent re-verification (`blockchain/signed_authorization.py`).

**Finding / resolution:** all custody- and identity-critical wallet writes are
signed and bound to the acting wallet, and are re-verified a second time at the
Flask core: governance propose/vote/cancel, treasury propose/vote/cancel,
lending request/vote/repay, forum post/reply/feature, profile create/update,
avatar upload, and registry operator verification. `/transaction/send` is
authenticated by the transaction's own secp256k1 signature (a different but
equally cryptographic scheme). Admin writes are bearer-token gated
(`/api/admin/*`, `/api/incidents` POST/PATCH use `requireAdmin`). Writes that are
public by design have their own controls: faucet (per-wallet 24h cooldown +
per-fingerprint + rate limit), newsletter, reports, analytics, and forum upvote
(documented: upvote only reorders the non-default tab and cannot flip
visibility). No identity-critical path is unsigned.

**Accepted residual risk — exchange coordination writes:** the P2P exchange
endpoints (`/api/exchange/offer|accept|complete|confirm-complete|record-vlq-tx|
dispute|cancel`) are not signed. This is accepted because the exchange is a
*non-custodial coordination board*: no VLQ moves through these endpoints, and the
actual settlement is a separately-signed `/transaction/send`. The worst case is
griefing (posting or cancelling offers under another address), not fund loss.
Adding the exchange to the signed-authority layer (Node + the Exchange UI signing
each action) is recommended future hardening.

## 2. Nonce replay tracking and memory growth

**Checked:** `usedNonces` map and `pruneNonces` in the Node middleware, plus the
persistent `consume_authority_nonce` store at Flask.

**Finding / resolution:** no unbounded accumulation and no replay. `pruneNonces`
runs on *every* signed verify immediately before a new nonce is recorded, so the
in-memory map is bounded to nonces inside the active validity window
(~300s + skew); once writes stop, only that last window's nonces remain and they
are dropped on the next write. Replay is additionally prevented durably at the
Flask layer, which re-verifies the signed envelope and consumes the nonce in a
persistent store that also drops expired entries — so a captured request cannot
be replayed even across a Node restart that clears the in-memory map. No change
needed.

## 3. Admin token exposure surface

**Checked:** `middleware/adminAuth.js`, admin log/security/overview responses,
and frontend token handling.

**Finding / resolution:** the token is compared in constant time over SHA-256
digests (no length or byte leak through timing), is never logged, and is
explicitly redacted from the admin log and security endpoints
(`ADMIN_TOKEN=…`, `password|token|private_key|secret=…` → `[redacted]`). The
frontend keeps it only in `sessionStorage`, cleared on "Clear Session Token". No
change needed.

## 4. Avatar upload path traversal

**Checked:** filename derivation and file path construction in
`backend/routes/avatar.js`.

**Finding / resolution:** not possible. The stored filename is
`sha256(address)` hex (64 hex characters) plus a fixed extension, written with
`path.join(AVATAR_DIR, "<hex>.<ext>")`; the GET reads by the same hashed key. A
crafted address containing `../`, null bytes, or absolute paths hashes to pure
hex and can never escape `AVATAR_DIR`. SVG and non-raster types are already
rejected by magic-byte validation. No change needed.

## 5. Rate limiter bypass by rotating IPs

**Checked:** `express-rate-limit` keying (`req.ip`) and `app.set("trust proxy", 1)`.

**Accepted residual risk:** IP-based limiting is inherently bypassable by an
attacker who controls many source IPs — this is true of any per-IP limiter. In
production Vorliq sits behind a single nginx hop and `trust proxy` is set to `1`,
so a client-supplied `X-Forwarded-For` cannot spoof `req.ip` (nginx sets the
trusted entry); IP rotation requires actually controlling distinct addresses. In
a bare local environment with no proxy, `X-Forwarded-For` could be used to rotate
the perceived IP — accepted, because (a) it only matters in a non-production
setup, and (b) defense-in-depth limits abuse regardless: the faucet enforces a
per-wallet 24h cooldown and a per-(IP+UA) fingerprint cap at the chain level,
signed writes carry nonce replay protection, and wallet creation is bounded. No
change needed; documented as accepted.

## 6. Private-key import — key unreachable in all error paths

**Checked:** `frontend/src/pages/Login.js` `importPrivateKey`, including an
exception thrown during derivation or during encryption.

**Finding / resolution (fixed):** the masked input value (`pkKey`) was already
cleared on every error path. It is now additionally guaranteed that the transient
derived wallet's plaintext key is nulled in the catch block, so a failure during
`createEncryptedWalletBackup` (after a successful derivation) cannot leave the raw
key reachable on the local object. Combined with the existing guarantees — the
key is never sent to any backend, never written to localStorage/sessionStorage in
plaintext, never logged, and never placed in an analytics event — the key is
unreachable from every UI, network, and storage surface in both the success and
the error paths.
