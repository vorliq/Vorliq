import json
import os
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]
TOOLS = ROOT / "tools"
FIXTURE_DIR = ROOT / "tests" / "fixtures" / "migration" / "sample_data"
if str(TOOLS) not in sys.path:
    sys.path.insert(0, str(TOOLS))

from postgres_schema_check import check_schema
from postgres_shadow_common import load_psycopg, load_shadow_source, validate_shadow_database_url
from postgres_shadow_migrate import main as migrate_main, run_shadow_migration
from postgres_shadow_verify import run_shadow_verify
from run_shadow_migration_rehearsal import main as rehearsal_main, run_adapter_parity_check, run_rehearsal
from storage_adapters.postgres_adapter import PostgresStorageAdapter, PostgresWriteBlockedError


def shadow_database_url():
    return os.environ.get("SHADOW_DATABASE_URL")


def require_shadow_database():
    url = shadow_database_url()
    if not url:
        pytest.skip("SHADOW_DATABASE_URL is not configured for local PostgreSQL integration")
    try:
        load_psycopg()
    except RuntimeError:
        pytest.skip("psycopg is not installed for local PostgreSQL integration")
    errors = validate_shadow_database_url(url)[1]
    if errors:
        pytest.skip(f"SHADOW_DATABASE_URL is not a safe shadow database: {errors}")
    return url


def test_shadow_migrate_refuses_database_names_without_shadow_or_test():
    result = migrate_main([
        "--data-dir",
        str(FIXTURE_DIR),
        "--database-url",
        "postgresql://user:password@localhost/vorliq",
    ])

    assert result == 1


def test_shadow_migrate_refuses_production_looking_database_even_with_flag():
    errors = validate_shadow_database_url(
        "postgresql://user:password@vorliq.org/vorliq_production",
        intent_flag=True,
    )[1]

    assert any("production-like" in error for error in errors)
    assert any("host looks production-like" in error for error in errors)


def test_shadow_migrate_handles_missing_optional_files_without_strict_failure():
    source = load_shadow_source(FIXTURE_DIR, strict=False)

    assert source["errors"] == []
    assert any("peers.json" in warning for warning in source["warnings"])


def test_run_rehearsal_refuses_missing_database_url(monkeypatch):
    monkeypatch.delenv("SHADOW_DATABASE_URL", raising=False)

    result = rehearsal_main(["--data-dir", str(FIXTURE_DIR)])

    assert result == 1


def test_schema_check_still_passes():
    result = check_schema(ROOT / "database")

    assert result["status"] == "pass"


def test_shadow_verify_passes_on_fixture_when_postgres_available():
    url = require_shadow_database()

    migration = run_shadow_migration(data_dir=FIXTURE_DIR, database_url=url)
    verification = run_shadow_verify(data_dir=FIXTURE_DIR, database_url=url)

    assert migration["status"] == "pass"
    assert verification["status"] in {"pass", "warning"}
    assert verification["errors"] == []
    assert verification["counts"]["blocks"]["json"] == 2
    assert verification["counts"]["blocks"]["postgres"] == 2


def test_shadow_verify_fails_on_wrong_latest_hash_when_postgres_available():
    url = require_shadow_database()
    psycopg, _Jsonb = load_psycopg()

    run_shadow_migration(data_dir=FIXTURE_DIR, database_url=url)
    with psycopg.connect(url) as conn:
        conn.autocommit = True
        with conn.cursor() as cursor:
            cursor.execute("DELETE FROM confirmed_transactions WHERE block_index = 1")
            cursor.execute("DELETE FROM treasury_ledger WHERE block_index = 1")
            cursor.execute("UPDATE blocks SET block_hash = '0000wronglatesthashfixture0000' WHERE block_index = 1")

    verification = run_shadow_verify(data_dir=FIXTURE_DIR, database_url=url)

    assert verification["status"] == "fail"
    assert any("latest block hash mismatch" in error for error in verification["errors"])


def test_run_rehearsal_works_when_postgres_available(tmp_path):
    url = require_shadow_database()
    output = tmp_path / "shadow-report.json"

    report = run_rehearsal(data_dir=FIXTURE_DIR, database_url=url)
    output.write_text(json.dumps(report), encoding="utf-8")

    assert report["status"] in {"pass", "warning"}
    assert report["errors"] == []
    assert json.loads(output.read_text(encoding="utf-8"))["success"] is True


def test_postgres_adapter_reads_shadow_fixture_when_postgres_available():
    url = require_shadow_database()

    run_shadow_migration(data_dir=FIXTURE_DIR, database_url=url)
    verification = run_shadow_verify(data_dir=FIXTURE_DIR, database_url=url)
    adapter = PostgresStorageAdapter(database_url=url)
    health = adapter.health()
    chain = adapter.load_chain()
    counts = adapter.table_counts()

    assert health["status"] == "ok"
    assert health["write_mode"] == "disabled"
    assert "vorliq_shadow_password" not in json.dumps(health)
    assert chain is not None
    assert chain.get_block_height() == verification["chain"]["postgres_height"]
    assert chain.get_latest_block().hash == verification["chain"]["postgres_latest_block_hash"]
    assert len(adapter.load_blocks()) == verification["counts"]["blocks"]["postgres"]
    assert len(adapter.load_confirmed_transactions()) == verification["counts"]["confirmed_transactions"]["postgres"]
    assert len(adapter.load_pending()) == verification["counts"]["pending_transactions"]["postgres"]
    assert len(adapter.load_profiles().profiles) == verification["counts"]["profiles"]["postgres"]
    assert len(adapter.load_forum().posts) == verification["counts"]["forum_posts"]["postgres"]
    assert len(adapter.load_governance().proposals) == verification["counts"]["governance_proposals"]["postgres"]
    assert len(adapter.load_exchange().offers) == verification["counts"]["exchange_offers"]["postgres"]
    assert len(adapter.load_lending_pool().loan_requests) == verification["counts"]["lending_loans"]["postgres"]
    assert len(adapter.load_treasury().proposals) == verification["counts"]["treasury_proposals"]["postgres"]
    assert len(adapter.load_registry().registered_nodes) == verification["counts"]["registry_nodes"]["postgres"]
    assert len(adapter.load_faucet().claims) == verification["counts"]["faucet_claims"]["postgres"]
    assert len(adapter.load_price().signals) == verification["counts"]["price_signals"]["postgres"]
    assert sum(len(records) for records in adapter.load_achievements().earned.values()) == verification["counts"]["achievements"]["postgres"]
    assert counts["blocks"] == 2
    with pytest.raises(PostgresWriteBlockedError):
        adapter.save_pending([])


def test_run_rehearsal_adapter_parity_when_postgres_available():
    url = require_shadow_database()

    report = run_rehearsal(data_dir=FIXTURE_DIR, database_url=url, check_adapter=True)

    assert report["status"] in {"pass", "warning"}
    assert report["errors"] == []
    assert report["adapter_parity"]["status"] == "pass"
    assert report["adapter_parity"]["write_blocked_by_default"] is True


def test_adapter_parity_helper_compares_verification_counts_when_postgres_available():
    url = require_shadow_database()

    run_shadow_migration(data_dir=FIXTURE_DIR, database_url=url)
    verification = run_shadow_verify(data_dir=FIXTURE_DIR, database_url=url)
    parity = run_adapter_parity_check(url, verification)

    assert parity["status"] == "pass"
    assert parity["errors"] == []
    assert parity["counts"]["blocks"]["adapter"] == 2
