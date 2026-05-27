![Vorliq Logo](docs/logo.png)

Vorliq
======

[![Vorliq CI](https://github.com/vorliq/Vorliq/actions/workflows/ci.yml/badge.svg)](https://github.com/vorliq/Vorliq/actions/workflows/ci.yml)
![Version 1.0](https://img.shields.io/badge/version-1.0-6c63ff.svg)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
![Coin: VLQ](https://img.shields.io/badge/coin-VLQ-6c63ff.svg)

Live app: https://vorliq.org

Public docs: https://vorliq.github.io/Vorliq

Testing guide: https://vorliq.github.io/Vorliq/testing.html

Current public version: 1.0.0 stable. Release metadata, roadmap, changelog, production readiness, snapshot verification, signed snapshots, signed snapshot archive, bootstrap verification, verified chain bootstrap, verified node onboarding, node sync comparison, node lifecycle archival, network monitor alerts, migration readiness, storage adapter interface, PostgreSQL adapter planning, PostgreSQL readiness planning, PostgreSQL shadow migration rehearsal, and upgrade guidance are available at https://vorliq.org/releases, https://vorliq.org/roadmap, https://vorliq.org/readiness, https://vorliq.org/snapshot, https://vorliq.org/snapshot-archive, https://vorliq.org/bootstrap, https://vorliq.org/nodes/compare, https://vorliq.org/migration-readiness, https://vorliq.org/api/version/metadata, https://vorliq.github.io/Vorliq/snapshot-verification.html, https://vorliq.github.io/Vorliq/signed-snapshots.html, https://vorliq.github.io/Vorliq/snapshot-archive.html, https://vorliq.github.io/Vorliq/bootstrap-verification.html, https://vorliq.github.io/Vorliq/bootstrap-chain.html, https://vorliq.github.io/Vorliq/node-sync.html, https://vorliq.github.io/Vorliq/node-monitoring.html, https://vorliq.github.io/Vorliq/node-lifecycle.html, https://vorliq.github.io/Vorliq/run-your-own-node.html, https://vorliq.github.io/Vorliq/storage-adapter-interface.html, https://vorliq.github.io/Vorliq/postgres-adapter.html, https://vorliq.github.io/Vorliq/postgres-readiness.html, https://vorliq.github.io/Vorliq/postgres-shadow-migration.html, and https://vorliq.github.io/Vorliq/upgrades.html.

What is Vorliq
--------------

Vorliq is experimental open-source community blockchain software built on its own lightweight blockchain. It does not depend on Ethereum, Bitcoin, Solana, or any outside cryptocurrency network. The native coin is called VLQ, and the application includes a Python proof of work blockchain core, a Node.js backend API, a React web application, and a React Native mobile application.

Vorliq is community coordination and record-keeping software for its own VLQ blockchain. It is not a licensed bank, broker, exchange, lender, investment adviser, custodian, or financial institution. Members can create wallets, mine blocks, send signed VLQ transactions, request community support, vote on requests with VLQ balance as voting weight, post buy and sell offers, connect peer nodes, monitor network health, and vote on governance proposals that can change supported network rules.

What is VLQ
-----------

VLQ is the native coin of the Vorliq network. The maximum supply is 21 million VLQ. The starting mining reward is 50 VLQ per block, and the scheduled reward halves every 210000 blocks. Mining rewards are created by the Vorliq blockchain itself and normal transactions are signed with SECP256K1 cryptographic keys. VLQ has no guaranteed market value, is not listed on public exchanges by the project, and should not be treated as an investment promise.

Vorliq also includes community governance, so VLQ holders can vote on proposals that change network parameters. That means the community can vote to change the mining reward, block difficulty, loan rules, exchange limits, and other supported settings instead of relying on a central operator.

Features
--------

Vorliq includes a complete proof of work blockchain written in Python. Blocks contain signed transactions, link to the previous block by hash, and are mined with a proof of work target. Wallets use real SECP256K1 keys and addresses derived from public key hashing.

The community lending-style system lets members request VLQ support and lets other members vote to approve or reject those requests using VLQ balance as voting weight. Approved requests are issued through the blockchain and repayments are tracked by the lending system. This feature is experimental software and is not a licensed lending service.

The decentralized VLQ exchange lets community members post buy and sell offers directly inside Vorliq. Offers can describe any community-agreed price, such as money, goods, services, or time, so local communities can coordinate in the way that makes sense to them. This is an experimental offer board, not a licensed exchange, broker, dealer, or escrow service.

The peer to peer network lets Vorliq nodes register peers, broadcast transactions and blocks, discover other peers, and synchronize to the longest valid chain. Registry lifecycle states mark nodes as active, stale, inactive, archived, or retired without deleting registry history. Old test nodes can be archived through protected admin flow, restored when heartbeat returns, or retired when no longer participating; do not manually edit `registry.json`. The network has been tested with multi node stress tests covering synchronization, network partition recovery, and double spend prevention.

The community governance system gives VLQ holders on-chain voting power over Vorliq rules. Members can propose changes, vote with balance-weighted votes, and approved proposals automatically apply supported changes such as mining reward and difficulty updates.

The React web application provides the browser interface for wallets, sending VLQ, mining, chain exploration, lending, exchange, governance, treasury, faucet, profiles, node registry, statistics, account history, notifications, and health monitoring. The React Native Expo mobile application supports community-testing flows for wallet creation, local signing, sending, faucet claims, mining status, transaction and block details, profiles, lending repayment, exchange trade actions, governance views, treasury proposal submission and voting, node registry status, settings, and notifications.

Vorliq includes encrypted browser wallet storage, local key storage on mobile, dark and light mode, persistent notifications, push notification support through Expo, node diagnostics, rotating logs, atomic JSON persistence with backup-before-write protection, derived read indexes, storage and index health reporting, a storage adapter interface, an experimental PostgreSQL adapter that is disabled in production, PostgreSQL migration readiness artifacts, database migration dry-run, import simulation, local and CI-only shadow rehearsal preparation, a public node registry, GitHub Pages documentation, a full test suite, GitHub Actions CI, and production deployment documentation.

Transparency and Safety
-----------------------

Vorliq is live software, but it is still an early cryptocurrency-style network. Mining rewards, treasury rewards, tips, exchange offers, lending activity, price signals, and governance votes are experimental software features and may change over time. The public transparency page explains what is live today, what is experimental, what operational protections exist, and what limitations remain: https://vorliq.github.io/Vorliq/transparency.html.

Vorliq is self-custody. The server stores public blockchain data, forum posts, governance activity, exchange offers, lending records, and operational state, but it does not store user private keys or wallet passwords. Lost private keys cannot be recovered by Vorliq, so users should read the wallet safety guide before using real wallets: https://vorliq.github.io/Vorliq/wallet-safety.html.

Public network proof is available through the status page, the readiness gate, public chain snapshots, signed snapshot documentation, the signed snapshot archive, node sync comparison, node monitor alerts, bootstrap verification, the migration readiness page, the recovery guide, the upgrade guide, the storage reliability guide, the storage adapter guide, the adapter interface guide, the PostgreSQL adapter guide, the schema map, the PostgreSQL readiness and shadow migration plans, the database migration and rollback plans, the derived index guide, public audit exports, and the machine-readable network manifest. Users and developers can check https://status.vorliq.org, https://vorliq.org/readiness, https://vorliq.org/nodes/compare, https://vorliq.org/snapshot, https://vorliq.org/snapshot-archive, https://vorliq.org/migration-readiness, https://vorliq.github.io/Vorliq/readiness.html, https://vorliq.github.io/Vorliq/node-sync.html, https://vorliq.github.io/Vorliq/node-monitoring.html, https://vorliq.github.io/Vorliq/snapshot-verification.html, https://vorliq.github.io/Vorliq/signed-snapshots.html, https://vorliq.github.io/Vorliq/snapshot-archive.html, https://vorliq.github.io/Vorliq/bootstrap-verification.html, https://vorliq.github.io/Vorliq/recovery.html, https://vorliq.github.io/Vorliq/upgrades.html, https://vorliq.github.io/Vorliq/storage.html, https://vorliq.github.io/Vorliq/storage-adapters.html, https://vorliq.github.io/Vorliq/storage-adapter-interface.html, https://vorliq.github.io/Vorliq/postgres-adapter.html, https://vorliq.github.io/Vorliq/schema-map.html, https://vorliq.github.io/Vorliq/postgres-readiness.html, https://vorliq.github.io/Vorliq/postgres-shadow-migration.html, https://vorliq.github.io/Vorliq/database-migration-plan.html, https://vorliq.github.io/Vorliq/database-rollback-plan.html, https://vorliq.github.io/Vorliq/indexes.html, https://vorliq.github.io/Vorliq/audit.html, https://vorliq.github.io/Vorliq/api-versioning.html, https://vorliq.github.io/Vorliq/examples.html, https://vorliq.org/api/readiness, https://vorliq.org/api/nodes/compare, https://vorliq.org/api/nodes/monitor, https://vorliq.org/api/snapshot/latest, https://vorliq.org/api/snapshot/verify, https://vorliq.org/api/snapshot/public-key, https://vorliq.org/api/snapshot/archive, https://vorliq.org/api/snapshot/archive/latest, https://vorliq.org/api/migration/readiness, https://vorliq.org/api/indexes/health, https://vorliq.org/api/audit/manifest, https://vorliq.org/api/version/metadata, and https://vorliq.org/api/network/manifest. The build and deployment process is public through GitHub Actions at https://github.com/vorliq/Vorliq/actions.

Public chain snapshots
----------------------

Vorliq exposes a deterministic public snapshot at `https://vorliq.org/api/snapshot/latest` and a regenerated verification response at `https://vorliq.org/api/snapshot/verify`. The snapshot includes public chain height, latest block hash, chain validity, confirmed and pending transaction counts, treasury balance, active node count, deployment commit, storage/index/readiness status, and SHA-256 hashes for chain summary, latest block, transaction index summary, treasury, governance, lending, exchange, registry, audit manifest, and network manifest.

Hashes are calculated from canonical JSON with sorted object keys. Snapshots do not include private keys, passwords, admin tokens, raw IP addresses, server paths, logs, environment variables, full analytics event lists, or raw user agents. Production snapshots are Ed25519 signed by signing the canonical snapshot hash, which excludes the `signature` object. Run `node tools/verify_snapshot.js https://vorliq.org` to compare `/api/snapshot/latest` with `/api/snapshot/verify`, scan for forbidden secret markers, and verify signatures. Use `node tools/verify_snapshot.js https://vorliq.org --require-signature` when unsigned snapshots should fail locally; this should pass for production. The public key metadata is available at `/api/snapshot/public-key`. Generate keys with `node tools/generate_snapshot_keypair.js`; never commit the private key, and store it only as a production secret. Snapshots and signatures are public integrity aids only; they are not legal, financial, banking, or investment guarantees. Production remains JSON-backed in this release, while PostgreSQL remains disabled preparation work.

The signed snapshot archive stores the latest 30 public signed snapshot records and is refreshed during deploy plus daily at 04:00 Europe/London. Use `node tools/verify_snapshot_archive.js https://vorliq.org` to verify the latest archive, `--list` to list recent archives, and `--hash SNAPSHOT_HASH` to verify a specific archived snapshot. Use `node tools/bootstrap_verify_node.js https://vorliq.org` for a read-only bootstrap report before trusting a node as a source of public state. Use `python tools/bootstrap_chain_from_public_node.py --trusted-node https://vorliq.org --dry-run` to verify the bootstrap package, signed snapshot, audit manifest, chain export hash, block hashes, previous-hash links, and latest hash without writing local data. Community operators can follow https://vorliq.github.io/Vorliq/run-your-own-node.html and https://vorliq.github.io/Vorliq/bootstrap-chain.html, then run `sudo bash deployment/install_verified_node.sh` on a fresh Ubuntu server to verify first, install, configure node identity, optionally bootstrap a new chain, register heartbeat metadata, and run `node tools/node_doctor.js`.

Node sync comparison
--------------------

Vorliq exposes node sync comparison at `https://vorliq.org/api/nodes/compare` and `https://vorliq.org/nodes/compare`. It compares public registry heartbeat data with the trusted public chain height, latest hash, signed snapshot hash, and signature verification status. Statuses are `synced`, `behind`, `ahead`, `forked`, `stale`, `unreachable`, and `unknown`.

`synced` means active, valid, same trusted height, and same latest hash. `behind` means valid but lower than the trusted public chain. `ahead` means higher than the trusted public chain, but it is not automatically trusted because signed snapshots and audit exports must verify the newer state first. `forked` means a comparable hash mismatch and should be recovered with verified bootstrap dry-run before any write. `stale` means heartbeat is outside the active window, `unreachable` means diagnostics could not be checked, and `unknown` means safe comparison data is missing. Do not manually edit `chain.json`, rewrite historical blocks, or change block hashes.

Network monitor alerts
----------------------

Vorliq exposes the node monitor at `https://vorliq.org/api/nodes/monitor`. It reports `ok`, `warning`, or `critical` based on the trusted public node, fork state, stale heartbeats, ahead/behind status, unreachable nodes, and snapshot metadata signals. Stale old community nodes are warning-only by default and do not create public incidents. Active forked nodes, trusted public node fork/unreachable state, trusted snapshot signature failure, or missing trusted chain state are critical network-integrity conditions.

Scheduled maintenance calls the local monitor endpoint, logs sanitized warnings, sends operator alerts through the configured alert script, and suppresses duplicates by alert code and node URL. The safe state file contains only alert code, node URL, first seen, last seen, count, last alerted time, and status. Use `node tools/node_doctor.js --base-url https://vorliq.org --trusted-node https://vorliq.org` to inspect monitor status and operator actions. Do not manually edit `chain.json` while investigating a fork; run verified bootstrap dry-run and signed snapshot/audit checks first.

How to Run
----------

To run Vorliq on Windows, install Git, Node.js LTS, and Python 3.12 first. When installing Python, make sure the Add to PATH checkbox is selected. After those tools are installed, open a terminal in the folder where you want Vorliq to live and run `git clone https://github.com/vorliq/Vorliq.git`. Then open the downloaded Vorliq folder.

The easiest way to start the application is to double click `start.bat` in the root folder. The script starts the Python blockchain API, the Node.js backend API, the React web app, and the heartbeat service in separate terminal windows. After the windows open, visit `http://localhost:3000` in your browser.

If you are setting up from a fresh clone, install the dependencies first. In the `blockchain` folder create and activate the Python virtual environment with `python -m venv .venv` and `.venv\Scripts\activate`, then run `pip install -r requirements.txt`. In the `backend` folder run `npm install`. In the `frontend` folder run `npm install`. In the `mobile` folder run `npm install` if you want to run the Expo mobile application.

To use the mobile app, install Expo Go on your phone, open a terminal in the `mobile` folder, run `npx expo start`, and scan the QR code with Expo Go. The default mobile node URL is `https://vorliq.org`. In the mobile Settings screen, you can switch to your own backend, usually something like `http://192.168.1.20:5000` on your local network. Private mobile service files such as Android notification config should stay out of git.

Testing
-------

Vorliq uses Python tests for blockchain behavior, backend Jest tests for API behavior, frontend React tests for browser UI state, SDK build/smoke checks, mobile Expo export when mobile code changes, a production readiness CLI gate, and Playwright Chromium E2E tests for read-only production route, layout, navigation, and API smoke coverage. The Playwright suite is intentionally non-destructive: it does not claim faucet funds, mine production blocks, create posts, submit offers, create proposals, spend treasury funds, or use admin tokens. Run the readiness gate with `node tools/check_readiness.js https://vorliq.org --allow-warning`. See the full guide at https://vorliq.github.io/Vorliq/testing.html.

Community
---------

Discord: https://discord.gg/qpX5sHD4pC

Telegram: https://t.me/Vorliq

Reddit: https://www.reddit.com/u/Vorliq/s/PbPMGkrGVS

GitHub: https://github.com/vorliq/Vorliq

X: https://x.com/vorliq
