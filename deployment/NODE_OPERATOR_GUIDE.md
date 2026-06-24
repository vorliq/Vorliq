# Joining the Vorliq network as a node operator

This guide takes you, step by step, from a brand-new VPS to a running Vorliq node
that has joined the network, downloaded and validated the chain, and started
participating. A joining node discovers the network's peers, adopts the canonical
(longest valid) chain, and keeps itself in sync automatically — you set a handful
of environment variables and put a reverse proxy in front of it.

It assumes you can use a Linux shell, edit files with `nano`/`vim`, and point a DNS
record at a server. It does **not** assume you know anything about the Vorliq
consensus internals. Every step ends with a way to check it worked.

Throughout, replace `node2.example.org` with **your** node's public domain and
`YOUR_WALLET_ADDRESS` with the address you create in step 2.4.

---

## 1. What a Vorliq node is

A Vorliq node is the Flask blockchain service in `blockchain/`. It listens on port
`5001`, bound to `127.0.0.1`, with nginx terminating TLS in front of it. You can
also run the Node.js backend (`backend/`, port `5000`) and the frontend, but
**only the Flask service is required to participate in the chain** — that is what
this guide sets up.

Each node keeps its own copy of the chain on disk and agrees with the rest of the
network through peer-to-peer sync: the longest chain that passes full validation
wins. Every node also runs an in-process fallback miner, so as long as one node is
up the chain keeps producing blocks.

---

## 2. Prepare the server

### 2.1 A fresh VPS

- 1 vCPU / 1 GB RAM and a recent Ubuntu (22.04+) is enough to start.
- A **domain name** you control, with an A record pointing at the VPS IP (e.g.
  `node2.example.org → 203.0.113.10`). Other nodes reach you at `https://` + this
  domain, so it must resolve publicly before you finish.

### 2.2 Install the basics

```bash
sudo apt update
sudo apt install -y git python3 python3-venv python3-pip nginx jq
```

`jq` is only used for the verification commands below; skip it if you prefer to
read raw JSON.

### 2.3 Create the service user and fetch the code

The node runs as a dedicated unprivileged `vorliq` user (the systemd unit uses
`User=vorliq`), so create it and install the code under its home:

```bash
sudo useradd --system --create-home --home-dir /home/vorliq --shell /usr/sbin/nologin vorliq
sudo -u vorliq git clone https://github.com/vorliq/Vorliq.git /home/vorliq/app
cd /home/vorliq/app/blockchain
sudo -u vorliq python3 -m venv .venv
sudo -u vorliq .venv/bin/pip install -r requirements.txt
```

**Check:** `sudo -u vorliq /home/vorliq/app/blockchain/.venv/bin/python -c "import flask; print('ok')"`
prints `ok`.

### 2.4 Create the node's wallet address

Your node needs one wallet **address**. It receives the mining rewards your node
earns and is what the fallback miner mines to. Generate one with the project's
wallet module:

```bash
cd /home/vorliq/app/blockchain
sudo -u vorliq .venv/bin/python -c "from wallet import Wallet; print(Wallet().address)"
```

Copy the printed address — that is your `YOUR_WALLET_ADDRESS`. The node only ever
needs the address, never a private key, so there is nothing secret to store on the
server. (If you want to be able to *spend* those rewards later, create the wallet
in the Vorliq web app instead and keep its encrypted backup safe; use that
address here.)

---

## 3. Environment variables

These are the variables that matter. You will put them in the systemd unit in
step 5.

| Variable | Required | Example | What it does |
| --- | --- | --- | --- |
| `VORLIQ_BOOTSTRAP_PEERS` | Yes | `https://node.vorliq.org` | Comma-separated peer URLs that "point you at the network". On startup the node registers these, discovers other peers from them, and downloads the canonical chain. Use the official node, or any node you trust. |
| `VORLIQ_NODE_URL` | Yes | `https://node2.example.org` | The public HTTPS URL **other nodes** use to reach you. Must resolve and be reachable (step 4) or peers cannot sync from you. |
| `VORLIQ_SERVER_WALLET_ADDRESS` | Yes | `YOUR_WALLET_ADDRESS` | The wallet the fallback miner mines to (step 2.4). If unset, the node falls back to `VORLIQ_NODE_OPERATOR_WALLET`; if neither is set the fallback miner stays idle and your node validates but never mines. |
| `VORLIQ_MINING_ENABLED` | Yes | `true` | Must be `true` to mine. The code default is fail-closed `false`, so you must set it explicitly. |
| `VORLIQ_HOST` | Yes | `127.0.0.1` | Bind address. Keep `127.0.0.1`; nginx (step 4) is what faces the internet. |
| `VORLIQ_PORT` | No | `5001` | Flask port (default `5001`). |
| `VORLIQ_DATA_DIR` | Yes | `/home/vorliq/app/blockchain/data` | Where the chain and indexes are stored on disk. |
| `NODE_ENV` | Yes | `production` | Set to `production` on a real deployment. (Only leave it unset for local testing, where loopback peer URLs are allowed.) |
| `VORLIQ_NETWORK_SYNC_INTERVAL` | No | `300` | Seconds between automatic re-syncs (default 300 = 5 minutes). |
| `VORLIQ_BACKGROUND_MINER_INTERVAL` | No | `35` | Seconds between fallback-miner cycles (default 35). |

You never set the chain into existence — joining downloads and validates it.

### 3.1 Email notifications (optional, but needed for emails to actually send)

Vorliq can email members when something happens to them (VLQ received, a loan
funded or repaid, a governance proposal they voted on concluded), send a weekly
digest to members who opt in, and email the operator when a monitor detects a
problem (a stuck chain, an unreachable backend, low disk). **All of this is
turned on in the code already — but no email is actually sent until you give the
server an email provider to send through.** Until then, every email the system
*would* send is written to a log file instead (`backend/data/alerts.log` for
operator alerts, and the application log for member emails), so nothing breaks and
nothing is lost — it simply is not delivered to an inbox.

You enable real delivery by setting four environment variables (same place as the
ones above, plus `/etc/vorliq/backend.env` which both the Node backend and the
chain read). Email sending is **off** if any of the first three are blank.

| Variable | Required for email | Example | What it is, in plain words |
| --- | --- | --- | --- |
| `VORLIQ_EMAIL_API_URL` | Yes | `https://api.resend.com/emails` | The web address of the email company that actually delivers the mail. The one above is for Resend; if you use a different company, use the address from their "send an email" API documentation. |
| `VORLIQ_EMAIL_API_KEY` | Yes | `re_xxxxxxxxxxxxxxxx` | Your secret password/key from that email company. It proves the mail is coming from you. Keep it private — anyone with it can send mail as you. |
| `VORLIQ_EMAIL_FROM` | Yes | `Vorliq <notifications@yourdomain.com>` | The "from" address members see. It must be an address on a domain you have verified with the email company (they will not let you send from an address you do not own). |
| `VORLIQ_ALERT_EMAIL` | Only for operator alerts | `you@yourdomain.com` | Where the *operator* alerts (stuck chain, low disk, etc.) are sent. This is your own inbox, not a member's. |

**Step by step, using Resend (free tier is plenty to start):**

1. Go to `https://resend.com`, create an account, and verify the domain you want
   to send from (Resend walks you through adding a couple of DNS records at your
   domain registrar — this is what stops the mail going to spam).
2. In Resend, create an **API key** and copy it. It starts with `re_`.
3. On the server, open the environment file: `sudo nano /etc/vorliq/backend.env`.
4. Add these four lines (using your own key, domain, and inbox):

   ```bash
   VORLIQ_EMAIL_API_URL=https://api.resend.com/emails
   VORLIQ_EMAIL_API_KEY=re_your_real_key_here
   VORLIQ_EMAIL_FROM=Vorliq <notifications@yourdomain.com>
   VORLIQ_ALERT_EMAIL=you@yourdomain.com
   ```

5. Save the file, then restart both services so they pick up the new settings:

   ```bash
   sudo systemctl restart vorliq-backend vorliq-blockchain
   ```

6. **Check it works.** From a signed-in account, go to **Settings → Email
   notifications**, save an email address, and turn on an event (for example
   "VLQ received"). Then send that wallet a small amount from another wallet. When
   the next block confirms, you should get an email. If you don't, look in the
   application log for a line that says the email was *logged* instead of sent —
   that means one of the three `VORLIQ_EMAIL_*` values is still blank or wrong.

Any email company whose "send" API takes a JSON body of `from`, `to`, `subject`,
`text` and an `Authorization: Bearer <key>` header will work (Resend is the
simplest match); only the URL, key, and from-address change.

---

## 4. Make your node reachable (nginx + TLS + firewall)

Other nodes reach you over HTTPS at `VORLIQ_NODE_URL`, so the public port 443 must
terminate TLS and proxy to Flask on `127.0.0.1:5001`.

### 4.1 Open the firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable
```

### 4.2 nginx reverse proxy + TLS

The repo ships a template at `deployment/vorliq_nginx_ssl.conf`. The minimum a
joining node needs is a server block that proxies `/` to Flask:

```nginx
server {
    listen 443 ssl;
    server_name node2.example.org;

    # certificates from certbot (below)
    ssl_certificate     /etc/letsencrypt/live/node2.example.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/node2.example.org/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:5001;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Get a certificate (this also configures nginx for you):

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d node2.example.org
sudo systemctl reload nginx
```

**Check:** from your laptop, `curl -s https://node2.example.org/health` returns
JSON (not an nginx error). It is fine if the chain is still empty at this point —
you have not started the node yet.

---

## 5. Run the node (systemd)

Create `/etc/systemd/system/vorliq-blockchain.service` (the repo's
`deployment/configure_server.sh` writes an equivalent for the official server;
this is the minimal unit for a joining node):

```ini
[Unit]
Description=Vorliq Blockchain Node
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=vorliq
Group=vorliq
WorkingDirectory=/home/vorliq/app/blockchain
Environment=NODE_ENV=production
Environment=VORLIQ_HOST=127.0.0.1
Environment=VORLIQ_PORT=5001
Environment=VORLIQ_DATA_DIR=/home/vorliq/app/blockchain/data
Environment=VORLIQ_MINING_ENABLED=true
Environment=VORLIQ_NODE_URL=https://node2.example.org
Environment=VORLIQ_BOOTSTRAP_PEERS=https://node.vorliq.org
Environment=VORLIQ_SERVER_WALLET_ADDRESS=YOUR_WALLET_ADDRESS
ExecStart=/home/vorliq/app/blockchain/.venv/bin/python app.py
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Start it and watch the logs:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now vorliq-blockchain.service
sudo journalctl -u vorliq-blockchain -f
```

In the log you should see, in order:

```text
Network join thread started (bootstrap: ['https://node.vorliq.org'])
Longer valid chain found from https://node.vorliq.org with N blocks
Chain validation passed for N blocks
Network join: adopted a longer canonical chain; height is now N-1
Announced local node https://node2.example.org to peer https://node.vorliq.org
Background fallback miner active; mining to YOUR_WALLET_ADDRESS ...
```

That sequence means you discovered the network, downloaded and **fully validated**
the canonical chain (every hash, proof of work, link, and the balance/signature
ledger), adopted it, told the network you exist, and started participating.

Useful service commands: `sudo systemctl status vorliq-blockchain`,
`sudo systemctl restart vorliq-blockchain`, `sudo systemctl stop vorliq-blockchain`.

---

## 6. Register your node (recommended)

Joining the chain does not require registration; registration makes your node
**visible and verifiable** in the public registry, the Network page, and the admin
dashboard. From the Vorliq web app, sign in with your node's wallet and use
**Registry → register your node**, entering your `VORLIQ_NODE_URL`. The network
then probes your URL and, if the node advertises the same operator wallet you
signed with, marks your operator identity as cryptographically **Verified** (a
signed claim alone is not enough — the independent probe must match).

**Check:** in the web app's **Admin → Registry Lifecycle** panel (or the public
**Network** page) your node appears with its operator wallet, a **Verified** badge,
a **reachable** status, a sync status, and a recent last-heartbeat time.

---

## 7. Verify your node is part of the network

Run these against your own node:

```bash
# Your height should match the network's within a sync interval.
curl -s https://node2.example.org/chain/summary | jq '.summary.block_height'

# Who you are peered with (the bootstrap peer, plus anyone it told you about).
curl -s https://node2.example.org/peers

# Liveness, mempool, and the fallback miner.
curl -s https://node2.example.org/health | jq '{chain_health, last_block_age_seconds, background_miner}'
```

A healthy node shows `chain_health: "ok"`, a `block_height` equal to the network's,
and `background_miner.running: true`.

Then confirm an **existing** node sees you back: `curl -s https://node.vorliq.org/peers`
should list `https://node2.example.org` within a minute of your node announcing
itself.

---

## 8. If your chain falls behind

The node re-syncs automatically every `VORLIQ_NETWORK_SYNC_INTERVAL` seconds, so a
brief outage heals on its own. To force a sync now:

```bash
curl -s https://node2.example.org/peers/sync | jq '{updated, message, chain_height}'
```

- `updated: true` — you adopted a longer valid chain from a peer.
- `updated: false, message: "Your chain is already the longest"` — you are current.

If sync never advances you:

1. Confirm you can reach a peer: `curl -s https://node.vorliq.org/chain/summary`.
2. Confirm your `/peers` list is non-empty. If it is empty, `VORLIQ_BOOTSTRAP_PEERS`
   is wrong or unreachable — fix it and `sudo systemctl restart vorliq-blockchain`.
3. Look in the logs for `Rejected longer chain from ... failed ... validation` —
   that means a peer served an invalid chain and your node correctly refused it.
   Your chain is not corrupted; a bad peer cannot take you over, because the
   longest chain only wins if it passes full validation.

---

## 9. Why keeping your node up matters

Every node runs the in-process fallback miner. As long as **at least one** node is
up with mining enabled and a wallet configured, the chain keeps producing blocks
and pending transactions keep confirming, even when no member is actively mining in
the app. The more independent operators run nodes, the more resilient and
decentralised the network becomes.
