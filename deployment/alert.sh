#!/usr/bin/env bash
set -euo pipefail

SEVERITY="${1:-}"
TITLE="${2:-}"
MESSAGE="${3:-}"
ALERT_LOG="${VORLIQ_ALERT_LOG:-/var/log/vorliq-alerts.log}"
SUPPRESSION_DIR="${VORLIQ_ALERT_SUPPRESSION_DIR:-/var/lib/vorliq/alerts}"
SUPPRESSION_SECONDS="${VORLIQ_ALERT_SUPPRESSION_SECONDS:-1800}"
ALERT_EMAIL="${VORLIQ_ALERT_EMAIL:-Vorliq@gmail.com}"

usage() {
  echo "usage: $0 <info|warning|critical> <title> <message>" >&2
}

if [[ -z "${SEVERITY}" || -z "${TITLE}" || -z "${MESSAGE}" ]]; then
  usage
  exit 1
fi

case "${SEVERITY}" in
  info|warning|critical) ;;
  *)
    echo "invalid alert severity: ${SEVERITY}" >&2
    usage
    exit 1
    ;;
esac

mkdir -p "$(dirname "${ALERT_LOG}")" "${SUPPRESSION_DIR}"
touch "${ALERT_LOG}"
chmod 640 "${ALERT_LOG}" 2>/dev/null || true

timestamp="$(date -Is)"
printf '%s severity=%s title=%s message=%s\n' "${timestamp}" "${SEVERITY}" "${TITLE}" "${MESSAGE}" >> "${ALERT_LOG}"

title_hash="$(printf '%s' "${TITLE}" | sha256sum | awk '{print $1}')"
suppression_file="${SUPPRESSION_DIR}/${title_hash}.sent"
now="$(date +%s)"
last_sent=0

if [[ -f "${suppression_file}" ]]; then
  last_sent="$(cat "${suppression_file}" 2>/dev/null || echo 0)"
fi

if [[ "${last_sent}" =~ ^[0-9]+$ ]] && (( now - last_sent < SUPPRESSION_SECONDS )); then
  printf '%s severity=%s title=%s email=suppressed duplicate_window_seconds=%s\n' "${timestamp}" "${SEVERITY}" "${TITLE}" "${SUPPRESSION_SECONDS}" >> "${ALERT_LOG}"
  exit 0
fi

subject="[Vorliq ${SEVERITY}] ${TITLE}"
body="$(cat <<BODY
Vorliq production alert

Severity: ${SEVERITY}
Title: ${TITLE}
Time: ${timestamp}

${MESSAGE}
BODY
)"

if command -v mail >/dev/null 2>&1; then
  printf '%s\n' "${body}" | mail -s "${subject}" "${ALERT_EMAIL}" && {
    printf '%s' "${now}" > "${suppression_file}"
    printf '%s severity=%s title=%s email=sent method=mail\n' "${timestamp}" "${SEVERITY}" "${TITLE}" >> "${ALERT_LOG}"
    exit 0
  }
elif command -v sendmail >/dev/null 2>&1; then
  {
    printf 'To: %s\n' "${ALERT_EMAIL}"
    printf 'Subject: %s\n' "${subject}"
    printf '\n%s\n' "${body}"
  } | sendmail -t && {
    printf '%s' "${now}" > "${suppression_file}"
    printf '%s severity=%s title=%s email=sent method=sendmail\n' "${timestamp}" "${SEVERITY}" "${TITLE}" >> "${ALERT_LOG}"
    exit 0
  }
else
  printf '%s severity=%s title=%s email=unavailable reason=no-mail-command\n' "${timestamp}" "${SEVERITY}" "${TITLE}" >> "${ALERT_LOG}"
  exit 0
fi

printf '%s severity=%s title=%s email=unavailable reason=send-failed\n' "${timestamp}" "${SEVERITY}" "${TITLE}" >> "${ALERT_LOG}"
exit 0

