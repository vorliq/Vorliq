#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/home/vorliq/app"
APP_USER="vorliq"
NODE_ENV_FILE="/etc/vorliq/node.env"
BACKEND_ENV_FILE="/etc/vorliq/backend.env"
SNAPSHOT_ENV_FILE="/etc/vorliq/snapshot-signing.env"
TRUSTED_DEFAULT="https://vorliq.org"
REPO_URL="https://github.com/vorliq/Vorliq.git"

banner() {
  cat <<'BANNER'
============================================================
 Vorliq Verified Community Node Installer
============================================================
 This installer verifies the trusted public node before setup,
 installs the app, configures node identity, registers heartbeat
 metadata, and leaves chain data and signing secrets untouched.
============================================================
BANNER
}

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    fail "Run this installer as root with sudo."
  fi
}

ask() {
  local prompt="$1"
  local default_value="${2:-}"
  local value
  if [[ -n "${default_value}" ]]; then
    read -r -p "${prompt} [${default_value}]: " value
    printf '%s' "${value:-$default_value}"
  else
    read -r -p "${prompt}: " value
    printf '%s' "${value}"
  fi
}

require_non_empty() {
  local value="$1"
  local label="$2"
  [[ -n "${value// }" ]] || fail "${label} is required."
}

normalize_url() {
  node -e 'try { const u = new URL(process.argv[1]); u.pathname = ""; u.search = ""; u.hash = ""; console.log(u.toString().replace(/\/$/, "")); } catch (error) { process.exit(1); }' "$1"
}

url_hostname() {
  node -e 'try { console.log(new URL(process.argv[1]).hostname); } catch (error) { process.exit(1); }' "$1"
}

url_scheme() {
  node -e 'try { console.log(new URL(process.argv[1]).protocol.replace(":", "")); } catch (error) { process.exit(1); }' "$1"
}

write_env_line() {
  local key="$1"
  local value="$2"
  value="${value//$'\n'/ }"
  value="${value//\'/\'\\\'\'}"
  printf "%s='%s'\n" "${key}" "${value}"
}

ensure_node_for_verifier() {
  if command -v node >/dev/null 2>&1; then
    return
  fi

  echo "Node.js is not installed. Installing Node.js 20 now only so bootstrap verification can run."
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
}

verifier_source_dir() {
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  if [[ -f "${script_dir}/../tools/bootstrap_verify_node.js" ]]; then
    cd "${script_dir}/.." && pwd
    return
  fi
  if [[ -f "${APP_DIR}/tools/bootstrap_verify_node.js" ]]; then
    printf '%s\n' "${APP_DIR}"
    return
  fi

  local tmp_dir
  tmp_dir="$(mktemp -d)"
  echo "Downloading Vorliq verifier source to a temporary directory." >&2
  curl -fsSL "https://github.com/vorliq/Vorliq/archive/refs/heads/main.tar.gz" | tar -xz -C "${tmp_dir}" --strip-components=1
  printf '%s\n' "${tmp_dir}"
}

bootstrap_verify() {
  local trusted_node_url="$1"
  ensure_node_for_verifier
  local source_dir
  source_dir="$(verifier_source_dir)"
  echo "Running read-only bootstrap verification against ${trusted_node_url}."
  if ! (cd "${source_dir}" && node tools/bootstrap_verify_node.js "${trusted_node_url}"); then
    fail "The trusted node could not be verified. Installation stopped before app setup."
  fi
}

install_dependencies() {
  echo "Installing Vorliq host dependencies."
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg software-properties-common openssl git nginx certbot python3-certbot-nginx
  if ! command -v node >/dev/null 2>&1 || ! node -v | grep -Eq '^v20\.'; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  fi
  if ! command -v python3.12 >/dev/null 2>&1; then
    add-apt-repository -y ppa:deadsnakes/ppa
    apt-get update -y
  fi
  apt-get install -y python3.12 python3.12-venv python3.12-dev python3-pip python3-dev
}

ensure_user_and_repo() {
  if ! id -u "${APP_USER}" >/dev/null 2>&1; then
    useradd --system --create-home --home-dir /home/vorliq --shell /usr/sbin/nologin "${APP_USER}"
  fi

  mkdir -p /home/vorliq
  chown "${APP_USER}:${APP_USER}" /home/vorliq

  if [[ -d "${APP_DIR}/.git" ]]; then
    echo "Vorliq repository already exists. Fetching and resetting code to origin/main."
    chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"
    sudo -u "${APP_USER}" -H git -C "${APP_DIR}" fetch origin
    sudo -u "${APP_USER}" -H git -C "${APP_DIR}" reset --hard origin/main
  else
    if [[ -e "${APP_DIR}" ]]; then
      fail "${APP_DIR} exists but is not a git repository. Move it aside or clone Vorliq there manually."
    fi
    sudo -u "${APP_USER}" -H git clone "${REPO_URL}" "${APP_DIR}"
  fi
}

install_app() {
  echo "Installing Vorliq application dependencies and building the frontend."
  sudo -u "${APP_USER}" -H python3.12 -m venv "${APP_DIR}/blockchain/.venv"
  sudo -u "${APP_USER}" -H bash -c "cd '${APP_DIR}/blockchain' && . .venv/bin/activate && pip install --upgrade pip && pip install -r requirements.txt"
  sudo -u "${APP_USER}" -H bash -c "cd '${APP_DIR}/backend' && npm install"
  sudo -u "${APP_USER}" -H bash -c "cd '${APP_DIR}/frontend' && npm install && npm run build"

  mkdir -p "${APP_DIR}/blockchain/data" "${APP_DIR}/backend/data" /home/vorliq/backups /etc/vorliq
  chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}" /home/vorliq/backups
  chmod 750 "${APP_DIR}/blockchain/data" "${APP_DIR}/backend/data" /home/vorliq/backups
}

run_verified_chain_bootstrap_prompt() {
  local trusted_node_url="$1"
  local app_dir_arg trusted_arg data_dir_arg
  printf -v app_dir_arg '%q' "${APP_DIR}"
  printf -v trusted_arg '%q' "${trusted_node_url}"
  printf -v data_dir_arg '%q' "${APP_DIR}/blockchain/data"
  echo
  echo "Verified chain bootstrap can check the signed public snapshot, audit manifest, chain export hash, and block links before this node starts."
  read -r -p "Run a dry-run chain bootstrap now? [Y/n]: " dry_run_answer
  if [[ ! "${dry_run_answer}" =~ ^[Nn]$ ]]; then
    sudo -u "${APP_USER}" -H bash -c "cd ${app_dir_arg} && python3.12 tools/bootstrap_chain_from_public_node.py --trusted-node ${trusted_arg} --data-dir ${data_dir_arg}"
  else
    echo "Skipped dry-run bootstrap. You can run it later from ${APP_DIR}."
  fi

  echo
  echo "Write mode replaces local chain data only when chain.json is empty or missing."
  echo "Use it for a new node. If chain.json already exists, this installer will not force overwrite it."
  read -r -p "Write the verified public chain to this new node now? [y/N]: " write_answer
  if [[ "${write_answer}" =~ ^[Yy]$ ]]; then
    if [[ -s "${APP_DIR}/blockchain/data/chain.json" ]]; then
      echo "Existing chain.json found. The installer will not force overwrite chain data."
      echo "Read the recovery docs and run tools/bootstrap_chain_from_public_node.py --write --force manually only if you understand the risk and have a backup."
    else
      sudo -u "${APP_USER}" -H bash -c "cd ${app_dir_arg} && python3.12 tools/bootstrap_chain_from_public_node.py --trusted-node ${trusted_arg} --data-dir ${data_dir_arg} --write"
    fi
  fi
}

configure_env() {
  local trusted_node_url="$1"
  local public_node_url="$2"
  local display_name="$3"
  local region="$4"
  local country="$5"
  local operator_wallet="$6"

  {
    write_env_line VORLIQ_HOST "0.0.0.0"
    write_env_line VORLIQ_PORT "5001"
    write_env_line VORLIQ_DATA_DIR "${APP_DIR}/blockchain/data"
    write_env_line VORLIQ_NODE_URL "${public_node_url}"
    write_env_line VORLIQ_NODE_DISPLAY_NAME "${display_name}"
    write_env_line VORLIQ_NODE_NAME "${display_name}"
    write_env_line VORLIQ_NODE_REGION "${region}"
    write_env_line VORLIQ_NODE_COUNTRY "${country}"
    write_env_line VORLIQ_NODE_OPERATOR_WALLET "${operator_wallet}"
    write_env_line VORLIQ_OPERATOR_WALLET "${operator_wallet}"
    write_env_line HEARTBEAT_API_URL "${trusted_node_url}"
    write_env_line FLASK_URL "http://127.0.0.1:5001"
    write_env_line NODE_ENV "production"
  } >"${NODE_ENV_FILE}.tmp"
  install -o root -g root -m 600 "${NODE_ENV_FILE}.tmp" "${NODE_ENV_FILE}"
  rm -f "${NODE_ENV_FILE}.tmp"

  if [[ -f "${BACKEND_ENV_FILE}" ]]; then
    chmod 600 "${BACKEND_ENV_FILE}"
    echo "Preserved existing backend environment file."
  else
    read -r -p "No ADMIN_TOKEN exists. Create one for protected admin routes now? [y/N]: " create_admin
    if [[ "${create_admin}" =~ ^[Yy]$ ]]; then
      local token
      token="$(openssl rand -hex 32)"
      install -o root -g root -m 600 /dev/null "${BACKEND_ENV_FILE}"
      write_env_line ADMIN_TOKEN "${token}" >"${BACKEND_ENV_FILE}"
      echo "ADMIN_TOKEN created in the protected backend environment file. It is not printed."
    else
      echo "No ADMIN_TOKEN created. Protected admin routes will remain unavailable until you set one."
    fi
  fi

  if [[ -f "${SNAPSHOT_ENV_FILE}" ]]; then
    chmod 600 "${SNAPSHOT_ENV_FILE}"
    echo "Preserved existing snapshot signing environment file."
  fi
}

write_services() {
  cat >/etc/systemd/system/vorliq-blockchain.service <<SERVICE
[Unit]
Description=Vorliq Blockchain API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${APP_DIR}/blockchain
EnvironmentFile=${NODE_ENV_FILE}
ExecStart=${APP_DIR}/blockchain/.venv/bin/python app.py
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICE

  cat >/etc/systemd/system/vorliq-backend.service <<SERVICE
[Unit]
Description=Vorliq Backend API
After=network-online.target vorliq-blockchain.service
Wants=network-online.target
Requires=vorliq-blockchain.service

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${APP_DIR}/backend
EnvironmentFile=${NODE_ENV_FILE}
EnvironmentFile=-${BACKEND_ENV_FILE}
EnvironmentFile=-${SNAPSHOT_ENV_FILE}
Environment=PORT=5000
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
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${APP_DIR}/backend
EnvironmentFile=${NODE_ENV_FILE}
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
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${APP_DIR}/backend
EnvironmentFile=${NODE_ENV_FILE}
ExecStart=/usr/bin/node heartbeat.js --once
SERVICE

  systemctl daemon-reload
  systemctl enable vorliq-blockchain.service vorliq-backend.service vorliq-heartbeat.service
}

configure_nginx() {
  local public_node_url="$1"
  local domain="$2"
  local scheme="$3"
  local nginx_site="/etc/nginx/sites-available/vorliq"
  local backup_suffix
  backup_suffix="$(date +%Y%m%d%H%M%S)"

  if [[ -f "${nginx_site}" ]]; then
    cp "${nginx_site}" "${nginx_site}.bak.${backup_suffix}"
    echo "Backed up existing nginx Vorliq site before replacing it."
  fi

  cat >"${nginx_site}" <<NGINX
server {
    listen 80;
    server_name ${domain};

    root ${APP_DIR}/frontend/build;
    index index.html;

    client_max_body_size 2m;

    location /api/socket.io/ {
        proxy_pass http://127.0.0.1:5000/api/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:5000/api/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
NGINX

  ln -sfn "${nginx_site}" /etc/nginx/sites-enabled/vorliq
  rm -f /etc/nginx/sites-enabled/default
  nginx -t
  systemctl enable nginx
  systemctl restart nginx

  if [[ "${scheme}" == "https" ]]; then
    echo "HTTPS was requested for ${public_node_url}."
    echo "DNS for ${domain} must already point to this server before certbot can issue a certificate."
    read -r -p "Is DNS ready for ${domain}? [y/N]: " dns_ready
    if [[ "${dns_ready}" =~ ^[Yy]$ ]]; then
      certbot --nginx -d "${domain}" --redirect
      systemctl reload nginx
    else
      echo "Skipped certbot. Run: sudo certbot --nginx -d ${domain} --redirect"
    fi
  fi
}

start_services() {
  systemctl restart vorliq-blockchain.service
  systemctl restart vorliq-backend.service
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if curl -fsS http://127.0.0.1:5000/api/health >/dev/null 2>&1; then
      break
    fi
    sleep 3
  done
  systemctl restart vorliq-heartbeat.service
  systemctl start vorliq-heartbeat-once.service || true
}

doctor_or_basic_verify() {
  local trusted_node_url="$1"
  local public_node_url="$2"
  echo "Running post-install checks."
  curl -fsS http://127.0.0.1:5000/api/health >/dev/null && echo "PASS local backend health" || echo "FAIL local backend health"
  curl -fsS http://127.0.0.1:5000/api/chain/summary >/dev/null && echo "PASS local chain summary" || echo "FAIL local chain summary"
  (cd "${APP_DIR}" && node tools/bootstrap_verify_node.js "${trusted_node_url}") || true
  (cd "${APP_DIR}" && node tools/node_doctor.js --base-url http://127.0.0.1:5000 --public-url "${public_node_url}" --trusted-node "${trusted_node_url}") || true
}

print_summary() {
  local public_node_url="$1"
  local display_name="$2"
  local region="$3"
  local country="$4"

  echo
  echo "Vorliq node setup complete."
  echo "Node URL: ${public_node_url}"
  echo "Display name: ${display_name}"
  echo "Region/Country: ${region} / ${country}"
  echo
  for service in vorliq-blockchain.service vorliq-backend.service vorliq-heartbeat.service nginx.service; do
    if systemctl is-active --quiet "${service}"; then
      echo "PASS ${service} active"
    else
      echo "WARN ${service} is not active. Check: sudo systemctl status ${service} --no-pager"
    fi
  done
  echo
  echo "Useful commands:"
  echo "  sudo journalctl -u vorliq-backend.service -f"
  echo "  sudo journalctl -u vorliq-blockchain.service -f"
  echo "  sudo journalctl -u vorliq-heartbeat.service -f"
  echo "  cd ${APP_DIR} && sudo bash deployment/update_server.sh"
  echo "  cd ${APP_DIR} && node tools/node_doctor.js --base-url http://127.0.0.1:5000 --public-url ${public_node_url}"
  echo
  echo "Back up ${APP_DIR}/blockchain/data before major updates. Do not publish admin tokens, private keys, snapshot signing keys, raw logs, or environment files."
}

main() {
  banner
  require_root

  local trusted_node_url public_node_url display_name region country operator_wallet domain scheme
  trusted_node_url="$(ask "Trusted public node URL" "${TRUSTED_DEFAULT}")"
  ensure_node_for_verifier
  trusted_node_url="$(normalize_url "${trusted_node_url}")" || fail "Trusted public node URL must be a valid http(s) URL."
  public_node_url="$(ask "Your public node URL, for example https://node.example.org" "")"
  require_non_empty "${public_node_url}" "Your public node URL"
  public_node_url="$(normalize_url "${public_node_url}")" || fail "Your public node URL must be a valid http(s) URL."
  display_name="$(ask "Display name" "Vorliq Community Node")"
  require_non_empty "${display_name}" "Display name"
  region="$(ask "Region" "")"
  require_non_empty "${region}" "Region"
  country="$(ask "Country" "")"
  require_non_empty "${country}" "Country"
  operator_wallet="$(ask "Optional operator wallet address" "")"

  bootstrap_verify "${trusted_node_url}"
  install_dependencies
  ensure_user_and_repo
  install_app
  run_verified_chain_bootstrap_prompt "${trusted_node_url}"
  configure_env "${trusted_node_url}" "${public_node_url}" "${display_name}" "${region}" "${country}" "${operator_wallet}"
  write_services

  domain="$(url_hostname "${public_node_url}")" || fail "Could not parse public node hostname."
  scheme="$(url_scheme "${public_node_url}")" || fail "Could not parse public node scheme."
  configure_nginx "${public_node_url}" "${domain}" "${scheme}"
  start_services
  doctor_or_basic_verify "${trusted_node_url}" "${public_node_url}"
  print_summary "${public_node_url}" "${display_name}" "${region}" "${country}"
}

main "$@"
