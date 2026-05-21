#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
import time
from copy import deepcopy
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
BLOCKCHAIN_DIR = REPO_ROOT / "blockchain"
if str(BLOCKCHAIN_DIR) not in sys.path:
    sys.path.insert(0, str(BLOCKCHAIN_DIR))

from block import Block  # noqa: E402
from blockchain import Blockchain  # noqa: E402


REQUIRED_FILES = {"chain": "chain.json"}
OPTIONAL_FILES = {
    "pending": "pending.json",
    "indexes": "indexes.json",
    "peers": "peers.json",
    "registry": "registry.json",
    "lending": "lending.json",
    "exchange": "exchange.json",
    "governance": "governance.json",
    "treasury": "treasury.json",
    "price": "price.json",
    "forum": "forum.json",
    "achievements": "achievements.json",
    "profiles": "profiles.json",
    "faucet": "faucet.json",
}
BACKEND_FILES = {
    "analytics": "analytics.json",
    "incidents": "incidents.json",
    "reports": "reports.json",
}

POSTGRES_READY_TABLES = [
    "blocks",
    "confirmed_transactions",
    "pending_transactions",
    "peers",
    "registry_nodes",
    "lending_loans",
    "exchange_offers",
    "governance_proposals",
    "governance_rule_changes",
    "treasury_proposals",
    "treasury_ledger",
    "price_signals",
    "forum_posts",
    "forum_replies",
    "reports",
    "achievements",
    "profiles",
    "faucet_claims",
    "analytics_events",
    "incidents",
    "audit_exports_metadata",
    "storage_health_snapshots",
]

LEGACY_COMPATIBILITY_NOTES = [
    "Confirmed transactions keep raw_transaction_json so legacy transactions without tx_id remain importable.",
    "Blocks keep raw_block_json and original hash fields; historical block hashes must not be recalculated or rewritten.",
    "Pending transactions remain separate from confirmed transactions until mined.",
    "Derived indexes are not imported as source of truth; they should be rebuilt after a future cutover.",
    "JSON backups remain the rollback source until database parity and smoke tests pass.",
]


def iso_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def read_json(path: Path, *, errors: list[str], missing: list[str], required: bool = False) -> Any:
    if not path.exists():
        if required:
            errors.append(f"{path.name} is required but missing")
        else:
            missing.append(path.name)
        return None
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except Exception as exc:
        errors.append(f"{path.name} could not be parsed as JSON: {exc}")
        return None


def backend_data_dir_for(data_dir: Path) -> Path:
    if data_dir.name == "data" and data_dir.parent.name == "blockchain":
        return data_dir.parent.parent / "backend" / "data"
    return data_dir / "backend"


def tx_id(transaction: dict[str, Any], block_index: int | None = None, transaction_index: int | None = None) -> str:
    for key in ("tx_id", "transaction_id", "id"):
        if transaction.get(key):
            return str(transaction[key])
    return f"legacy:{block_index if block_index is not None else 'pending'}:{transaction_index if transaction_index is not None else 0}"


def normalize_transactions(chain_data: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for block in chain_data.get("chain", []) if isinstance(chain_data, dict) else []:
        block_index = block.get("index")
        block_hash = block.get("hash")
        for index, transaction in enumerate(block.get("transactions", []) or []):
            if isinstance(transaction, dict):
                rows.append(
                    {
                        "tx_id": tx_id(transaction, block_index, index),
                        "block_index": block_index,
                        "block_hash": block_hash,
                        "transaction_index": index,
                        "sender_address": transaction.get("sender_address") or transaction.get("sender"),
                        "receiver_address": transaction.get("receiver_address") or transaction.get("receiver"),
                        "amount": transaction.get("amount"),
                        "type": transaction.get("type") or transaction.get("category"),
                        "timestamp": transaction.get("timestamp"),
                    }
                )
    return rows


def validate_chain(chain_data: Any) -> tuple[int, str | None, list[str], list[str], bool]:
    errors: list[str] = []
    warnings: list[str] = []
    if not isinstance(chain_data, dict):
        return 0, None, ["chain.json root must be an object"], warnings, False
    blocks = chain_data.get("chain")
    if not isinstance(blocks, list):
        return 0, None, ["chain.json must contain a chain array"], warnings, False
    if not blocks:
        return 0, None, ["chain.json chain array is empty"], warnings, False

    required_block_fields = {"index", "timestamp", "transactions", "nonce", "previous_hash", "hash"}
    block_objects: list[Block] = []
    for position, block in enumerate(blocks):
        if not isinstance(block, dict):
            errors.append(f"chain block at position {position} must be an object")
            continue
        missing = sorted(required_block_fields - set(block))
        if missing:
            errors.append(f"chain block at position {position} is missing {', '.join(missing)}")
            continue
        if not isinstance(block.get("transactions"), list):
            errors.append(f"chain block {block.get('index', position)} transactions must be a list")
            continue
        try:
            block_objects.append(Block.from_dict(deepcopy(block)))
        except Exception as exc:
            errors.append(f"chain block {block.get('index', position)} could not be loaded: {exc}")

    if errors:
        latest_hash = blocks[-1].get("hash") if isinstance(blocks[-1], dict) else None
        return max(0, len(blocks) - 1), latest_hash, errors, warnings, False

    for position in range(1, len(block_objects)):
        if block_objects[position].previous_hash != block_objects[position - 1].hash:
            errors.append(f"block {block_objects[position].index} previous_hash does not match block {block_objects[position - 1].index}")

    blockchain = Blockchain()
    blockchain.chain = block_objects
    blockchain.difficulty = int(chain_data.get("difficulty", blockchain.difficulty))
    blockchain.proof_target = "0" * blockchain.difficulty
    if chain_data.get("mining_reward") is not None:
        blockchain.mining_reward = float(chain_data.get("mining_reward"))

    valid = False
    try:
        valid = blockchain.is_chain_valid()
    except Exception as exc:
        errors.append(f"chain validation raised an error: {exc}")

    if not valid and not errors:
        warnings.append("current chain validation returned false, but structural hash/link checks passed")

    latest_hash = block_objects[-1].hash if block_objects else None
    return max(0, len(block_objects) - 1), latest_hash, errors, warnings, not errors


def count_records(name: str, data: Any) -> int:
    if data is None:
        return 0
    if name == "chain":
        return len(data.get("chain", [])) if isinstance(data, dict) else 0
    if name == "pending":
        return len(data) if isinstance(data, list) else 0
    if name == "peers":
        return len(data) if isinstance(data, list) else 0
    mapping_fields = {
        "registry": "registered_nodes",
        "lending": "loan_requests",
        "exchange": "offers",
        "governance": "proposals",
        "treasury": "proposals",
        "price": "signals",
        "forum": "posts",
        "achievements": "earned",
        "profiles": "profiles",
        "faucet": "claims",
        "analytics": "events",
        "incidents": "incidents",
        "reports": "reports",
    }
    field = mapping_fields.get(name)
    value = data.get(field) if isinstance(data, dict) and field else None
    if isinstance(value, dict):
        return len(value)
    if isinstance(value, list):
        return len(value)
    return 0


def future_tables(files: dict[str, Any]) -> dict[str, dict[str, Any]]:
    chain = files.get("chain") if isinstance(files.get("chain"), dict) else {"chain": []}
    pending = files.get("pending") if isinstance(files.get("pending"), list) else []
    registry = files.get("registry") if isinstance(files.get("registry"), dict) else {}
    lending = files.get("lending") if isinstance(files.get("lending"), dict) else {}
    exchange = files.get("exchange") if isinstance(files.get("exchange"), dict) else {}
    governance = files.get("governance") if isinstance(files.get("governance"), dict) else {}
    treasury = files.get("treasury") if isinstance(files.get("treasury"), dict) else {}
    price = files.get("price") if isinstance(files.get("price"), dict) else {}
    forum = files.get("forum") if isinstance(files.get("forum"), dict) else {}
    achievements = files.get("achievements") if isinstance(files.get("achievements"), dict) else {}
    profiles = files.get("profiles") if isinstance(files.get("profiles"), dict) else {}
    faucet = files.get("faucet") if isinstance(files.get("faucet"), dict) else {}
    analytics = files.get("analytics") if isinstance(files.get("analytics"), dict) else {}
    incidents = files.get("incidents") if isinstance(files.get("incidents"), dict) else {}
    reports = files.get("reports") if isinstance(files.get("reports"), dict) else {}
    indexes = files.get("indexes") if isinstance(files.get("indexes"), dict) else {}

    posts = forum.get("posts", {}) if isinstance(forum.get("posts"), dict) else {}
    replies = sum(len(post.get("replies", []) or []) for post in posts.values() if isinstance(post, dict))
    moderation_items = sum(len(post.get("moderation_history", []) or []) for post in posts.values() if isinstance(post, dict))
    confirmed_transactions = normalize_transactions(chain)

    table_counts = {
        "blocks": len(chain.get("chain", []) or []),
        "confirmed_transactions": len(confirmed_transactions),
        "pending_transactions": len(pending),
        "peers": len(files.get("peers") or []),
        "registry_nodes": len(registry.get("registered_nodes", {}) or {}),
        "lending_loans": len(lending.get("loan_requests", {}) or {}),
        "exchange_offers": len(exchange.get("offers", {}) or {}),
        "governance_proposals": len(governance.get("proposals", {}) or {}),
        "governance_rule_changes": len(governance.get("rule_changes", []) or []),
        "treasury_proposals": len(treasury.get("proposals", {}) or {}),
        "treasury_ledger": len((indexes.get("indexes") or {}).get("treasury_ledger_index", []) or []),
        "price_signals": len(price.get("signals", {}) or {}),
        "forum_posts": len(posts),
        "forum_replies": replies,
        "forum_reports_moderation": len(reports.get("reports", []) or []) + moderation_items,
        "achievements": len(achievements.get("earned", {}) or {}),
        "profiles": len(profiles.get("profiles", {}) or {}),
        "faucet_claims": len(faucet.get("claims", {}) or {}),
        "analytics_events": len(analytics.get("events", []) or []),
        "incidents": len(incidents.get("incidents", []) or []),
        "reports": len(reports.get("reports", []) or []),
        "indexes_cache": 1 if indexes else 0,
        "audit_exports_metadata": 0,
        "storage_health_snapshots": 0,
    }

    return {
        table: {
            "record_count": count,
            "write_mode": "derived_cache" if table == "indexes_cache" else "dry_run_only",
        }
        for table, count in table_counts.items()
    }


def postgres_ready_tables(table_summary: dict[str, dict[str, Any]]) -> tuple[list[str], list[str]]:
    available = set(table_summary)
    ready = [table for table in POSTGRES_READY_TABLES if table in available]
    missing = [table for table in POSTGRES_READY_TABLES if table not in available]
    return ready, missing


def risk_score(errors: list[str], warnings: list[str], missing_optional: list[str]) -> str:
    if errors:
        return "high"
    if len(warnings) >= 3 or len(missing_optional) >= 8:
        return "medium"
    return "low"


def build_report(data_dir: Path, strict: bool = False) -> dict[str, Any]:
    errors: list[str] = []
    warnings: list[str] = []
    missing_optional: list[str] = []
    files: dict[str, Any] = {}

    data_dir = data_dir.resolve()
    files["chain"] = read_json(data_dir / REQUIRED_FILES["chain"], errors=errors, missing=missing_optional, required=True)
    for name, file_name in OPTIONAL_FILES.items():
        files[name] = read_json(data_dir / file_name, errors=errors, missing=missing_optional)

    backend_dir = backend_data_dir_for(data_dir)
    for name, file_name in BACKEND_FILES.items():
        files[name] = read_json(backend_dir / file_name, errors=errors, missing=missing_optional)

    if strict and missing_optional:
        errors.extend(f"strict mode missing optional file: {name}" for name in missing_optional)

    chain_height = 0
    latest_block_hash = None
    chain_valid = False
    if files.get("chain") is not None:
        chain_height, latest_block_hash, chain_errors, chain_warnings, chain_valid = validate_chain(files["chain"])
        errors.extend(chain_errors)
        warnings.extend(chain_warnings)

    record_counts = {name: count_records(name, data) for name, data in files.items()}
    table_summary = future_tables(files)
    ready_tables, missing_postgres_tables = postgres_ready_tables(table_summary)
    estimated_rows = {
        table: int(summary.get("record_count", 0))
        for table, summary in table_summary.items()
        if table in POSTGRES_READY_TABLES
    }
    if files.get("indexes") is not None:
        warnings.append("indexes.json is derived and should be rebuilt after any real database migration.")

    status = "ok" if not errors else "error"
    return {
        "success": status == "ok",
        "status": status,
        "checked_at": iso_now(),
        "data_dir": str(data_dir),
        "storage_backend": "json",
        "database_enabled": False,
        "chain_height": chain_height,
        "latest_block_hash": latest_block_hash,
        "chain_valid": chain_valid,
        "record_counts": record_counts,
        "missing_optional_files": sorted(set(missing_optional)),
        "warnings": warnings,
        "errors": errors,
        "future_tables_summary": table_summary,
        "postgres_ready_tables": ready_tables,
        "missing_postgres_tables": missing_postgres_tables,
        "estimated_rows_by_future_table": estimated_rows,
        "legacy_compatibility_notes": LEGACY_COMPATIBILITY_NOTES,
        "migration_risk_score": risk_score(errors, warnings, missing_optional),
        "rollback_required": True,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Vorliq JSON-to-database migration dry-run checker.")
    parser.add_argument("--data-dir", default=str(REPO_ROOT / "blockchain" / "data"), help="Path to blockchain/data JSON directory.")
    parser.add_argument("--output", help="Optional path for a dry-run JSON report. No production files are written.")
    parser.add_argument("--strict", action="store_true", help="Fail when optional state files are missing.")
    args = parser.parse_args(argv)

    report = build_report(Path(args.data_dir), strict=args.strict)
    if args.output:
        output_path = Path(args.output)
        output_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    print("Vorliq migration dry run")
    print(f"Status: {report['status']}")
    print(f"Data directory: {report['data_dir']}")
    print(f"Chain height: {report['chain_height']}")
    print(f"Latest block hash: {report['latest_block_hash'] or 'unavailable'}")
    print(f"Future tables: {len(report['future_tables_summary'])}")
    print(f"PostgreSQL-ready tables: {len(report['postgres_ready_tables'])}")
    print(f"Migration risk score: {report['migration_risk_score']}")
    print("Rollback required: yes")
    if report["missing_optional_files"]:
        print(f"Missing optional files: {', '.join(report['missing_optional_files'])}")
    if report["warnings"]:
        print(f"Warnings: {len(report['warnings'])}")
    if report["errors"]:
        print("Errors:")
        for error in report["errors"]:
            print(f"  - {error}")
    if args.output:
        print(f"Report written: {output_path}")

    return 0 if report["status"] == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(main())
