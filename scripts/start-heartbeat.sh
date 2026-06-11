#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

if [[ "${NODE_ENV:-}" == "production" ]]; then
  printf 'Error: this launcher is for local development and refuses production mode.\n' >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  printf 'Error: Node.js is required to start the heartbeat helper.\n' >&2
  exit 1
fi

if [[ ! -d "${REPO_ROOT}/backend/node_modules" ]]; then
  printf 'Error: backend dependencies are missing. Run: cd backend && npm install\n' >&2
  exit 1
fi

export NODE_ENV="development"
export HEARTBEAT_API_URL="http://localhost:5000"
export FLASK_URL="http://localhost:5001"
export VORLIQ_NODE_URL="http://localhost:5001"

printf 'Starting heartbeat helper against local development services only.\n'
cd "${REPO_ROOT}/backend"
exec node heartbeat.js
