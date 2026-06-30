# Vorliq Operations Runbook

Operational reference for running Vorliq in production. Written for an engineer
who knows how to operate a Linux server but is new to this project.

Vorliq is a self-contained community blockchain platform with three runtime
components plus a reverse proxy. This document describes how they fit together,
how to operate them, and how to respond to incidents.

> Conventions: the production host runs Ubuntu with the application checked out
> at `/home/vorliq/app`. Service management is `systemd`. The reverse proxy is
> `nginx`. Commands below assume `sudo` where root is required. A local
> Docker-based topology is also provided via `docker-compose.yml` for
> development and self-hosted nodes — see `deployment/docker_setup.md`.

---

## 1. Architecture overview

```
                         ┌─────────────────────────────┐
   Browser ── HTTPS ───▶ │  nginx  (:80 → :443)        │
                         │  - serves frontend static    │
                         │  - proxies /api → backend     │
                         │  - proxies WebSocket upgrade  │
                         └───────────────┬──────────────┘
                                         │ http (loopback)
                                         ▼
                         ┌─────────────────────────────┐
                         │  Backend API (Express)  :5000│
                         │  - REST + Socket.IO          │
                         │  - JWT / wallet-signature auth│
                         └───────────────┬──────────────┘
                                         │ http (loopback / docker net)
                                         ▼
                         ┌─────────────────────────────┐
                         │  Blockchain node (Flask):5001│
                         │  - chain, mempool, mining     │
                         │  - persists to data dir       │
                         └───────────────┬──────────────┘
                                         │ P2P (peer registry / gossip)
                                         ▼
                                  Other Vorliq nodes
```

| Component | Tech | Port | Role |
|-----------|------|------|------|
| Frontend | React (CRA) static build, served by nginx | 80/443 | User-facing web app |
| Backend API | Node.js / Express + Socket.IO | 5000 | REST API, real-time events, auth, proxy to node |
| Blockchain node | Python / Flask | 5001 | Chain state, mempool, mining, P2P |
| Reverse proxy | nginx | 80/443 | TLS termination, static serving, API/WS proxy |

Only nginx is publicly exposed. The backend (5000) and blockchain node (5001)
listen on loopback / the internal docker network and must not be reachable from
the public internet (see §10 firewall).

---

## 2. Services and processes (production / systemd)

Systemd units (created by `deployment/setup_server.sh`):

- `vorliq-blockchain.service` — Flask blockchain node
- `vorliq-backend.service` — Express backend API
- `vorliq-heartbeat.service` + `vorliq-heartbeat.timer` — periodic node heartbeat
- `nginx.service` — reverse proxy

Common commands (replace `<svc>` with a unit above):

```bash
sudo systemctl status  <svc>      # is it running?
sudo systemctl start   <svc>
sudo systemctl stop    <svc>
sudo systemctl restart <svc>
sudo journalctl -u <svc> -n 200 --no-pager   # recent logs
sudo journalctl -u <svc> -f                  # follow logs
```

Configuration / locations:

- App code: `/home/vorliq/app`
- Blockchain data: `/home/vorliq/app/blockchain/data` (`VORLIQ_DATA_DIR`)
- Backend data: `/home/vorliq/app/backend/data`
- Backend env: `/home/vorliq/app/backend/.env`
- nginx site config: `deployment/vorliq_nginx_ssl.conf` (HTTPS) / `deployment/vorliq_nginx.conf` (HTTP bootstrap)
- Monitor log: `/var/log/vorliq-monitor.log`

### Local / docker topology

```bash
docker compose up -d      # build + start blockchain, backend, frontend
docker compose ps         # status
docker compose logs -f backend
docker compose down       # stop
```

Ports (docker): frontend `localhost:3000`, backend `:5000`, blockchain `:5001`.

---

## 3. Deployment

### Automatic (CI/CD)

Pushing to `main` triggers GitHub Actions:

- `.github/workflows/ci.yml` — blockchain tests, backend tests, frontend build,
  PostgreSQL shadow-migration checks. Must pass.
- `.github/workflows/deploy.yml` — deploys on success.

Treat every commit to `main` as production. Do not push unless all suites pass
locally (see §12).

### Manual deploy / update

On the server:

```bash
sudo /home/vorliq/app/deployment/update_server.sh
```

`update_server.sh` pulls the latest code, reinstalls Python/Node dependencies
only if `requirements.txt` / backend deps changed, and restarts the services.

### Verify a deployment

```bash
curl -fsS https://vorliq.org/api/health        # backend up
curl -fsS https://vorliq.org/api/health/ready  # backend + blockchain ready
```

### Roll back

Roll back by reverting the offending commit and pushing (CI redeploys):

```bash
git revert <bad_sha>
git push origin main
```

For an urgent server-side rollback, check out the previous known-good tag/commit
in `/home/vorliq/app` and run `update_server.sh`. Always take a backup first (§7).

---

## 4. Health and status endpoints

| Endpoint | Meaning |
|----------|---------|
| `GET /api/health` | Backend liveness (200 = process up) |
| `GET /api/health/ready` | Readiness — backend + blockchain node reachable |
| `GET /api/security/status` | Security posture summary (CORS/headers/rate-limit flags) |
| `GET /api/version` | Version metadata |
| Node `GET /health` (5001) | Blockchain node liveness (internal) |

---

## 5. Environment variables

Secrets are never committed. `.env` files are gitignored; only `*.env.example`
templates are tracked.

| Variable | Component | Required | Description | Example |
|----------|-----------|----------|-------------|---------|
| `FLASK_URL` | backend | yes | URL of the blockchain node | `http://localhost:5001` |
| `JWT_SECRET` | backend | yes (rotate) | Signing secret for issued JWTs | _random 48-byte base64_ |
| `NODE_ENV` | backend | yes | Runtime mode | `production` |
| `PORT` | backend | no | Backend listen port (default 5000) | `5000` |
| `VORLIQ_HOST` | blockchain | no | Bind host | `0.0.0.0` |
| `VORLIQ_PORT` | blockchain | no | Node port (default 5001) | `5001` |
| `VORLIQ_DATA_DIR` | blockchain | yes | Chain/data persistence dir | `/home/vorliq/app/blockchain/data` |
| `VORLIQ_MINING_ENABLED` | blockchain | no | Keep producing blocks | `true` |
| `VORLIQ_SERVER_WALLET_ADDRESS` | blockchain | no | Fallback miner payout wallet | _wallet address_ |
| `RESEND_API_KEY` | backend (mailer) | if email used | Resend transactional email key | _rotate; never commit_ |

See `backend/.env.example` and `database/.env.shadow.example` for the canonical
templates. The blockchain node reads `VORLIQ_*` from the environment / systemd
unit; see `docker-compose.yml` for the full set.

---

## 6. Secrets rotation

| Secret | Generate | Apply | Restart |
|--------|----------|-------|---------|
| `JWT_SECRET` | `openssl rand -base64 48` | `backend/.env` (and CI secret store) | `vorliq-backend.service` |
| `RESEND_API_KEY` | Resend dashboard | `backend/.env` / CI secret store | `vorliq-backend.service` |

After updating `backend/.env`, restart the backend:
`sudo systemctl restart vorliq-backend.service`. Rotating `JWT_SECRET`
invalidates all existing JWTs (users re-authenticate).

---

## 7. Backup and recovery

Backups are produced by `deployment/backup.sh` (run via cron/timer):

- Output: `/home/vorliq/backups/vorliq-backup-<timestamp>.tar.gz`
- Retention: `VORLIQ_BACKUP_RETENTION_DAYS` (default 14 days)
- Contents: blockchain data dir + backend data dir
- Log: `/home/vorliq/backups/backup.log`

Run a backup manually:

```bash
sudo /home/vorliq/app/deployment/backup.sh
```

Restore from a backup archive:

```bash
sudo /home/vorliq/app/deployment/restore_backup.sh /home/vorliq/backups/vorliq-backup-<ts>.tar.gz
```

Verify a backup archive:

```bash
sudo /home/vorliq/app/deployment/verify_backup.sh /home/vorliq/backups/vorliq-backup-<ts>.tar.gz
```

Store backups off-server as well (the data dir is the source of truth for the
chain). Test restores periodically on a non-production host.

---

## 8. Monitoring and alerting

`deployment/monitor.sh` (run on a timer) checks the public health URL
(`VORLIQ_PUBLIC_HEALTH_URL`, default `https://vorliq.org/api/health`) and the
core systemd services, restarting and alerting on failure.

- Watched services: `vorliq-blockchain`, `vorliq-backend`, `vorliq-heartbeat`,
  `vorliq-heartbeat.timer`, `nginx`
- Log: `/var/log/vorliq-monitor.log`
- Alerts: `deployment/alert.sh` (`VORLIQ_ALERT_SCRIPT`)

A healthy response from `/api/health` is HTTP 200 with a JSON body. Investigate
any non-200 or timeout immediately (§11).

---

## 9. Common operations

```bash
# Application logs
sudo journalctl -u vorliq-backend.service -n 200 --no-pager
sudo journalctl -u vorliq-blockchain.service -n 200 --no-pager

# Monitor log
sudo tail -n 100 /var/log/vorliq-monitor.log

# Backend ↔ blockchain connectivity
curl -fsS http://localhost:5000/api/health/ready

# Blockchain node status / sync (internal)
curl -fsS http://localhost:5001/health
curl -fsS http://localhost:5001/chain/summary

# Mempool (pending transactions)
curl -fsS http://localhost:5001/transactions/pending

# Peer count / registry
curl -fsS http://localhost:5001/registry/summary
```

---

## 10. Network / firewall

- Public: `80`, `443`, and the SSH port only.
- Backend `5000` and blockchain `5001` must NOT be publicly reachable — they are
  consumed via nginx / the loopback interface only.
- The blockchain P2P/registry surface is access-controlled via the node registry;
  do not expose the raw node port to the public internet.

---

## 11. Incident response

**Backend down** (`/api/health` failing):
1. `sudo systemctl status vorliq-backend.service`
2. `sudo journalctl -u vorliq-backend.service -n 200 --no-pager`
3. `sudo systemctl restart vorliq-backend.service`
4. If it crashes on boot, check `backend/.env` (missing `JWT_SECRET`/`FLASK_URL`).

**Blockchain node down** (`/api/health/ready` failing, `/health` on 5001 down):
1. `sudo systemctl status vorliq-blockchain.service`
2. `sudo journalctl -u vorliq-blockchain.service -n 200 --no-pager`
3. `sudo systemctl restart vorliq-blockchain.service`
4. If data appears corrupt, restore from the latest verified backup (§7).

**Database unreachable** (PostgreSQL adapter deployments):
1. Confirm the DB service is up and the connection string is correct.
2. Vorliq's default storage is file-based (`VORLIQ_DATA_DIR`); the PostgreSQL
   adapter is opt-in (see `docs/postgres-readiness.html`). Confirm which storage
   backend this deployment uses before acting.

**Secret compromised** (e.g., a key was leaked):
1. Rotate it immediately (§6).
2. For `JWT_SECRET`, rotation forces re-authentication of all users.
3. For `RESEND_API_KEY`, revoke the old key in the Resend dashboard.
4. Audit access logs for misuse.

---

## 12. Pre-push verification checklist

Before pushing to `main` (which deploys):

```bash
# Blockchain — expect 290 passed, 6 skipped, 0 failed
cd blockchain && .venv/Scripts/python -m pytest tests/ -q

# Backend — expect 370 passed, 0 failed
cd backend && npm test

# Frontend — expect a clean production build
cd frontend && npm run build

# Backend dependency audit — expect 0 vulnerabilities
cd backend && npm audit

# Blockchain dependency audit — expect "No known vulnerabilities found"
cd blockchain && .venv/Scripts/python -m pip_audit -r requirements.txt
```

### Browser accessibility / responsive audit

Real-browser audit via Playwright (Chromium) over the served build. Bring up the
full stack, serve the build, then run the audits:

```bash
# 1. node:5001, backend:5000 up; serve the SPA build on localhost:
cd e2e && E2E_STATIC_PORT=4178 node static-server.js &

# 2. Per-route viewport overflow (320/375/768/1024/1440px), touch targets, focus:
cd e2e && AUDIT_BASE=http://127.0.0.1:4178 AUDIT_API=http://localhost:5000/api npm run audit:browser

# 3. Error / empty-state degradation (API intercepted; backend not required):
cd e2e && AUDIT_BASE=http://127.0.0.1:4178 node browser-state-audit.js
```

`audit:browser` writes `e2e/audit-results/summary.json` plus failure screenshots
(gitignored). The app is pointed at the local backend via a `vorliq_node_url`
localStorage override injected by the script. See `BROWSER_AUDIT_NEEDED.md` for
the checklist these cover and what still needs a funded wallet.

---

## 13. Related documentation

- `deployment/NODE_OPERATOR_GUIDE.md` — running a self-hosted node
- `deployment/EMAIL_SETUP.md` — transactional email (Resend) setup
- `deployment/docker_setup.md` — docker-based deployment
- `docs/operator.html`, `docs/deploy.html`, `docs/recovery.html` — public operator docs
- `README.md` — project overview and local development
- `CHANGELOG.md` — release history
