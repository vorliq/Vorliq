#!/usr/bin/env python3
from __future__ import annotations

import argparse
import re
import sys
import time
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATABASE_DIR = REPO_ROOT / "database"

REQUIRED_TABLES = [
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

REQUIRED_INDEXES = [
    "idx_blocks_block_index",
    "idx_blocks_block_hash",
    "idx_confirmed_transactions_tx_id",
    "idx_confirmed_transactions_sender_address",
    "idx_confirmed_transactions_receiver_address",
    "idx_pending_transactions_tx_id",
    "idx_pending_transactions_sender_address",
    "idx_pending_transactions_receiver_address",
    "idx_registry_nodes_status",
    "idx_lending_loans_status",
    "idx_exchange_offers_status",
    "idx_governance_proposals_status",
    "idx_treasury_proposals_status",
    "idx_treasury_ledger_tx_id",
    "idx_price_signals_timestamp",
    "idx_forum_posts_timestamp",
    "idx_forum_replies_post_id",
    "idx_reports_status",
    "idx_achievements_wallet_address",
    "idx_profiles_reputation_score",
    "idx_faucet_claims_wallet_address",
    "idx_analytics_events_timestamp",
    "idx_incidents_status",
    "idx_audit_exports_chain_height",
    "idx_storage_health_checked_at",
]

REQUIRED_SQL_FILES = [
    "schema.sql",
    "indexes.sql",
    "constraints.sql",
    "views.sql",
    "migrations/001_initial_schema.sql",
]


def read_sql_files(database_dir: Path) -> tuple[dict[str, str], list[str]]:
    files: dict[str, str] = {}
    errors: list[str] = []
    for relative in REQUIRED_SQL_FILES:
        path = database_dir / relative
        if not path.exists():
            errors.append(f"missing required SQL file: {relative}")
            continue
        try:
            files[relative] = path.read_text(encoding="utf-8")
        except Exception as exc:
            errors.append(f"could not read {relative}: {exc}")
    return files, errors


def find_tables(sql: str) -> set[str]:
    return {
        match.group(1).lower()
        for match in re.finditer(
            r"\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)\b",
            sql,
            flags=re.IGNORECASE,
        )
    }


def find_indexes(sql: str) -> set[str]:
    return {
        match.group(1).lower()
        for match in re.finditer(
            r"\bcreate\s+(?:unique\s+)?index\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)\b",
            sql,
            flags=re.IGNORECASE,
        )
    }


def check_schema(database_dir: Path = DEFAULT_DATABASE_DIR) -> dict[str, Any]:
    database_dir = database_dir.resolve()
    files, errors = read_sql_files(database_dir)
    combined_sql = "\n".join(files.values())
    table_names = find_tables(combined_sql)
    index_names = find_indexes(combined_sql)

    missing_tables = [table for table in REQUIRED_TABLES if table not in table_names]
    missing_indexes = [index for index in REQUIRED_INDEXES if index not in index_names]
    files_missing_preparation_comment = [
        name for name, sql in files.items() if not re.search(r"preparation[\s-]+only", sql, flags=re.IGNORECASE)
    ]

    errors.extend(f"missing required table: {table}" for table in missing_tables)
    errors.extend(f"missing required index: {index}" for index in missing_indexes)
    errors.extend(
        f"{name} must include a preparation-only status comment"
        for name in files_missing_preparation_comment
    )

    status = "pass" if not errors else "fail"
    return {
        "success": status == "pass",
        "status": status,
        "checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "database_dir": "[redacted]",
        "required_sql_files": REQUIRED_SQL_FILES,
        "required_tables": REQUIRED_TABLES,
        "required_indexes": REQUIRED_INDEXES,
        "tables_found": sorted(table_names),
        "indexes_found": sorted(index_names),
        "missing_tables": missing_tables,
        "missing_indexes": missing_indexes,
        "files_missing_preparation_comment": files_missing_preparation_comment,
        "postgres_connection_attempted": False,
        "postgres_required": False,
        "errors": errors,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate Vorliq preparation-only PostgreSQL schema files.")
    parser.add_argument("--database-dir", default=str(DEFAULT_DATABASE_DIR), help="Path to the database schema directory.")
    args = parser.parse_args(argv)

    result = check_schema(Path(args.database_dir))

    print("Vorliq PostgreSQL schema check")
    print(f"Status: {result['status']}")
    print("PostgreSQL connection attempted: no")
    print(f"Tables found: {len(result['tables_found'])}/{len(REQUIRED_TABLES)} required")
    print(f"Indexes found: {len(result['indexes_found'])}/{len(REQUIRED_INDEXES)} required")
    if result["missing_tables"]:
        print("Missing tables:")
        for table in result["missing_tables"]:
            print(f"  - {table}")
    if result["missing_indexes"]:
        print("Missing indexes:")
        for index in result["missing_indexes"]:
            print(f"  - {index}")
    if result["files_missing_preparation_comment"]:
        print("Files missing preparation-only comment:")
        for file_name in result["files_missing_preparation_comment"]:
            print(f"  - {file_name}")
    if result["errors"]:
        print("Errors:")
        for error in result["errors"]:
            print(f"  - {error}")

    return 0 if result["success"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
