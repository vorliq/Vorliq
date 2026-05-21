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
    except Exception as exc:
        return False, str(exc)


def cleanup(database_url: str) -> str | None:
    psycopg, _Jsonb = load_psycopg()
    try:
        with psycopg.connect(database_url) as conn:
            conn.autocommit = True
            cleanup_shadow_database(conn)
        return None
    except Exception as exc:
        return str(exc)


def run_rehearsal(
    *,
    data_dir: Path,
    database_url: str,
    backend_data_dir: Path | None = None,
    strict: bool = False,
    keep_database_objects: bool = False,
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
        "database": {"host": info["host"], "database": info["database"]},
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
            "cleanup": {"success": cleanup_error is None, "error": cleanup_error},
        },
        "counts": verification.get("counts") if verification else migration.get("counts") if migration else {},
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
