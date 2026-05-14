#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Please run this script as root with sudo."
  exit 1
fi

echo "Setting up Vorliq node. This will take a few minutes."

export DEBIAN_FRONTEND=noninteractive

apt-get update -y
apt-get upgrade -y

apt-get install -y curl ca-certificates gnupg software-properties-common
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -

add-apt-repository -y ppa:deadsnakes/ppa
apt-get update -y

apt-get install -y nodejs
apt-get install -y python3.12 python3.12-venv python3.12-dev python3-pip python3-venv python3-dev
apt-get install -y nginx certbot python3-certbot-nginx
apt-get install -y git

if ! id -u vorliq >/dev/null 2>&1; then
  useradd --system --create-home --home-dir /home/vorliq --shell /usr/sbin/nologin vorliq
fi

if [[ -d /home/vorliq/app/.git ]]; then
  echo "Vorliq repository already exists at /home/vorliq/app. Pulling latest code."
  sudo -u vorliq -H bash -c "cd /home/vorliq/app && git pull origin main"
else
  rm -rf /home/vorliq/app
  sudo -u vorliq -H git clone https://github.com/vorliq/Vorliq.git /home/vorliq/app
fi

cd /home/vorliq/app/blockchain
sudo -u vorliq -H python3.12 -m venv .venv
sudo -u vorliq -H bash -c "cd /home/vorliq/app/blockchain && . .venv/bin/activate && pip install --upgrade pip && pip install -r requirements.txt"

cd /home/vorliq/app/backend
sudo -u vorliq -H npm install

cd /home/vorliq/app/frontend
sudo -u vorliq -H npm install
sudo -u vorliq -H npm run build

mkdir -p /home/vorliq/app/blockchain/data
mkdir -p /home/vorliq/app/backend/data
chown -R vorliq:vorliq /home/vorliq/app

echo "Installation complete. Now run configure_server.sh to finish setup."
