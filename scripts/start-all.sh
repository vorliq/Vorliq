#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PIDS=()

cleanup() {
  if (( ${#PIDS[@]} > 0 )); then
    kill "${PIDS[@]}" 2>/dev/null || true
    wait "${PIDS[@]}" 2>/dev/null || true
  fi
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

printf 'Starting Vorliq blockchain API, backend API, and frontend for local development.\n'
"${SCRIPT_DIR}/start-blockchain.sh" &
PIDS+=("$!")
"${SCRIPT_DIR}/start-backend.sh" &
PIDS+=("$!")
"${SCRIPT_DIR}/start-frontend.sh" &
PIDS+=("$!")

if [[ "${VORLIQ_ENABLE_HEARTBEAT:-0}" == "1" ]]; then
  printf 'Starting the local registry heartbeat helper.\n'
  "${SCRIPT_DIR}/start-heartbeat.sh" &
  PIDS+=("$!")
else
  printf 'Heartbeat helper disabled. Set VORLIQ_ENABLE_HEARTBEAT=1 to enable local registry writes.\n'
fi

printf 'Vorliq local services started. Press Ctrl+C to stop them.\n'
while true; do
  for pid in "${PIDS[@]}"; do
    if ! kill -0 "${pid}" 2>/dev/null; then
      set +e
      wait "${pid}"
      EXIT_CODE=$?
      set -e
      printf 'A local service exited; stopping the remaining services.\n' >&2
      exit "${EXIT_CODE}"
    fi
  done
  sleep 1
done
