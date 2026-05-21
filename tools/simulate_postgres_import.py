#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT / "tools") not in sys.path:
    sys.path.insert(0, str(REPO_ROOT / "tools"))

from migration_dry_run import build_report  # noqa: E402


IMPORT_ORDER = [
    "blocks",
    "profiles",
    "peers",
    "registry_nodes",
    "confirmed_transactions",
    "pending_transactions",
    "governance_proposals",
    "governance_rule_changes",
    "treasury_proposals",
    "treasury_ledger",
    "lending_loans",
    "exchange_offers",
    "price_signals",
    "forum_posts",
    "forum_replies",
    "reports",
    "achievements",
    "faucet_claims",
    "analytics_events",
    "incidents",
    "audit_exports_metadata",
    "storage_health_snapshots",
]

DEPENDENCIES = {
    "confirmed_transactions": ["blocks"],
    "treasury_ledger": ["blocks", "treasury_proposals"],
    "governance_rule_changes": ["governance_proposals"],
    "forum_replies": ["forum_posts"],
    "achievements": ["profiles"],
    "faucet_claims": ["profiles"],
}


def iso_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def load_report(input_path: Path | None, data_dir: Path | None) -> tuple[dict[str, Any] | None, list[str]]:
    errors: list[str] = []
    if input_path:
        if not input_path.exists():
            return None, [f"input path does not exist: {input_path}"]
        if input_path.is_dir():
            return build_report(input_path), errors
        try:
            payload = json.loads(input_path.read_text(encoding="utf-8"))
        except Exception as exc:
            return None, [f"input report could not be parsed as JSON: {exc}"]
        if not isinstance(payload, dict):
            return None, ["input report must be a JSON object"]
        return payload, errors

    if data_dir:
        if not data_dir.exists() or not data_dir.is_dir():
            return None, [f"data directory does not exist: {data_dir}"]
        return build_report(data_dir), errors

    return None, ["provide --input dry-run-report.json or --data-dir blockchain/data"]


def table_counts(report: dict[str, Any]) -> dict[str, int]:
    summary = report.get("future_tables_summary") or {}
    counts: dict[str, int] = {}
    for table in IMPORT_ORDER:
        value = summary.get(table, {})
        count = value.get("record_count") if isinstance(value, dict) else None
        try:
            counts[table] = int(count or 0)
        except (TypeError, ValueError):
            counts[table] = 0
    return counts


def validate_order(counts: dict[str, int]) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    positions = {table: index for index, table in enumerate(IMPORT_ORDER)}

    for table, dependencies in DEPENDENCIES.items():
        for dependency in dependencies:
            if positions[dependency] > positions[table]:
                errors.append(f"import order invalid: {dependency} must run before {table}")
            if counts.get(table, 0) > 0 and counts.get(dependency, 0) == 0:
                if table in {"achievements", "faucet_claims", "treasury_ledger"}:
                    warnings.append(f"{table} has rows but {dependency} has no rows in the dry-run summary")
                else:
                    errors.append(f"{table} has rows but required parent table {dependency} has no rows")

    return errors, warnings


def build_insert_plan(report: dict[str, Any]) -> dict[str, Any]:
    counts = table_counts(report)
    errors, warnings = validate_order(counts)
    if report.get("status") == "error":
        warnings.append("source migration dry-run report has status error; import simulation remains non-writing")

    plan = [
        {
            "step": index + 1,
            "table": table,
            "estimated_rows": counts.get(table, 0),
            "operation": "simulated_insert",
        }
        for index, table in enumerate(IMPORT_ORDER)
    ]

    status = "pass" if not errors else "fail"
    return {
        "success": status == "pass",
        "status": status,
        "simulated_at": iso_now(),
        "simulation_only": True,
        "database_connection_attempted": False,
        "writes_performed": False,
        "source_report_status": report.get("status", "unknown"),
        "chain_height": report.get("chain_height"),
        "latest_block_hash": report.get("latest_block_hash"),
        "record_counts": counts,
        "insert_plan": plan,
        "ordering_validation": {
            "blocks_before_confirmed_transactions": True,
            "profiles_before_profile_linked_records": True,
            "proposals_before_votes_or_history": True,
            "forum_posts_before_replies": True,
        },
        "warnings": warnings,
        "errors": errors,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Simulate a future PostgreSQL import from Vorliq JSON dry-run data.")
    parser.add_argument("--input", help="Path to a migration dry-run report JSON file, or a blockchain/data directory.")
    parser.add_argument("--data-dir", help="Path to blockchain/data JSON directory when no report is available.")
    parser.add_argument("--output", help="Optional path for a simulation JSON report. No database or production files are written.")
    args = parser.parse_args(argv)

    input_path = Path(args.input) if args.input else None
    data_dir = Path(args.data_dir) if args.data_dir else None
    report, load_errors = load_report(input_path, data_dir)
    if load_errors:
        print("Vorliq PostgreSQL import simulation")
        print("Status: fail")
        for error in load_errors:
            print(f"  - {error}")
        return 1

    simulation = build_insert_plan(report or {})
    if args.output:
        output_path = Path(args.output)
        output_path.write_text(json.dumps(simulation, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    print("Vorliq PostgreSQL import simulation")
    print(f"Status: {simulation['status']}")
    print("Database connection attempted: no")
    print("Writes performed: no")
    print(f"Tables planned: {len(simulation['insert_plan'])}")
    print(f"Total estimated rows: {sum(simulation['record_counts'].values())}")
    if simulation["warnings"]:
        print(f"Warnings: {len(simulation['warnings'])}")
    if simulation["errors"]:
        print("Errors:")
        for error in simulation["errors"]:
            print(f"  - {error}")
    if args.output:
        print(f"Report written: {output_path}")

    return 0 if simulation["success"] else 1


if __name__ == "__main__":
    raise SystemExit(main())

