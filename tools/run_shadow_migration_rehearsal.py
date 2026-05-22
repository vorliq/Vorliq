#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

from migration_dry_run import build_report as build_dry_run_report
from postgres_schema_check import check_schema
from postgres_shadow_common import DEFAULT_DATA_DIR, iso_now, load_psycopg, parse_database_url, validate_shadow_database_url
from postgres_shadow_migrate import cleanup_shadow_database, run_shadow_migration
from postgres_shadow_verify import run_shadow_verify
from simulate_postgres_import import build_insert_plan

ROOT = Path(__file__).resolve().parents[1]
BLOCKCHAIN_DIR = ROOT / "blockchain"
if str(BLOCKCHAIN_DIR) not in sys.path:
    sys.path.insert(0, str(BLOCKCHAIN_DIR))

from storage_adapters.postgres_adapter import PostgresStorageAdapter, PostgresWriteBlockedError


def progress(message: str) -> None:
    print(f"[shadow-rehearsal] {message}")


def check_connection(database_url: str) -> tuple[bool, str | None]:
    psycopg, _Jsonb = load_psycopg()
    try:
        with psycopg.connect(database_url, connect_timeout=10) as conn:
            with conn.cursor() as cursor:
                cursor.execute("SELECT 1")
                cursor.fetchone()
        return True, None
    except Exception:
        return False, "PostgreSQL shadow connection failed"


def cleanup(database_url: str) -> str | None:
    psycopg, _Jsonb = load_psycopg()
    try:
        with psycopg.connect(database_url) as conn:
            conn.autocommit = True
            cleanup_shadow_database(conn)
        return None
    except Exception:
        return "PostgreSQL shadow cleanup failed"


def run_adapter_parity_check(database_url: str, verification: dict[str, Any]) -> dict[str, Any]:
    adapter = PostgresStorageAdapter(database_url=database_url)
    errors: list[str] = []
    warnings: list[str] = []
    health = adapter.health()

    if health.get("connected") is not True:
        errors.append("PostgreSQL adapter could not connect to the shadow database")

    table_counts = adapter.table_counts()
    verification_counts = verification.get("counts") or {}
    compared_counts: dict[str, dict[str, int]] = {}
    for table, expected in verification_counts.items():
        expected_count = int((expected or {}).get("postgres", 0))
        actual_count = int(table_counts.get(table, 0))
        compared_counts[table] = {
            "verification": expected_count,
            "adapter": actual_count,
        }
        if expected_count != actual_count:
            errors.append(f"adapter count mismatch for {table}: verification={expected_count} adapter={actual_count}")

    chain = adapter.load_chain()
    latest = adapter.latest_block_metadata()
    verification_chain = verification.get("chain") or {}
    if chain is None:
        errors.append("adapter did not load a chain from the shadow database")
    else:
        adapter_height = chain.get_block_height()
        adapter_hash = chain.get_latest_block().hash if chain.chain else None
        if verification_chain.get("postgres_height") != adapter_height:
            errors.append(
                f"adapter chain height mismatch: verification={verification_chain.get('postgres_height')} adapter={adapter_height}"
            )
        if verification_chain.get("postgres_latest_block_hash") != adapter_hash:
            errors.append("adapter latest block hash mismatch")
        if latest.get("height") != adapter_height:
            warnings.append("adapter latest metadata height did not match loaded chain height")

    domain_counts = {
        "blocks": len(adapter.load_blocks()),
        "confirmed_transactions": len(adapter.load_confirmed_transactions()),
        "pending_transactions": len(adapter.load_pending()),
        "profiles": len(adapter.load_profiles().profiles),
        "forum_posts": len(adapter.load_forum().posts),
        "governance_proposals": len(adapter.load_governance().proposals),
        "exchange_offers": len(adapter.load_exchange().offers),
        "lending_loans": len(adapter.load_lending_pool().loan_requests),
        "treasury_proposals": len(adapter.load_treasury().proposals),
        "registry_nodes": len(adapter.load_registry().registered_nodes),
        "faucet_claims": len(adapter.load_faucet().claims),
        "price_signals": len(adapter.load_price().signals),
        "achievements": sum(len(records) for records in adapter.load_achievements().earned.values()),
    }
    for table, actual_count in domain_counts.items():
        expected_count = int(table_counts.get(table, 0))
        if expected_count != actual_count:
            errors.append(f"adapter domain count mismatch for {table}: table={expected_count} domain={actual_count}")

    write_blocked = False
    try:
        adapter.save_pending([])
    except PostgresWriteBlockedError:
        write_blocked = True
    except Exception as exc:
        errors.append(f"adapter write block check raised unexpected error type: {type(exc).__name__}")
    if not write_blocked:
        errors.append("adapter writes were not blocked by default")

    status = "fail" if errors else "warning" if warnings else "pass"
    return {
        "success": status != "fail",
        "status": status,
        "checked_at": iso_now(),
        "adapter": "postgres",
        "shadow_only": True,
        "write_blocked_by_default": write_blocked,
        "health": {
            "status": health.get("status"),
            "connected": bool(health.get("connected")),
            "write_mode": health.get("write_mode"),
            "secrets_redacted": bool(health.get("secrets_redacted")),
        },
        "chain": latest,
        "counts": compared_counts,
        "domain_counts": domain_counts,
        "warnings": warnings,
        "errors": errors,
    }


def run_rehearsal(
    *,
    data_dir: Path,
    database_url: str,
    backend_data_dir: Path | None = None,
    strict: bool = False,
    keep_database_objects: bool = False,
    check_adapter: bool = False,
) -> dict[str, Any]:
    warnings: list[str] = []
    errors: list[str] = []
    info = parse_database_url(database_url)

    progress(f"Checking PostgreSQL connection to {info['redacted']}")
    connected, connection_error = check_connection(database_url)
    if not connected:
        errors.append(f"PostgreSQL connection failed: {connection_error}")

    progress("Running schema check")
    schema = check_schema()
    if not schema.get("success"):
        errors.extend(schema.get("errors", []))

    progress("Running migration dry run")
    dry_run = build_dry_run_report(data_dir, strict=strict)
    if not dry_run.get("success"):
        errors.extend(dry_run.get("errors", []))
    warnings.extend(dry_run.get("warnings", []))

    progress("Running import simulation")
    simulation = build_insert_plan(dry_run)
    if not simulation.get("success"):
        errors.extend(simulation.get("errors", []))
    warnings.extend(simulation.get("warnings", []))

    migration: dict[str, Any] | None = None
    verification: dict[str, Any] | None = None
    adapter_parity: dict[str, Any] | None = None
    cleanup_error: str | None = None
    if not errors:
        progress("Running shadow PostgreSQL import")
        migration = run_shadow_migration(
            data_dir=data_dir,
            backend_data_dir=backend_data_dir,
            database_url=database_url,
            strict=strict,
        )
        if not migration.get("success"):
            errors.extend(migration.get("errors", []))
        warnings.extend(migration.get("warnings", []))

    if not errors:
        progress("Running shadow parity verification")
        verification = run_shadow_verify(
            data_dir=data_dir,
            backend_data_dir=backend_data_dir,
            database_url=database_url,
            strict=strict,
        )
        if not verification.get("success"):
            errors.extend(verification.get("errors", []))
        warnings.extend(verification.get("warnings", []))

    if not errors and check_adapter and verification:
        progress("Running PostgreSQL adapter read parity check")
        adapter_parity = run_adapter_parity_check(database_url, verification)
        if not adapter_parity.get("success"):
            errors.extend(adapter_parity.get("errors", []))
        warnings.extend(adapter_parity.get("warnings", []))

    if connected and not keep_database_objects:
        progress("Cleaning up shadow database objects")
        cleanup_error = cleanup(database_url)
        if cleanup_error:
            warnings.append(f"shadow cleanup failed: {cleanup_error}")

    status = "fail" if errors else "warning" if warnings else "pass"
    return {
        "success": status != "fail",
        "status": status,
        "checked_at": iso_now(),
        "database": {"configured": True, "shadow_or_test": True},
        "postgres_active": False,
        "production_storage_unchanged": True,
        "json_source_modified": False,
        "steps": {
            "connection": {"success": connected, "error": connection_error},
            "schema_check": {"status": schema.get("status"), "success": schema.get("success")},
            "migration_dry_run": {"status": dry_run.get("status"), "success": dry_run.get("success")},
            "import_simulation": {"status": simulation.get("status"), "success": simulation.get("success")},
            "shadow_migration": {"status": migration.get("status"), "success": migration.get("success")} if migration else None,
            "shadow_verify": {"status": verification.get("status"), "success": verification.get("success")} if verification else None,
            "adapter_parity": {"status": adapter_parity.get("status"), "success": adapter_parity.get("success")} if adapter_parity else None,
            "cleanup": {"success": cleanup_error is None, "error": cleanup_error},
        },
        "counts": verification.get("counts") if verification else migration.get("counts") if migration else {},
        "adapter_parity": adapter_parity,
        "warnings": sorted(set(warnings)),
        "errors": errors,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run the full Vorliq PostgreSQL shadow migration rehearsal.")
    parser.add_argument("--data-dir", default=str(DEFAULT_DATA_DIR), help="Path to copied blockchain/data JSON state.")
    parser.add_argument("--backend-data-dir", help="Optional copied backend/data directory for analytics/incidents/reports.")
    parser.add_argument("--database-url", default=os.environ.get("SHADOW_DATABASE_URL"), help="Shadow PostgreSQL URL, or SHADOW_DATABASE_URL.")
    parser.add_argument("--strict", action="store_true", help="Fail when optional JSON files are missing.")
    parser.add_argument("--output", help="Optional JSON report path.")
    parser.add_argument("--keep-database-objects", action="store_true", help="Leave imported shadow tables in place for manual inspection.")
    parser.add_argument("--check-adapter", action="store_true", help="Run shadow-only PostgreSQL adapter read parity after verification.")
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
            report = run_rehearsal(
                data_dir=Path(args.data_dir),
                backend_data_dir=Path(args.backend_data_dir) if args.backend_data_dir else None,
                database_url=database_url or "",
                strict=args.strict,
                keep_database_objects=args.keep_database_objects,
                check_adapter=args.check_adapter,
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
        except Exception:
            report = {
                "success": False,
                "status": "fail",
                "checked_at": iso_now(),
                "counts": {},
                "warnings": [],
                "errors": ["PostgreSQL shadow rehearsal failed; check the local shadow database configuration."],
            }

    if args.output:
        Path(args.output).write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    print("Vorliq PostgreSQL shadow migration rehearsal")
    print(f"Status: {report['status']}")
    print("Production PostgreSQL active: false")
    print("JSON source modified: false")
    if report.get("warnings"):
        print(f"Warnings: {len(report['warnings'])}")
    if report.get("errors"):
        print("Errors:")
        for error in report["errors"]:
            print(f"  - {error}")
    if args.output:
        print(f"Report written: {args.output}")
    return 0 if report.get("success") else 1


if __name__ == "__main__":
    raise SystemExit(main())
