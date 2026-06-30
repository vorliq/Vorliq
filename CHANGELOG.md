Vorliq Changelog
================

The entries below the "Maintenance" section are the narrative release history
(0.1.0 through 1.0.0). Post-1.0.0 maintenance is tracked in Keep a Changelog
style (https://keepachangelog.com).

Maintenance (post-1.0.0)
------------------------

### Security
- Resolved 7 transitive backend npm advisories, including high-severity
  `ws` / `engine.io` / `socket.io-adapter` issues in the production Socket.IO
  stack (memory disclosure, DoS), plus `qs`, `form-data`, `js-yaml`,
  `@babel/core`. `npm audit` now reports 0 vulnerabilities. (064409c)
- Resolved 3 blockchain Python advisories via patch bumps: `cryptography`
  48.0.0→48.0.1, `idna` 3.14→3.15, `pytest` 9.0.2→9.0.3. `pip-audit` now
  reports no known vulnerabilities. (4e7ccef)
- Added `payment=()` to the backend Permissions-Policy response header so the
  unused Payment Request API is explicitly disabled. (c70b609)

### Fixed
- Stabilized the anti-monopoly mining test on slow hosts by pinning the test
  chain to difficulty 1 (deterministic, instant proof of work). Test-only;
  no consensus change. (cc95b62)
- Raised the mine-lock concurrency test's deadlock-guard timeouts from 10s to
  30s so a slow/contended host no longer trips a spurious TimeoutError; the
  read-latency correctness assertion is unchanged. (2199ba4)

### Documentation
- Added `OPERATIONS.md`: production runbook covering architecture, service
  management, deployment/rollback, health checks, env vars, secrets rotation,
  monitoring, backup/recovery, common operations, and incident response.
- Linked `OPERATIONS.md` from the README and added this maintenance changelog.

Version 0.1.0: Initial Project Structure
----------------------------------------

Version 0.1.0 established the project foundation with the three part architecture of a Python blockchain core, a Node.js backend, and a React frontend. This version created the structure that allowed Vorliq to grow into a complete self-contained community blockchain application.

Version 0.2.0: Blockchain Core
------------------------------

Version 0.2.0 delivered the complete proof of work blockchain with SECP256K1 cryptography, real transaction signing, wallet generation, address creation, mining, validation, and the VLQ coin with its 21 million supply cap. This version made Vorliq a real independent blockchain instead of a frontend-only concept.

Version 0.3.0: Backend API and Frontend
---------------------------------------

Version 0.3.0 connected the blockchain to a full React web application through a Node.js Express backend API. It added wallet creation, transaction sending, mining, balance lookup, pending transaction views, and blockchain exploration through a browser interface.

Version 0.4.0: Token Economics and Whitepaper
---------------------------------------------

Version 0.4.0 added the halving schedule, the token economics dashboard, and the public project whitepaper. This version made the VLQ supply model clearer by showing maximum supply, current mining reward, block height, halving interval, and total issued VLQ.

Version 0.5.0: Peer to Peer Networking
--------------------------------------

Version 0.5.0 turned Vorliq from a single machine application into a real distributed network with peer registration, transaction broadcast, block broadcast, automatic chain sync, peer discovery, and the longest valid chain consensus rule.

Version 0.6.0: Community Lending
--------------------------------

Version 0.6.0 added the community lending system with VLQ weighted voting for loan approval. Members could request loans, vote yes or no with wallet balance as voting weight, approve or reject loans, and track repayment status.

Version 0.7.0: Authentication and Account Dashboard
---------------------------------------------------

Version 0.7.0 added encrypted wallet persistence, user authentication, and a personal account dashboard with wallet balance, transaction history, active loans, copy tools, and CSV export for personal records.

Version 0.8.0: Node Registry and Block Explorer
-----------------------------------------------

Version 0.8.0 added the public node registry, the improved block explorer with address search and transaction lookup, and GitHub Pages deployment for the public Vorliq landing page and documentation.

Version 0.9.0: Logging and Health Monitoring
--------------------------------------------

Version 0.9.0 added comprehensive logging, route-level error handling, the node health dashboard, the setup guide, and the production deployment guide. This version made Vorliq easier to operate and troubleshoot.

Version 0.9.1: Mobile Design and Notifications
----------------------------------------------

Version 0.9.1 added mobile responsive design, dark and light mode, and the persistent in-app notification system. This version made the web application easier to use on phones and improved user awareness of important events.

Version 0.9.2: Test Suite and CI
--------------------------------

Version 0.9.2 added 30 Python tests, 3 backend tests, and GitHub Actions continuous integration. This version made the project safer to change by verifying core blockchain behavior, backend routes, and frontend builds automatically.

Version 0.9.3: Stress Testing and Network Robustness
----------------------------------------------------

Version 0.9.3 proved the network with a five node stress test covering chain sync, network partition recovery, and double spend prevention. It also strengthened diagnostics and validation for multi node operation.

Version 1.0.0: Official Release
-------------------------------

Version 1.0.0 delivered the React Native mobile application, push notifications, the decentralized VLQ exchange, and the community governance system with on-chain voting. This is the first complete release of the Vorliq platform and includes the full ecosystem of blockchain, web app, mobile app, lending, exchange, governance, peer networking, monitoring, tests, documentation, and community launch materials.
