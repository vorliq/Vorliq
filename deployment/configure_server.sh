#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Please run this script as root with sudo."
  exit 1
fi

SERVER_IP="$(hostname -I | awk '{print $1}')"

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
After=network-online.target vorliq-blockchain.service
Wants=network-online.target
Requires=vorliq-blockchain.service

[Service]
Type=simple
User=vorliq
Group=vorliq
WorkingDirectory=/home/vorliq/app/backend
Environment=NODE_ENV=production
Environment=FLASK_URL=http://127.0.0.1:5001
Environment=LOCAL_NODE_URL=http://${SERVER_IP}:5001
Environment=NODE_DISPLAY_NAME=Vorliq Public Node
ExecStart=/usr/bin/node heartbeat.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable vorliq-blockchain.service vorliq-backend.service vorliq-heartbeat.service
systemctl restart vorliq-blockchain.service
systemctl restart vorliq-backend.service
systemctl restart vorliq-heartbeat.service

for service in vorliq-blockchain.service vorliq-backend.service vorliq-heartbeat.service; do
  if systemctl is-active --quiet "${service}"; then
    echo "${service} is running."
  else
    echo "${service} failed to start."
    systemctl status "${service}" --no-pager || true
  fi
done

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
echo "Server IP address:"
hostname -I
