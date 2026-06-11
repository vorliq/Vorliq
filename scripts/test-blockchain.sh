#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
PYTHON="${REPO_ROOT}/blockchain/.venv/bin/python"

if [[ ! -x "${PYTHON}" ]]; then
  printf 'Error: blockchain virtual environment not found at %s\n' "${PYTHON}" >&2
  printf 'Create it with: python3 -m venv blockchain/.venv\n' >&2
  exit 1
fi

cd "${REPO_ROOT}/blockchain"
if (( $# > 0 )); then
  exec "${PYTHON}" -m pytest "$@"
fi
exec "${PYTHON}" -m pytest tests/ -v
