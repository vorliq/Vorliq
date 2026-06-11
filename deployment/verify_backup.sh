#!/usr/bin/env bash
set -euo pipefail

BACKUP_ARCHIVE="${1:-}"
TMP_DIR="$(mktemp -d)"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

cleanup() {
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

fail() {
  echo "VERIFY FAILED: $*" >&2
  exit 1
}

if [[ -z "${BACKUP_ARCHIVE}" ]]; then
  fail "usage: $0 /path/to/vorliq-backup-YYYY-MM-DD-HHMMSS.tar.gz"
fi

if [[ ! -f "${BACKUP_ARCHIVE}" ]]; then
  fail "backup archive does not exist: ${BACKUP_ARCHIVE}"
fi

echo "Verifying backup archive: ${BACKUP_ARCHIVE}"
tar -tzf "${BACKUP_ARCHIVE}" >/dev/null
tar -xzf "${BACKUP_ARCHIVE}" -C "${TMP_DIR}"

DATA_DIR=""
for candidate in \
  "${TMP_DIR}/vorliq-backup/blockchain/data" \
  "${TMP_DIR}/blockchain/data" \
  "${TMP_DIR}/data"; do
  if [[ -d "${candidate}" ]]; then
    DATA_DIR="${candidate}"
    break
  fi
done

if [[ -z "${DATA_DIR}" ]]; then
  DATA_DIR="$(find "${TMP_DIR}" -type d -path '*/blockchain/data' -print -quit)"
fi

if [[ -z "${DATA_DIR}" ]]; then
  fail "archive does not contain blockchain/data"
fi

python3 - "${DATA_DIR}" <<'PY'
import json
import sys
from pathlib import Path

data_dir = Path(sys.argv[1])
critical_files = [
    "chain.json",
    "pending.json",
    "peers.json",
    "registry.json",
    "lending.json",
    "exchange.json",
    "governance.json",
    "treasury.json",
    "price.json",
    "forum.json",
    "achievements.json",
    "profiles.json",
    "faucet.json",
]

errors = []
warnings = []
valid = []
missing = []

for name in critical_files:
    path = data_dir / name
    if not path.exists():
        missing.append(name)
        continue
    try:
        with path.open("r", encoding="utf-8") as handle:
            parsed = json.load(handle)
    except Exception as exc:
        errors.append(f"{name}: invalid JSON: {exc}")
        continue
    valid.append(name)
    backup = path.with_name(path.name + ".bak")
    if backup.exists():
        try:
            with backup.open("r", encoding="utf-8") as handle:
                json.load(handle)
        except Exception as exc:
            errors.append(f"{backup.name}: invalid backup JSON: {exc}")

    if name == "chain.json":
        if not isinstance(parsed, dict):
            errors.append("chain.json: root must be an object")
        elif not isinstance(parsed.get("chain"), list):
            errors.append("chain.json: chain must be a list")
        elif parsed["chain"]:
            required_block_fields = {"index", "timestamp", "transactions", "nonce", "previous_hash", "hash"}
            for index, block in enumerate(parsed["chain"]):
                if not isinstance(block, dict):
                    errors.append(f"chain.json: block {index} must be an object")
                    continue
                missing_fields = sorted(required_block_fields - set(block))
                if missing_fields:
                    errors.append(f"chain.json: block {index} missing {', '.join(missing_fields)}")
                if not isinstance(block.get("transactions", []), list):
                    errors.append(f"chain.json: block {index} transactions must be a list")

if "chain.json" in missing:
    warnings.append("chain.json is missing. This is acceptable only for a fresh node before a chain has been saved.")

backend_data = data_dir.parent.parent / "backend" / "data"
for name in ["analytics.json", "incidents.json"]:
    path = backend_data / name
    if path.exists():
        try:
            with path.open("r", encoding="utf-8") as handle:
                json.load(handle)
        except Exception as exc:
            errors.append(f"backend/data/{name}: invalid JSON: {exc}")

print("Backup verification report")
print(f"Data directory: {data_dir}")
print(f"Valid JSON files: {', '.join(valid) if valid else 'none'}")
print(f"Missing JSON files: {', '.join(missing) if missing else 'none'}")
for warning in warnings:
    print(f"WARNING: {warning}")

if errors:
    for error in errors:
        print(f"ERROR: {error}")
    sys.exit(1)

print("JSON verification passed: backup archive is readable and critical JSON files are valid.")
PY

if [[ -f "${DATA_DIR}/chain.json" ]]; then
  if [[ ! -f "${REPO_ROOT}/tools/diagnose_chain_startup.py" ]]; then
    fail "full chain validation tooling is unavailable"
  fi
  if ! VORLIQ_DATA_DIR="${DATA_DIR}" python3 "${REPO_ROOT}/tools/diagnose_chain_startup.py" >/dev/null; then
    fail "archive chain failed full semantic validation"
  fi
fi

echo "VERIFY SUCCESS: archive chain passed full semantic validation."
