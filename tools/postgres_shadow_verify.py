#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
from decimal import Decimal
from pathlib import Path
from typing import Any

from postgres_shadow_common import (
    DEFAULT_DATA_DIR,
    SECRET_TEXT_PATTERN,
    chain_blocks,
    compute_balances_from_transactions,
    confirmed_transactions,
    expected_counts,
    iso_now,
    load_psycopg,
    load_shadow_source,
    parse_database_url,
    pending_transactions,
    validate_shadow_database_url,
)


COUNT_TABLES = [
    "blocks",
    "confirmed_transactions",
    "pending_transactions",
    "profiles",
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
    "achievements",
    "faucet_claims",
    "incidents",
    "analytics_events",
    "reports",
]

PUBLIC_SCAN_TABLES = [
    "blocks",
    "confirmed_transactions",
    "pending_transactions",
    "profiles",
    "registry_nodes",
    "lending_loans",
    "exchange_offers",
    "governance_proposals",
    "governance_rule_changes",
    "treasury_proposals",
    "price_signals",
    "forum_posts",
    "forum_replies",
    "achievements",
    "faucet_claims",
    "incidents",
    "analytics_events",
    "reports",
]


def as_decimal(value: Any) -> Decimal:
    if value is None:
        return Decimal("0")
    return Decimal(str(value))


def db_counts(conn: Any) -> dict[str, int]:
    counts: dict[str, int] = {}
    with conn.cursor() as cursor:
        for table in COUNT_TABLES:
            cursor.execute(f"SELECT count(*) FROM {table}")
            counts[table] = int(cursor.fetchone()[0])
    return counts


def db_block_hashes(conn: Any) -> dict[int, str]:
    with conn.cursor() as cursor:
        cursor.execute("SELECT block_index, block_hash FROM blocks ORDER BY block_index")
        return {int(index): str(block_hash) for index, block_hash in cursor.fetchall()}


def db_transaction_ids(conn: Any) -> set[str]:
    with conn.cursor() as cursor:
        cursor.execute("SELECT tx_id FROM confirmed_transactions WHERE tx_id IS NOT NULL UNION SELECT tx_id FROM pending_transactions WHERE tx_id IS NOT NULL")
        return {str(row[0]) for row in cursor.fetchall()}


def db_balances(conn: Any) -> dict[str, Decimal]:
    balances: dict[str, Decimal] = {}
    with conn.cursor() as cursor:
        cursor.execute(
            """
            SELECT sender_address, receiver_address, amount FROM confirmed_transactions
            UNION ALL
            SELECT sender_address, receiver_address, amount FROM pending_transactions
            """
        )
        for sender, receiver, amount in cursor.fetchall():
            if amount is None:
                continue
            value = as_decimal(amount)
            if sender and sender != "SYSTEM":
                balances[str(sender)] = balances.get(str(sender), Decimal("0")) - value
            if receiver:
                balances[str(receiver)] = balances.get(str(receiver), Decimal("0")) + value
    return balances


def latest_db_block(conn: Any) -> tuple[int | None, str | None]:
    with conn.cursor() as cursor:
        cursor.execute("SELECT block_index, block_hash FROM blocks ORDER BY block_index DESC LIMIT 1")
        row = cursor.fetchone()
    if not row:
        return None, None
    return int(row[0]), str(row[1])


def scan_for_secret_text(conn: Any) -> list[str]:
    findings: list[str] = []
    with conn.cursor() as cursor:
        for table in PUBLIC_SCAN_TABLES:
            cursor.execute(f"SELECT row_to_json({table})::text FROM {table} LIMIT 500")
            for (payload,) in cursor.fetchall():
                if SECRET_TEXT_PATTERN.search(str(payload)):
                    findings.append(f"secret-like text found in {table}")
                    break
    return findings


def compare_counts(expected: dict[str, int], actual: dict[str, int], errors: list[str]) -> dict[str, dict[str, int]]:
    counts: dict[str, dict[str, int]] = {}
    for table in COUNT_TABLES:
        counts[table] = {
            "json": int(expected.get(table, 0)),
            "postgres": int(actual.get(table, 0)),
        }
        if counts[table]["json"] != counts[table]["postgres"]:
            errors.append(f"{table} count mismatch: json={counts[table]['json']} postgres={counts[table]['postgres']}")
    return counts


def build_verification_report(conn: Any, source: dict[str, Any]) -> dict[str, Any]:
    warnings = list(source.get("warnings", []))
    errors = list(source.get("errors", []))
    expected = expected_counts(source)
    actual = db_counts(conn)
    counts = compare_counts(expected, actual, errors)

    blocks = chain_blocks(source)
    expected_height = len(blocks) - 1 if blocks else None
    expected_latest_hash = str(blocks[-1].get("hash")) if blocks else None
    actual_height, actual_latest_hash = latest_db_block(conn)

    if expected_height != actual_height:
        errors.append(f"chain height mismatch: json={expected_height} postgres={actual_height}")
    if expected_latest_hash != actual_latest_hash:
        errors.append(f"latest block hash mismatch: json={expected_latest_hash} postgres={actual_latest_hash}")

    expected_hashes = {int(block.get("index") or 0): str(block.get("hash") or "") for block in blocks}
    actual_hashes = db_block_hashes(conn)
    for block_index, block_hash in expected_hashes.items():
        if actual_hashes.get(block_index) != block_hash:
            errors.append(f"block hash mismatch at index {block_index}")

    expected_transactions = confirmed_transactions(source) + pending_transactions(source)
    expected_tx_ids = {str(row["tx_id"]) for row in expected_transactions if row.get("tx_id")}
    actual_tx_ids = db_transaction_ids(conn)
    missing_tx_ids = sorted(expected_tx_ids - actual_tx_ids)
    extra_tx_ids = sorted(actual_tx_ids - expected_tx_ids)
    if missing_tx_ids:
        errors.append(f"transaction IDs missing from PostgreSQL: {', '.join(missing_tx_ids[:10])}")
    if extra_tx_ids:
        errors.append(f"unexpected transaction IDs in PostgreSQL: {', '.join(extra_tx_ids[:10])}")

    expected_balances = compute_balances_from_transactions(confirmed_transactions(source), pending_transactions(source))
    actual_balances = db_balances(conn)
    for address, expected_balance in expected_balances.items():
        actual_balance = actual_balances.get(address, Decimal("0"))
        if actual_balance != expected_balance:
            errors.append(f"balance mismatch for {address}: json={expected_balance} postgres={actual_balance}")
    for address in sorted(set(actual_balances) - set(expected_balances)):
        if actual_balances[address] != 0:
            errors.append(f"unexpected PostgreSQL balance for {address}: {actual_balances[address]}")

    if "VORLIQ_TREASURY" in expected_balances and actual_balances.get("VORLIQ_TREASURY", Decimal("0")) != expected_balances["VORLIQ_TREASURY"]:
        errors.append("treasury balance mismatch")

    secret_findings = scan_for_secret_text(conn)
    errors.extend(secret_findings)

    status = "fail" if errors else "warning" if warnings else "pass"
    return {
        "success": status != "fail",
        "status": status,
        "checked_at": iso_now(),
        "counts": counts,
        "chain": {
            "json_height": expected_height,
            "postgres_height": actual_height,
            "json_latest_block_hash": expected_latest_hash,
            "postgres_latest_block_hash": actual_latest_hash,
            "block_hashes_checked": len(expected_hashes),
        },
        "transactions": {
            "json_total": len(expected_transactions),
            "postgres_total": int(actual.get("confirmed_transactions", 0)) + int(actual.get("pending_transactions", 0)),
            "ids_checked": len(expected_tx_ids),
            "missing_ids": missing_tx_ids,
            "extra_ids": extra_tx_ids,
        },
        "balances": {
            "addresses_checked": len(expected_balances),
            "treasury_balance": str(expected_balances.get("VORLIQ_TREASURY")) if "VORLIQ_TREASURY" in expected_balances else None,
        },
        "secret_scan": {
            "tables_scanned": PUBLIC_SCAN_TABLES,
            "findings": secret_findings,
        },
        "warnings": warnings,
        "errors": errors,
    }


def run_shadow_verify(*, data_dir: Path, database_url: str, backend_data_dir: Path | None = None, strict: bool = False) -> dict[str, Any]:
    psycopg, _Jsonb = load_psycopg()
    source = load_shadow_source(data_dir, backend_data_dir=backend_data_dir, strict=strict)
    info = parse_database_url(database_url)
    print(f"[shadow-verify] Connecting to shadow database {info['redacted']}")
    with psycopg.connect(database_url) as conn:
        conn.autocommit = True
        return build_verification_report(conn, source)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Verify parity between copied Vorliq JSON state and a PostgreSQL shadow import.")
    parser.add_argument("--data-dir", default=str(DEFAULT_DATA_DIR), help="Path to copied blockchain/data JSON state.")
    parser.add_argument("--backend-data-dir", help="Optional copied backend/data directory for analytics/incidents/reports.")
    parser.add_argument("--database-url", default=os.environ.get("SHADOW_DATABASE_URL"), help="Shadow PostgreSQL URL, or SHADOW_DATABASE_URL.")
    parser.add_argument("--strict", action="store_true", help="Fail when optional JSON files are missing.")
    parser.add_argument("--output", help="Optional JSON report path.")
    parser.add_argument("--i-understand-this-is-not-production", action="store_true", help="Documents operator intent; production-looking hosts or names are still refused.")
    args = parser.parse_args(argv)

    database_url, validation_errors = validate_shadow_database_url(
        args.database_url,
        intent_flag=args.i_understand_this_is_not_production,
    )
    if validation_errors:
        report = {
            "success": False,
            "status": "fail",
            "checked_at": iso_now(),
            "counts": {},
            "warnings": [],
            "errors": validation_errors,
        }
    else:
        try:
            report = run_shadow_verify(
                data_dir=Path(args.data_dir),
                backend_data_dir=Path(args.backend_data_dir) if args.backend_data_dir else None,
                database_url=database_url or "",
                strict=args.strict,
            )
        except RuntimeError as exc:
            report = {
                "success": False,
                "status": "fail",
                "checked_at": iso_now(),
                "counts": {},
                "warnings": [],
                "errors": [str(exc)],
            }

    if args.output:
        Path(args.output).write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0 if report.get("success") else 1


if __name__ == "__main__":
    raise SystemExit(main())
