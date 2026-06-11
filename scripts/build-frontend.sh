#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

if ! command -v npm >/dev/null 2>&1; then
  printf 'Error: npm is required to build the frontend.\n' >&2
  exit 1
fi

cd "${REPO_ROOT}/frontend"
exec npm run build
