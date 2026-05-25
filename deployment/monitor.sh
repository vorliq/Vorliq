#!/usr/bin/env bash
set -euo pipefail

ALERT_SCRIPT="${VORLIQ_ALERT_SCRIPT:-/home/vorliq/alert.sh}"
LOG_FILE="${VORLIQ_MONITOR_LOG:-/var/log/vorliq-monitor.log}"
HEALTH_URL="${VORLIQ_PUBLIC_HEALTH_URL:-https://vorliq.org/api/health}"
SERVICES=(vorliq-blockchain.service vorliq-backend.service vorliq-heartbeat.service vorliq-heartbeat.timer nginx.service)
restarted=0

mkdir -p "$(dirname "${LOG_FILE}")"
touch "${LOG_FILE}"
chmod 640 "${LOG_FILE}" 2>/dev/null || true

log() {
  printf '%s %s\n' "$(date -Is)" "$*" >> "${LOG_FILE}"
}

alert() {
  local severity="$1"
  local title="$2"
  local message="$3"
  if [[ -x "${ALERT_SCRIPT}" ]]; then
    "${ALERT_SCRIPT}" "${severity}" "${title}" "${message}" || true
  else
    log "alert_script_missing severity=${severity} title=${title}"
  fi
}

for service in "${SERVICES[@]}"; do
  if systemctl is-active --quiet "${service}"; then
    log "service_ok ${service}"
    continue
  fi

  log "service_down ${service}; attempting_restart"
  if systemctl restart "${service}"; then
    restarted=1
    alert "warning" "Vorliq service restarted: ${service}" "${service} was down and monitor.sh restarted it."
  else
    restarted=1
    alert "critical" "Vorliq service restart failed: ${service}" "${service} was down and monitor.sh could not restart it."
  fi
done

if (( restarted == 1 )); then
  sleep 5
  health_response="$(curl -fsS --max-time 20 "${HEALTH_URL}" 2>/dev/null || true)"
  if ! printf '%s' "${health_response}" | grep -q '"success":true'; then
    log "public_health_failed_after_restart url=${HEALTH_URL}"
    alert "critical" "Vorliq public health failed after restart" "One or more services were restarted, but ${HEALTH_URL} did not return success."
    exit 1
  fi
  log "public_health_ok_after_restart"
fi

exit 0
