#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${VORLIQ_APP_DIR:-/home/vorliq/app}"
BACKUP_DIR="${VORLIQ_BACKUP_DIR:-/home/vorliq/backups}"
RETENTION_DAYS="${VORLIQ_BACKUP_RETENTION_DAYS:-14}"
TIMESTAMP="$(date +%Y-%m-%d-%H%M%S)"
ARCHIVE_NAME="vorliq-backup-${TIMESTAMP}.tar.gz"
ARCHIVE_PATH="${BACKUP_DIR}/${ARCHIVE_NAME}"
CONTENTS_PATH="${BACKUP_DIR}/vorliq-backup-${TIMESTAMP}.contents.txt"
LOG_FILE="${VORLIQ_BACKUP_LOG:-${BACKUP_DIR}/backup.log}"
TMP_DIR="$(mktemp -d)"
ALERT_SCRIPT="${VORLIQ_ALERT_SCRIPT:-/home/vorliq/alert.sh}"
ALERT_SENT=0

cleanup() {
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

send_failure_alert() {
  local message="$1"
  if (( ALERT_SENT == 1 )); then
    return
  fi
  ALERT_SENT=1
  if [[ -x "${ALERT_SCRIPT}" ]]; then
    "${ALERT_SCRIPT}" "critical" "Vorliq backup failed" "${message}" || true
  fi
}

on_error() {
  local line_number="$1"
  send_failure_alert "Backup failed on line ${line_number}. Check ${LOG_FILE} on the production server."
}
trap 'on_error "$LINENO"' ERR

log() {
  printf '%s %s\n' "$(date -Is)" "$*" | tee -a "${LOG_FILE}"
  if id -u vorliq >/dev/null 2>&1; then
    chown vorliq:vorliq "${LOG_FILE}" 2>/dev/null || true
  fi
}

mkdir -p "${BACKUP_DIR}"
chmod 750 "${BACKUP_DIR}"

if [[ ! -d "${APP_DIR}" ]]; then
  log "ERROR app directory does not exist: ${APP_DIR}"
  send_failure_alert "Backup failed because app directory does not exist."
  exit 1
fi

PAYLOAD_DIR="${TMP_DIR}/vorliq-backup"
mkdir -p "${PAYLOAD_DIR}/blockchain" "${PAYLOAD_DIR}/backend/data"

if [[ -d "${APP_DIR}/blockchain/data" ]]; then
  cp -a "${APP_DIR}/blockchain/data" "${PAYLOAD_DIR}/blockchain/data"
else
  mkdir -p "${PAYLOAD_DIR}/blockchain/data"
fi

if [[ -d "${APP_DIR}/backend/data" ]]; then
  find "${APP_DIR}/backend/data" -maxdepth 1 -type f -name '*.log' -print0 |
    while IFS= read -r -d '' log_file; do
      cp -a "${log_file}" "${PAYLOAD_DIR}/backend/data/"
    done
fi

cat > "${PAYLOAD_DIR}/manifest.json" <<MANIFEST
{
  "created_at": "$(date -Is)",
  "app_dir": "${APP_DIR}",
  "retention_days": ${RETENTION_DAYS},
  "contents": [
    "blockchain/data",
    "backend/data/*.log"
  ],
  "excludes": [
    ".env",
    "private keys",
    "SSH keys",
    "node_modules",
    "frontend/build"
  ]
}
MANIFEST

tar -C "${TMP_DIR}" -czf "${ARCHIVE_PATH}" "vorliq-backup"

if tar -tzf "${ARCHIVE_PATH}" > "${CONTENTS_PATH}"; then
  if id -u vorliq >/dev/null 2>&1; then
    chown vorliq:vorliq "${ARCHIVE_PATH}" "${CONTENTS_PATH}" "${LOG_FILE}" 2>/dev/null || true
  fi
  ARCHIVE_SIZE="$(du -h "${ARCHIVE_PATH}" | awk '{print $1}')"
  log "SUCCESS created ${ARCHIVE_PATH}"
  log "SUCCESS archive size ${ARCHIVE_SIZE}"
  log "SUCCESS verification listed contents in ${CONTENTS_PATH}"
else
  log "ERROR archive verification failed for ${ARCHIVE_PATH}"
  rm -f "${ARCHIVE_PATH}" "${CONTENTS_PATH}"
  send_failure_alert "Backup archive verification failed for ${ARCHIVE_NAME}."
  exit 1
fi

find "${BACKUP_DIR}" -maxdepth 1 -type f -name 'vorliq-backup-*.tar.gz' -mtime "+${RETENTION_DAYS}" -print -delete |
  while IFS= read -r removed; do
    log "INFO removed expired backup ${removed}"
  done

find "${BACKUP_DIR}" -maxdepth 1 -type f -name 'vorliq-backup-*.contents.txt' -mtime "+${RETENTION_DAYS}" -delete
