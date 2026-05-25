#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Please run this script as root with sudo."
  exit 1
fi

SERVER_IP="$(hostname -I | awk '{print $1}')"

mkdir -p /etc/vorliq
GENERATED_ADMIN_TOKEN=""
if [[ ! -f /etc/vorliq/backend.env ]] || ! grep -q '^ADMIN_TOKEN=' /etc/vorliq/backend.env; then
  BACKEND_ENV_TMP="$(mktemp)"
  if [[ -f /etc/vorliq/backend.env ]]; then
    grep -v '^ADMIN_TOKEN=' /etc/vorliq/backend.env > "${BACKEND_ENV_TMP}" || true
  fi
  GENERATED_ADMIN_TOKEN="$(openssl rand -hex 32)"
  printf 'ADMIN_TOKEN=%s\n' "${GENERATED_ADMIN_TOKEN}" >> "${BACKEND_ENV_TMP}"
  install -o root -g root -m 600 "${BACKEND_ENV_TMP}" /etc/vorliq/backend.env
  rm -f "${BACKEND_ENV_TMP}"
else
  chmod 600 /etc/vorliq/backend.env
fi

cat >/etc/systemd/system/vorliq-blockchain.service <<'SERVICE'
[Unit]
Description=Vorliq Blockchain API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=vorliq
Group=vorliq
WorkingDirectory=/home/vorliq/app/blockchain
Environment=VORLIQ_HOST=0.0.0.0
Environment=VORLIQ_PORT=5001
Environment=VORLIQ_DATA_DIR=/home/vorliq/app/blockchain/data
Environment=NODE_ENV=production
ExecStart=/home/vorliq/app/blockchain/.venv/bin/python app.py
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICE

cat >/etc/systemd/system/vorliq-backend.service <<'SERVICE'
[Unit]
Description=Vorliq Backend API
After=network-online.target vorliq-blockchain.service
Wants=network-online.target
Requires=vorliq-blockchain.service

[Service]
Type=simple
User=vorliq
Group=vorliq
WorkingDirectory=/home/vorliq/app/backend
EnvironmentFile=-/etc/vorliq/backend.env
Environment=NODE_ENV=production
Environment=PORT=5000
Environment=FLASK_URL=http://127.0.0.1:5001
ExecStart=/usr/bin/node index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICE

cat >/etc/systemd/system/vorliq-heartbeat.service <<SERVICE
[Unit]
Description=Vorliq Public Registry Heartbeat
After=network-online.target vorliq-blockchain.service vorliq-backend.service
Wants=network-online.target
Requires=vorliq-blockchain.service vorliq-backend.service
StartLimitIntervalSec=0

[Service]
Type=simple
User=vorliq
Group=vorliq
WorkingDirectory=/home/vorliq/app/backend
Environment=NODE_ENV=production
Environment=HEARTBEAT_API_URL=http://127.0.0.1:5000
Environment=FLASK_URL=http://127.0.0.1:5001
Environment=VORLIQ_NODE_URL=https://node.vorliq.org
Environment="VORLIQ_NODE_NAME=Vorliq Public Node"
Environment=VORLIQ_NODE_REGION=London
Environment="VORLIQ_NODE_COUNTRY=United Kingdom"
Environment=VORLIQ_HEARTBEAT_INTERVAL_MS=300000
ExecStart=/usr/bin/node heartbeat.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICE

cat >/etc/systemd/system/vorliq-heartbeat-once.service <<SERVICE
[Unit]
Description=Vorliq Public Registry Heartbeat Once
After=network-online.target vorliq-blockchain.service vorliq-backend.service
Wants=network-online.target
Requires=vorliq-blockchain.service vorliq-backend.service

[Service]
Type=oneshot
User=vorliq
Group=vorliq
WorkingDirectory=/home/vorliq/app/backend
Environment=NODE_ENV=production
Environment=HEARTBEAT_API_URL=http://127.0.0.1:5000
Environment=FLASK_URL=http://127.0.0.1:5001
Environment=VORLIQ_NODE_URL=https://node.vorliq.org
Environment="VORLIQ_NODE_NAME=Vorliq Public Node"
Environment=VORLIQ_NODE_REGION=London
Environment="VORLIQ_NODE_COUNTRY=United Kingdom"
ExecStart=/usr/bin/node heartbeat.js --once
SERVICE

cat >/etc/systemd/system/vorliq-heartbeat.timer <<SERVICE
[Unit]
Description=Run Vorliq public registry heartbeat every five minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
AccuracySec=30s
Persistent=true
Unit=vorliq-heartbeat-once.service

[Install]
WantedBy=timers.target
SERVICE

cat >/etc/systemd/system/vorliq-miner.service <<SERVICE
[Unit]
Description=Vorliq Controlled Public Node Miner
After=network-online.target vorliq-blockchain.service vorliq-backend.service
Wants=network-online.target
Requires=vorliq-blockchain.service vorliq-backend.service

[Service]
Type=simple
User=vorliq
Group=vorliq
WorkingDirectory=/home/vorliq/app/backend
Environment=NODE_ENV=production
Environment=PUBLIC_MINER_API_URL=http://127.0.0.1:5000
Environment=VORLIQ_PUBLIC_MINER_ENABLED=${VORLIQ_PUBLIC_MINER_ENABLED:-false}
Environment=VORLIQ_PUBLIC_MINER_ADDRESS=${VORLIQ_PUBLIC_MINER_ADDRESS:-}
ExecStart=/usr/bin/node miner.js
Restart=on-failure
RestartSec=15

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable vorliq-blockchain.service vorliq-backend.service vorliq-heartbeat.service vorliq-heartbeat.timer
if [[ "${VORLIQ_PUBLIC_MINER_ENABLED:-false}" == "true" && -n "${VORLIQ_PUBLIC_MINER_ADDRESS:-}" ]]; then
  systemctl enable vorliq-miner.service
else
  systemctl disable vorliq-miner.service >/dev/null 2>&1 || true
fi
systemctl restart vorliq-blockchain.service
systemctl restart vorliq-backend.service
for attempt in 1 2 3 4 5; do
  if curl -fsS http://127.0.0.1:5000/api/health >/dev/null 2>&1; then
    break
  fi
  sleep 3
done
systemctl restart vorliq-heartbeat.service
systemctl start vorliq-heartbeat-once.service || true
systemctl restart vorliq-heartbeat.timer
if [[ "${VORLIQ_PUBLIC_MINER_ENABLED:-false}" == "true" && -n "${VORLIQ_PUBLIC_MINER_ADDRESS:-}" ]]; then
  systemctl restart vorliq-miner.service
fi

for service in vorliq-blockchain.service vorliq-backend.service vorliq-heartbeat.service; do
  if systemctl is-active --quiet "${service}"; then
    echo "${service} is running."
  else
    echo "${service} failed to start."
    systemctl status "${service}" --no-pager || true
  fi
done

if systemctl is-enabled --quiet vorliq-miner.service; then
  systemctl is-active --quiet vorliq-miner.service && echo "vorliq-miner.service is running." || systemctl status vorliq-miner.service --no-pager || true
else
  echo "vorliq-miner.service installed but disabled. Set VORLIQ_PUBLIC_MINER_ENABLED=true and VORLIQ_PUBLIC_MINER_ADDRESS to enable controlled public node mining."
fi

mkdir -p /home/vorliq/backups
chown -R vorliq:vorliq /home/vorliq/backups
cp /home/vorliq/app/deployment/backup.sh /home/vorliq/backup.sh
chmod 750 /home/vorliq/backup.sh
chown root:vorliq /home/vorliq/backup.sh
cp /home/vorliq/app/deployment/alert.sh /home/vorliq/alert.sh
chmod 750 /home/vorliq/alert.sh
chown root:vorliq /home/vorliq/alert.sh
cp /home/vorliq/app/deployment/monitor.sh /home/vorliq/monitor.sh
chmod 750 /home/vorliq/monitor.sh
chown root:vorliq /home/vorliq/monitor.sh
chmod 750 /home/vorliq/app/backend/maintenance.js
printf '15 2 * * * root /home/vorliq/backup.sh >/dev/null 2>&1\n' >/etc/cron.d/vorliq-backup
chmod 644 /etc/cron.d/vorliq-backup
printf '*/5 * * * * root /home/vorliq/monitor.sh >/dev/null 2>&1\n' >/etc/cron.d/vorliq-monitor
chmod 644 /etc/cron.d/vorliq-monitor
printf '*/15 * * * * root set -a; . /etc/vorliq/backend.env 2>/dev/null || true; set +a; cd /home/vorliq/app/backend && /usr/bin/node maintenance.js >/dev/null 2>&1\n' >/etc/cron.d/vorliq-maintenance
chmod 644 /etc/cron.d/vorliq-maintenance

if [ -f /etc/letsencrypt/live/vorliq.org/fullchain.pem ] && [ -f /etc/letsencrypt/live/vorliq.org/privkey.pem ]; then
  CERT_DOMAIN=vorliq.org
  sed "s#/etc/letsencrypt/live/vorliq.org#/etc/letsencrypt/live/${CERT_DOMAIN}#g" /home/vorliq/app/deployment/vorliq_nginx_ssl.conf > /etc/nginx/sites-available/vorliq
elif [ -f /etc/letsencrypt/live/status.vorliq.org/fullchain.pem ] && [ -f /etc/letsencrypt/live/status.vorliq.org/privkey.pem ]; then
  CERT_DOMAIN=status.vorliq.org
  sed "s#/etc/letsencrypt/live/vorliq.org#/etc/letsencrypt/live/${CERT_DOMAIN}#g" /home/vorliq/app/deployment/vorliq_nginx_ssl.conf > /etc/nginx/sites-available/vorliq
else
  cp /home/vorliq/app/deployment/vorliq_nginx.conf /etc/nginx/sites-available/vorliq
fi

ln -sfn /etc/nginx/sites-available/vorliq /etc/nginx/sites-enabled/vorliq
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl restart nginx

echo "Configuration complete. Your Vorliq node is running."
if [[ -n "${GENERATED_ADMIN_TOKEN}" ]]; then
  echo "A new Vorliq ADMIN_TOKEN was generated. Save it securely now; it will not be shown again:"
  echo "${GENERATED_ADMIN_TOKEN}"
fi
echo "Server IP address:"
hostname -I
