#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Please run this script as root with sudo."
  exit 1
fi

cd /home/vorliq/app

OLD_REQUIREMENTS_HASH=""
OLD_BACKEND_HASH=""

if [[ -f blockchain/requirements.txt ]]; then
  OLD_REQUIREMENTS_HASH="$(sha256sum blockchain/requirements.txt | awk '{print $1}')"
fi

if [[ -f backend/package.json ]]; then
  OLD_BACKEND_HASH="$(sha256sum backend/package.json | awk '{print $1}')"
fi

sudo -u vorliq -H git fetch origin
sudo -u vorliq -H git reset --hard origin/main

NEW_REQUIREMENTS_HASH="$(sha256sum blockchain/requirements.txt | awk '{print $1}')"
NEW_BACKEND_HASH="$(sha256sum backend/package.json | awk '{print $1}')"

if [[ "${OLD_REQUIREMENTS_HASH}" != "${NEW_REQUIREMENTS_HASH}" ]]; then
  sudo -u vorliq -H bash -c "cd /home/vorliq/app/blockchain && . .venv/bin/activate && pip install -r requirements.txt"
fi

if [[ "${OLD_BACKEND_HASH}" != "${NEW_BACKEND_HASH}" ]]; then
  sudo -u vorliq -H bash -c "cd /home/vorliq/app/backend && npm install"
fi

sudo -u vorliq -H bash -c "cd /home/vorliq/app/frontend && npm install && npm run build"

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

if ! grep -q '^EnvironmentFile=-/etc/vorliq/backend.env' /etc/systemd/system/vorliq-backend.service; then
  sed -i '/WorkingDirectory=\/home\/vorliq\/app\/backend/a EnvironmentFile=-/etc/vorliq/backend.env' /etc/systemd/system/vorliq-backend.service
  systemctl daemon-reload
fi

if [[ -f /etc/systemd/system/vorliq-heartbeat.service ]]; then
  sed -i 's/^After=network-online.target vorliq-blockchain.service.*/After=network-online.target vorliq-blockchain.service vorliq-backend.service/' /etc/systemd/system/vorliq-heartbeat.service
  sed -i 's/^Requires=vorliq-blockchain.service.*/Requires=vorliq-blockchain.service vorliq-backend.service/' /etc/systemd/system/vorliq-heartbeat.service
  sed -i '/^Environment=LOCAL_NODE_URL=/d' /etc/systemd/system/vorliq-heartbeat.service
  sed -i '/^Environment=NODE_DISPLAY_NAME=/d' /etc/systemd/system/vorliq-heartbeat.service
  sed -i '/^Environment=HEARTBEAT_API_URL=/d' /etc/systemd/system/vorliq-heartbeat.service
  sed -i '/^Environment=VORLIQ_NODE_URL=/d' /etc/systemd/system/vorliq-heartbeat.service
  sed -i '/^Environment="VORLIQ_NODE_NAME=/d' /etc/systemd/system/vorliq-heartbeat.service
  sed -i '/^Environment=VORLIQ_NODE_NAME=/d' /etc/systemd/system/vorliq-heartbeat.service
  sed -i '/^Environment=VORLIQ_NODE_REGION=/d' /etc/systemd/system/vorliq-heartbeat.service
  sed -i '/^Environment="VORLIQ_NODE_COUNTRY=/d' /etc/systemd/system/vorliq-heartbeat.service
  sed -i '/^Environment=VORLIQ_NODE_COUNTRY=/d' /etc/systemd/system/vorliq-heartbeat.service
  sed -i '/^Environment=NODE_ENV=production/a Environment=HEARTBEAT_API_URL=http://127.0.0.1:5000\nEnvironment=VORLIQ_NODE_URL=https://node.vorliq.org\nEnvironment="VORLIQ_NODE_NAME=Vorliq Public Node"\nEnvironment=VORLIQ_NODE_REGION=London\nEnvironment="VORLIQ_NODE_COUNTRY=United Kingdom"' /etc/systemd/system/vorliq-heartbeat.service
  systemctl daemon-reload
fi

if [[ ! -f /etc/systemd/system/vorliq-miner.service ]]; then
  cat >/etc/systemd/system/vorliq-miner.service <<'SERVICE'
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
Environment=VORLIQ_PUBLIC_MINER_ENABLED=false
Environment=VORLIQ_PUBLIC_MINER_ADDRESS=
ExecStart=/usr/bin/node miner.js
Restart=on-failure
RestartSec=15

[Install]
WantedBy=multi-user.target
SERVICE
  systemctl daemon-reload
  systemctl disable vorliq-miner.service >/dev/null 2>&1 || true
else
  sed -i 's/^After=network-online.target vorliq-blockchain.service.*/After=network-online.target vorliq-blockchain.service vorliq-backend.service/' /etc/systemd/system/vorliq-miner.service
  sed -i 's/^Requires=vorliq-blockchain.service.*/Requires=vorliq-blockchain.service vorliq-backend.service/' /etc/systemd/system/vorliq-miner.service
  systemctl daemon-reload
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
printf '15 2 * * * root /home/vorliq/backup.sh >/dev/null 2>&1\n' >/etc/cron.d/vorliq-backup
chmod 644 /etc/cron.d/vorliq-backup
printf '*/5 * * * * root /home/vorliq/monitor.sh >/dev/null 2>&1\n' >/etc/cron.d/vorliq-monitor
chmod 644 /etc/cron.d/vorliq-monitor

systemctl restart vorliq-blockchain.service
systemctl restart vorliq-backend.service
for attempt in 1 2 3 4 5; do
  if curl -fsS http://127.0.0.1:5000/api/health >/dev/null 2>&1; then
    break
  fi
  sleep 3
done
systemctl restart vorliq-heartbeat.service
if systemctl is-enabled --quiet vorliq-miner.service; then
  systemctl restart vorliq-miner.service
fi

if [[ -n "${GENERATED_ADMIN_TOKEN}" ]]; then
  echo "A new Vorliq ADMIN_TOKEN was generated because none existed. Save it securely now; it will not be shown again:"
  echo "${GENERATED_ADMIN_TOKEN}"
fi

echo "done"
