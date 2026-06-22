# Joining the Vorliq network as a node operator

This guide walks a technically competent operator through bringing up a second
(or third, or hundredth) Vorliq node on a fresh VPS and joining the existing
network. A joining node automatically discovers the network's peers, downloads
and validates the canonical (longest valid) chain, starts participating, and
keeps itself in sync — you only need to set a handful of environment variables.

It assumes you can use a Linux shell, install packages, and edit a systemd unit.
You do **not** need to understand the consensus internals.

---

## 1. What a Vorliq node is

A Vorliq node is the Flask blockchain service in `blockchain/` (it listens on port
`5001` by default, bound to localhost behind nginx). Optionally you also run the
Node.js backend (`backend/`, port `5000`) and serve the frontend, but **only the
Flask service is required to participate in the chain.** This guide covers the
Flask node.

Each node keeps its own copy of the chain on disk and stays in agreement with the
rest of the network through peer-to-peer sync: the longest valid chain wins.

---

## 2. Prerequisites

- A fresh VPS (1 vCPU / 1 GB RAM is enough to start) running a recent Ubuntu.
- Python 3.11+ and `git`.
- Outbound HTTPS to the existing nodes (e.g. `https://node.vorliq.org`).
- A **wallet address** for this node. Create one in the Vorliq web app (it gives
  you an address plus an encrypted backup), or generate one with the project's
  wallet module. This address receives the mining rewards your node earns and is
  what the in-process fallback miner mines to. Keep its backup safe; the node only
  ever needs the **address**, never the private key.

```bash
git clone https://github.com/vorliq/Vorliq.git /home/vorliq/app
cd /home/vorliq/app/blockchain
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

---

## 3. Environment variables you must set

These are the variables that matter for joining and staying alive. Set them in the
systemd unit (see step 4) or an `EnvironmentFile`.

| Variable | Required | Example | What it does |
| --- | --- | --- | --- |
| `VORLIQ_BOOTSTRAP_PEERS` | Yes | `https://node.vorliq.org` | Comma-separated peer URLs to "point at the network". On startup the node registers these, discovers the rest of the network from them, and downloads the canonical chain. |
| `VORLIQ_NODE_URL` | Yes | `https://node2.example.org` | The public URL **other nodes** use to reach you. Must be reachable from the network or peers cannot sync from you or peer back. |
| `VORLIQ_SERVER_WALLET_ADDRESS` | Yes | `3b4nSHpLjMDSXqskDYj7py8kprna` | The wallet the in-process fallback miner mines to. If unset, the node falls back to `VORLIQ_NODE_OPERATOR_WALLET`; if neither is set the fallback miner stays idle and your node only validates, never mines. |
| `VORLIQ_MINING_ENABLED` | Yes | `true` | Must be `true` for this node to mine (the code default is fail-closed `false`). |
| `VORLIQ_HOST` | Yes | `127.0.0.1` | Bind address. Keep `127.0.0.1` and put nginx/TLS in front (see `deployment/vorliq_nginx_ssl.conf`). |
| `VORLIQ_PORT` | No | `5001` | Flask port (default `5001`). |
| `VORLIQ_DATA_DIR` | Yes | `/home/vorliq/app/blockchain/data` | Where the chain and indexes are stored. |
| `VORLIQ_NETWORK_SYNC_INTERVAL` | No | `300` | Seconds between automatic re-syncs (default 300 = 5 min). |
| `VORLIQ_BACKGROUND_MINER_INTERVAL` | No | `35` | Seconds between fallback-miner cycles (default 35). |
| `NODE_ENV` | Yes | `production` | Set to `production` on a real deployment. (Leave unset only for local testing, where loopback peers are allowed.) |

You do **not** set the chain into existence — joining downloads it.

---

## 4. systemd unit

`deployment/configure_server.sh` writes a ready-made unit. For a joining node, the
blockchain unit's `[Service]` block should contain (adjust values):

```ini
[Service]
Type=simple
User=vorliq
Group=vorliq
WorkingDirectory=/home/vorliq/app/blockchain
Environment=VORLIQ_HOST=127.0.0.1
Environment=VORLIQ_PORT=5001
Environment=VORLIQ_DATA_DIR=/home/vorliq/app/blockchain/data
Environment=NODE_ENV=production
Environment=VORLIQ_MINING_ENABLED=true
Environment=VORLIQ_NODE_URL=https://YOUR-NODE-DOMAIN
Environment=VORLIQ_BOOTSTRAP_PEERS=https://node.vorliq.org
Environment=VORLIQ_SERVER_WALLET_ADDRESS=YOUR_WALLET_ADDRESS
ExecStart=/home/vorliq/app/blockchain/.venv/bin/python app.py
Restart=on-failure
RestartSec=5
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now vorliq-blockchain.service
sudo journalctl -u vorliq-blockchain -f
```

In the logs you should see, in order:

```
Network join thread started (bootstrap: ['https://node.vorliq.org'])
Longer valid chain found from https://node.vorliq.org with N blocks
Chain validation passed for N blocks
Network join: adopted a longer canonical chain; height is now N-1
Announced local node https://YOUR-NODE-DOMAIN to peer https://node.vorliq.org
Background fallback miner active; mining to YOUR_WALLET_ADDRESS ...
```

That sequence means you discovered the network, downloaded and **fully validated**
the canonical chain (every hash, proof of work, link, and the balance/signature
ledger), adopted it, told the network you exist, and started participating.

---

## 5. Register your node (optional but recommended)

Joining the chain does not require registration; registration just makes your node
**discoverable and visible** in the public registry and on the network page. From
the Vorliq web app, sign in with your node's wallet and use **Registry → register
your node**, providing your `VORLIQ_NODE_URL`. The network independently probes the
URL and confirms it advertises the same operator wallet before showing a verified
badge.

---

## 6. Verify your node is part of the network

Run these against your own node (replace the host):

```bash
# Your node's height should match the network's within a sync interval.
curl -s https://YOUR-NODE-DOMAIN/chain/summary | jq '.summary.block_height'

# Who you are peered with — the bootstrap peer (and anyone it told you about).
curl -s https://YOUR-NODE-DOMAIN/peers

# Liveness, mempool, and the background miner.
curl -s https://YOUR-NODE-DOMAIN/health | jq '{chain_health, last_block_age_seconds, background_miner}'
```

Then confirm an **existing** node sees you back: its `/peers` list should include
your `VORLIQ_NODE_URL` shortly after you announce (existing nodes register you when
you announce, and will sync from you when you are ahead).

A healthy node shows `chain_health: "ok"`, a `block_height` equal to the network's,
and `background_miner.running: true`.

---

## 7. If your chain falls behind

The node re-syncs automatically every `VORLIQ_NETWORK_SYNC_INTERVAL` seconds, so a
short outage heals on its own. To force it immediately:

```bash
# Pull the longest valid chain from your peers right now.
curl -s https://YOUR-NODE-DOMAIN/peers/sync | jq '{updated, message, chain_height}'
```

- `updated: true` — you adopted a longer valid chain from a peer.
- `updated: false, message: "Your chain is already the longest"` — you are current.

If sync never advances you:

1. Check you can reach a peer: `curl -s https://node.vorliq.org/chain/summary`.
2. Check your `/peers` is non-empty; if not, your `VORLIQ_BOOTSTRAP_PEERS` is wrong
   or unreachable. Fix it and restart.
3. Check the logs for `Rejected longer chain from ... failed ... validation` — that
   means a peer is serving an invalid chain; your node correctly refuses it.

A node never adopts an invalid chain: the longest chain only wins if it passes full
integrity validation, so a bad peer cannot corrupt you.

---

## 8. Why your node staying up matters

Every node runs an in-process fallback miner. As long as **at least one** node on
the network is up with mining enabled and a wallet configured, the chain keeps
producing blocks and pending transactions keep confirming, even when no member is
actively mining in the app. The more independent operators run nodes, the more
resilient and decentralised the network becomes.
