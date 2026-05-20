# Wallet and Transaction Safety V2 Audit

Date: 2026-05-20

## Current Protections

- Web account wallets are encrypted in browser localStorage with PBKDF2-SHA256 and AES-GCM. Wallet passwords and raw private keys are not sent to the backend.
- Web sends use local signing. Logged-in sends decrypt the private key locally after password entry; manual mode requires a pasted key but does not persist it.
- Mobile wallets are stored locally on the device. Mobile sends sign locally before submitting a transaction payload.
- Backend and Flask routes already reject non-positive amounts, block public transactions from system-controlled senders, rate-limit public transaction submission, and return safe transaction records without private keys.
- Transaction detail pages expose pending and confirmed state, confirmations, block links, and safe JSON rather than private signing material.
- Wallet safety docs already explain self-custody, lost key risk, encrypted browser backups, and mobile backup limitations.

## Remaining Risks Addressed

- Send flow allowed one-step submission, which increased risk of wrong receivers, wrong amounts, and accidental sends.
- Address validation was inconsistent across web, mobile, backend, Flask, and SDK callers.
- Same sender/receiver sends and reserved system addresses were not consistently blocked at every public entry point.
- Double-click or immediate repeat sends had no explicit duplicate confirmation.
- Wallet backup education existed but backup actions and reminders were not prominent enough in Wallet and Account surfaces.
- SDK callers could attempt invalid sends before local validation.

## Safety Boundaries Kept

- Blockchain history and consensus records were not rewritten.
- Local signing remains local; private keys are not sent to backend routes.
- No custodial account model was introduced.
- Internal system transactions for mining rewards, treasury payouts, lending pool issuance, and faucet payouts remain supported through internal flows.
