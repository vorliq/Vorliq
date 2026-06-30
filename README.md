![Vorliq Logo](docs/logo.png)

# Vorliq

[![Vorliq CI](https://github.com/vorliq/Vorliq/actions/workflows/ci.yml/badge.svg)](https://github.com/vorliq/Vorliq/actions/workflows/ci.yml)
![Version 1.0](https://img.shields.io/badge/version-1.0-6c63ff.svg)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
![Coin: VLQ](https://img.shields.io/badge/coin-VLQ-6c63ff.svg)

Vorliq is a community savings bank platform built on its own blockchain with the VLQ coin.

- Live app: https://vorliq.org
- Public docs: https://vorliq.github.io/Vorliq
- Status: https://status.vorliq.org
- Actions: https://github.com/vorliq/Vorliq/actions

## What Vorliq Is

Vorliq is open-source community savings bank software for groups that want shared records around VLQ wallets, mining, transactions, savings coordination, community lending workflows, governance, forum activity, node registry data, and public network health.

The project includes:

- A Python proof-of-work blockchain core.
- A Node.js backend API.
- A React production web app.
- A React Native Expo mobile app.
- Public documentation, readiness checks, signed snapshots, audit exports, and node monitoring tools.

## What Vorliq Is Not

Vorliq is not regulated financial advice, not a regulated bank, and not a provider of licensed financial services. VLQ has no guaranteed value. Users control their own wallets and private keys, and Vorliq cannot recover lost private keys or wallet passwords.

Do not paste private keys, seed phrases, passwords, admin tokens, or secrets into public forms, support messages, chat, issues, or logs.

## Main Features

- VLQ wallet creation, encrypted browser storage, and wallet safety guidance.
- Signed VLQ transactions, mining, block exploration, and address history.
- Community lending-style proposals and VLQ-weighted votes.
- Community coordination requests and records.
- Governance proposals for supported network settings.
- Treasury, faucet, forum, profiles, achievements, notifications, and chat.
- Public chain snapshots, signed snapshot archive, readiness gate, audit exports, storage/index health, deployment metadata, and network manifest.
- Node registry, node sync comparison, node monitor alerts, and safe peer propagation status.

## Repository Layout

- `blockchain/` - Python blockchain node, wallet, transaction, mining, storage, registry, governance, lending, and community coordination logic.
- `backend/` - Node.js API gateway, public routes, admin-protected routes, middleware, readiness, analytics, and tests.
- `frontend/` - React web app for the public product shell and application routes.
- `mobile/` - React Native Expo app for community testing flows.
- `docs/` - GitHub Pages documentation and public safety/operator guides.
- `tools/` - Verification, readiness, bootstrap, snapshot, and operational helper scripts.
- `deployment/` - Deployment and node setup assets.

## Public Links And APIs

- App routes: https://vorliq.org, https://vorliq.org/register, https://vorliq.org/features, https://vorliq.org/blockchain, https://vorliq.org/dashboard
- Readiness: https://vorliq.org/readiness and https://vorliq.org/api/readiness
- Deployment metadata: https://vorliq.org/api/deployment
- Chain snapshot: https://vorliq.org/api/snapshot/latest
- Snapshot verification: https://vorliq.org/api/snapshot/verify
- Network manifest: https://vorliq.org/api/network/manifest
- Node sync: https://vorliq.org/nodes/compare and https://vorliq.org/api/nodes/compare
- Peer propagation: https://vorliq.org/peers/propagation and https://vorliq.org/api/peers/propagation/status
- Testing guide: https://vorliq.github.io/Vorliq/testing.html
- Wallet safety: https://vorliq.github.io/Vorliq/wallet-safety.html
- Transparency: https://vorliq.github.io/Vorliq/transparency.html

## Local Setup Overview

Install Git, Node.js LTS, and Python 3.12. On Windows, make sure Python is added to PATH.

1. Clone the repository.
2. In `blockchain/`, create a Python virtual environment and install `requirements.txt`.
3. In `backend/`, run `npm install`.
4. In `frontend/`, run `npm install`.
5. Optionally, in `mobile/`, run `npm install` for the Expo app.
6. Start the local services using the commands below.

The default local frontend is `http://localhost:3000`. The backend API defaults to `http://localhost:5000/api`, and the blockchain API defaults to `http://localhost:5001`.

### Local Developer Scripts

Windows developers can continue to use `start.bat`. Linux and macOS developers can use the local-development shell scripts:

```bash
chmod +x scripts/*.sh stress_test/run_stress_test.sh
./scripts/start-all.sh
```

`start-all.sh` starts the blockchain API, backend API, and frontend in one terminal. Press `Ctrl+C` to stop them. It does not start the registry heartbeat helper by default because that helper writes local registry heartbeat data. To match the heartbeat behavior of `start.bat`, explicitly run `VORLIQ_ENABLE_HEARTBEAT=1 ./scripts/start-all.sh`.

Individual Linux/macOS launchers are available as `start-blockchain.sh`, `start-backend.sh`, `start-frontend.sh`, and `start-heartbeat.sh` in `scripts/`. These scripts use existing local commands, do not install global packages, do not source `.env` files, and are not production deployment tools.

The shell scripts improve Linux/macOS developer setup coverage, but they do not claim that every operating-system configuration has been tested.

Never paste private keys, wallet passwords, admin tokens, or seed phrases into support messages, issues, public logs, or screenshots.

## Testing

Vorliq uses Python tests for blockchain behavior, backend Jest tests for API behavior, frontend React tests for UI state, Playwright E2E checks for production route smoke coverage, and readiness/snapshot verification scripts for public deployment checks.

Common checks:

- Backend focused tests from `backend/`: `npm test -- <test-file>`
- Frontend CI tests from `frontend/`: `npm run test:ci -- --runInBand`
- Frontend production build from `frontend/`: `npm run build`
- Public readiness gate: `node tools/check_readiness.js https://vorliq.org --allow-warning`
- Snapshot verification: `node tools/verify_snapshot.js https://vorliq.org --require-signature`

Linux/macOS wrappers run the same existing commands:

```bash
./scripts/test-backend.sh
./scripts/test-blockchain.sh
./scripts/test-frontend.sh
./scripts/build-frontend.sh
./scripts/check-readiness.sh
```

The readiness wrapper checks the local backend at `http://localhost:5000` by default. Pass a different safe development URL as its first argument when needed.

See the full guide at https://vorliq.github.io/Vorliq/testing.html.

## Safety And Operations

See [OPERATIONS.md](OPERATIONS.md) for the production runbook: service management, deployment, health checks, backups, secrets rotation, monitoring, and incident response.

- Do not manually edit chain data, production JSON state, signed snapshots, audit exports, or registry state to hide problems.
- Do not weaken proof of work, signature validation, signed snapshot verification, peer propagation safety, storage integrity, or wallet safety.
- Do not commit secrets, private keys, passwords, SSH keys, raw logs, environment dumps, raw IPs, raw user agents, or private operational details.
- Use verified bootstrap and snapshot tools before trusting another node as a source of chain state.
- Keep PostgreSQL adapter and migration work in documented preparation paths unless production deployment explicitly enables it.

## Community

- GitHub: https://github.com/vorliq/Vorliq
- X: https://x.com/vorliq
- Telegram: https://t.me/Vorliq
- Discord: https://discord.gg/qpX5sHD4pC

## License

Vorliq is released under the MIT License. See [LICENSE](LICENSE).
