#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
PYTHON="${REPO_ROOT}/blockchain/.venv/bin/python"

if [[ "${NODE_ENV:-}" == "production" || "${FLASK_ENV:-}" == "production" ]]; then
  printf 'Error: this launcher is for local development and refuses production mode.\n' >&2
  exit 1
fi

if [[ ! -x "${PYTHON}" ]]; then
  printf 'Error: blockchain virtual environment not found at %s\n' "${PYTHON}" >&2
  printf 'Create it with: python3 -m venv blockchain/.venv\n' >&2
  exit 1
fi

export NODE_ENV="development"

cd "${REPO_ROOT}/blockchain"
exec "${PYTHON}" app.py
