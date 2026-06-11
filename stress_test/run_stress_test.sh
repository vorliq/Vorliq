#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
PYTHON="${REPO_ROOT}/blockchain/.venv/bin/python"
RESULTS="${SCRIPT_DIR}/results.txt"

if [[ ! -x "${PYTHON}" ]]; then
  printf 'Error: blockchain virtual environment not found at %s\n' "${PYTHON}" >&2
  exit 1
fi

cd "${REPO_ROOT}"
set +e
"${PYTHON}" stress_test/simulate_network.py >"${RESULTS}" 2>&1
EXIT_CODE=$?
set -e

cat "${RESULTS}"
exit "${EXIT_CODE}"
