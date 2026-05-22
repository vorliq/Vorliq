import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TOOLS = ROOT / "tools"
if str(TOOLS) not in sys.path:
    sys.path.insert(0, str(TOOLS))
if str(Path(__file__).resolve().parent) not in sys.path:
    sys.path.insert(0, str(Path(__file__).resolve().parent))

from migration_dry_run import build_report
from postgres_schema_check import REQUIRED_TABLES, check_schema
from postgres_shadow_common import SHADOW_TABLES
from simulate_postgres_import import build_insert_plan, main as simulate_main

from test_migration_dry_run import make_data_dir, write_json


def test_postgres_schema_check_passes():
    result = check_schema(ROOT / "database")

    assert result["status"] == "pass"
    assert result["postgres_connection_attempted"] is False
    assert "blocks" in result["tables_found"]
    assert "confirmed_transactions" in result["tables_found"]
    assert "idx_confirmed_transactions_tx_id" in result["indexes_found"]


def test_shadow_cleanup_table_list_covers_required_schema_tables():
    missing = set(REQUIRED_TABLES) - set(SHADOW_TABLES)

    assert missing == set()


def test_postgres_schema_check_fails_on_missing_required_table(tmp_path):
    fixture = tmp_path / "database"
    shutil.copytree(ROOT / "database", fixture)
    schema_path = fixture / "schema.sql"
    schema_path.write_text(
        schema_path.read_text(encoding="utf-8").replace("CREATE TABLE IF NOT EXISTS blocks", "CREATE TABLE IF NOT EXISTS missing_blocks"),
        encoding="utf-8",
    )

    result = check_schema(fixture)

    assert result["status"] == "fail"
    assert "blocks" in result["missing_tables"]


def test_simulate_postgres_import_validates_ordering(tmp_path):
    data_dir = make_data_dir(tmp_path)
    write_json(data_dir / "pending.json", [])
    write_json(data_dir / "forum.json", {"posts": {"post-1": {"replies": [{"reply_id": "reply-1"}]}}})
    report = build_report(data_dir)

    simulation = build_insert_plan(report)

    assert simulation["status"] == "pass"
    assert simulation["database_connection_attempted"] is False
    assert simulation["writes_performed"] is False
    tables = [step["table"] for step in simulation["insert_plan"]]
    assert tables.index("blocks") < tables.index("confirmed_transactions")
    assert tables.index("forum_posts") < tables.index("forum_replies")


def test_simulate_postgres_import_refuses_missing_input(tmp_path):
    missing = tmp_path / "missing-report.json"

    assert simulate_main(["--input", str(missing)]) == 1


def test_simulate_postgres_import_accepts_report_file(tmp_path):
    data_dir = make_data_dir(tmp_path)
    report = build_report(data_dir)
    report_path = tmp_path / "report.json"
    report_path.write_text(json.dumps(report), encoding="utf-8")
    output_path = tmp_path / "simulation.json"

    result = simulate_main(["--input", str(report_path), "--output", str(output_path)])

    assert result == 0
    payload = json.loads(output_path.read_text(encoding="utf-8"))
    assert payload["simulation_only"] is True
    assert payload["record_counts"]["blocks"] == 1
