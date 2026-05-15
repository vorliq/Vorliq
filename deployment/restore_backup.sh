#!/usr/bin/env bash
set -euo pipefail

BACKUP_ARCHIVE="${1:-}"
MODE="${2:-}"
APP_DIR="${VORLIQ_APP_DIR:-/home/vorliq/app}"
DATA_DIR="${VORLIQ_DATA_DIR:-${APP_DIR}/blockchain/data}"
BACKUP_DIR="${VORLIQ_BACKUP_DIR:-/home/vorliq/backups}"
TIMESTAMP="$(date +%Y-%m-%d-%H%M%S)"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

fail() {
  echo "RESTORE FAILED: $*" >&2
  exit 1
}

if [[ -z "${BACKUP_ARCHIVE}" ]]; then
  fail "usage: $0 /path/to/vorliq-backup-YYYY-MM-DD-HHMMSS.tar.gz [--dry-run]"
fi

if [[ ! -f "${BACKUP_ARCHIVE}" ]]; then
  fail "backup archive does not exist: ${BACKUP_ARCHIVE}"
fi

if [[ "${BACKUP_ARCHIVE}" != *.tar.gz ]]; then
  fail "backup archive must be a .tar.gz file"
fi

echo "Verifying archive before restore: ${BACKUP_ARCHIVE}"
tar -tzf "${BACKUP_ARCHIVE}" >/dev/null
tar -xzf "${BACKUP_ARCHIVE}" -C "${TMP_DIR}"

RESTORE_SOURCE=""
for candidate in \
  "${TMP_DIR}/vorliq-backup/blockchain/data" \
  "${TMP_DIR}/blockchain/data" \
  "${TMP_DIR}/data"; do
  if [[ -d "${candidate}" ]]; then
    RESTORE_SOURCE="${candidate}"
    break
  fi
done

if [[ -z "${RESTORE_SOURCE}" ]]; then
  RESTORE_SOURCE="$(find "${TMP_DIR}" -type d -path '*/blockchain/data' -print -quit)"
fi

if [[ -z "${RESTORE_SOURCE}" ]]; then
  fail "archive does not contain blockchain/data"
fi

if [[ "${MODE}" == "--dry-run" ]]; then
  echo "DRY RUN: archive is readable and contains blockchain data at ${RESTORE_SOURCE}"
  echo "DRY RUN: would stop vorliq-blockchain, vorliq-backend, and vorliq-heartbeat"
  echo "DRY RUN: would safety-copy ${DATA_DIR} and restore archive data into it"
  echo "DRY RUN: no live files were modified"
  exit 0
fi

if [[ "${EUID}" -ne 0 ]]; then
  fail "run as root with sudo for a live restore"
fi

SAFETY_COPY="${BACKUP_DIR}/pre-restore-data-${TIMESTAMP}"
mkdir -p "${BACKUP_DIR}"

echo "Stopping Vorliq services."
systemctl stop vorliq-heartbeat.service vorliq-backend.service vorliq-blockchain.service

if [[ -d "${DATA_DIR}" ]]; then
  echo "Creating safety copy at ${SAFETY_COPY}"
  cp -a "${DATA_DIR}" "${SAFETY_COPY}"
else
  echo "No existing data directory found; creating ${DATA_DIR}"
fi

rm -rf "${DATA_DIR}"
mkdir -p "$(dirname "${DATA_DIR}")"
cp -a "${RESTORE_SOURCE}" "${DATA_DIR}"

chown -R vorliq:vorliq "${DATA_DIR}" "${SAFETY_COPY}" 2>/dev/null || true
find "${DATA_DIR}" -type d -exec chmod 750 {} \;
find "${DATA_DIR}" -type f -exec chmod 640 {} \;

echo "Restarting Vorliq services."
systemctl start vorliq-blockchain.service
systemctl start vorliq-backend.service
systemctl start vorliq-heartbeat.service

echo "Running local health checks."
for attempt in 1 2 3 4 5; do
  if curl -fsS http://localhost:5000/api/health >/dev/null &&
     curl -fsS http://localhost:5000/api/diagnostics >/dev/null; then
    echo "RESTORE SUCCESS: services are healthy after restoring ${BACKUP_ARCHIVE}"
    echo "Safety copy kept at ${SAFETY_COPY}"
    exit 0
  fi
  sleep 5
done

systemctl status vorliq-blockchain.service vorliq-backend.service vorliq-heartbeat.service --no-pager || true
fail "services did not pass health checks after restore; safety copy is at ${SAFETY_COPY}"
