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

mkdir -p /home/vorliq/backups
chown -R vorliq:vorliq /home/vorliq/backups
cp /home/vorliq/app/deployment/backup.sh /home/vorliq/backup.sh
chmod 750 /home/vorliq/backup.sh
chown root:vorliq /home/vorliq/backup.sh

systemctl restart vorliq-blockchain.service
systemctl restart vorliq-backend.service
systemctl restart vorliq-heartbeat.service

echo "done"
