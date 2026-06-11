#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
BASE_URL="${1:-http://localhost:5000}"

if ! command -v node >/dev/null 2>&1; then
  printf 'Error: Node.js is required to run the readiness check.\n' >&2
  exit 1
fi

if (( $# > 0 )); then
  shift
fi

cd "${REPO_ROOT}"
exec node tools/check_readiness.js "${BASE_URL}" "$@"
