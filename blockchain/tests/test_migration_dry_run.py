import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT / "tools") not in sys.path:
    sys.path.insert(0, str(ROOT / "tools"))

from block import Block
from blockchain import Blockchain
from migration_dry_run import build_report, main


def write_json(path, payload):
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def valid_chain_payload():
    blockchain = Blockchain()
    return {
        "coin": "VLQ",
        "difficulty": blockchain.difficulty,
        "mining_reward": blockchain.mining_reward,
        "initial_mining_reward": blockchain.initial_mining_reward,
        "maximum_supply": blockchain.maximum_supply,
        "halving_interval": blockchain.halving_interval,
        "chain": [block.to_dict() for block in blockchain.chain],
    }


def make_data_dir(tmp_path):
    data_dir = tmp_path / "blockchain" / "data"
    data_dir.mkdir(parents=True)
    write_json(data_dir / "chain.json", valid_chain_payload())
    return data_dir


def test_migration_dry_run_works_on_temp_data(tmp_path):
    data_dir = make_data_dir(tmp_path)
    write_json(data_dir / "pending.json", [])

    report = build_report(data_dir)

    assert report["status"] == "ok"
    assert report["storage_backend"] == "json"
    assert report["database_enabled"] is False
    assert report["chain_height"] == 0
    assert report["record_counts"]["chain"] == 1
    assert "blocks" in report["future_tables_summary"]
    assert "blocks" in report["postgres_ready_tables"]
    assert report["missing_postgres_tables"] == []
    assert report["estimated_rows_by_future_table"]["blocks"] == 1
    assert report["migration_risk_score"] in {"low", "medium", "high"}
    assert report["rollback_required"] is True


def test_missing_optional_files_are_reported_without_failing(tmp_path):
    data_dir = make_data_dir(tmp_path)

    report = build_report(data_dir)

    assert report["status"] == "ok"
    assert "pending.json" in report["missing_optional_files"]


def test_strict_mode_fails_on_missing_optional_files(tmp_path):
    data_dir = make_data_dir(tmp_path)

    report = build_report(data_dir, strict=True)

    assert report["status"] == "error"
    assert any("strict mode missing optional file" in error for error in report["errors"])


def test_dry_run_output_does_not_modify_input_files(tmp_path):
    data_dir = make_data_dir(tmp_path)
    chain_path = data_dir / "chain.json"
    before = chain_path.read_text(encoding="utf-8")
    output_path = tmp_path / "migration-dry-run-report.json"

    result = main(["--data-dir", str(data_dir), "--output", str(output_path)])

    assert result == 0
    assert output_path.exists()
    assert chain_path.read_text(encoding="utf-8") == before
    assert not (data_dir / "indexes.json").exists()


def test_chain_validation_catches_broken_links(tmp_path):
    data_dir = make_data_dir(tmp_path)
    payload = valid_chain_payload()
    genesis = Block.from_dict(payload["chain"][0])
    second = Block(
        index=1,
        transactions=[],
        previous_hash="bad-previous-hash",
        timestamp=genesis.timestamp + 31,
        difficulty=genesis.difficulty,
    )
    second.proof_of_work(second.difficulty)
    payload["chain"].append(second.to_dict())
    write_json(data_dir / "chain.json", payload)

    report = build_report(data_dir)

    assert report["status"] == "error"
    assert any("previous_hash" in error for error in report["errors"])


def test_report_contains_future_table_summary(tmp_path):
    data_dir = make_data_dir(tmp_path)
    write_json(data_dir / "forum.json", {"posts": {"post-1": {"replies": [{"reply_id": "reply-1"}]}}})
    write_json(data_dir / "profiles.json", {"profiles": {"VLQ_PROFILE": {"display_name": "Alice"}}})

    report = build_report(data_dir)

    tables = report["future_tables_summary"]
    assert tables["forum_posts"]["record_count"] == 1
    assert tables["forum_replies"]["record_count"] == 1
    assert tables["profiles"]["record_count"] == 1
    assert tables["indexes_cache"]["write_mode"] == "derived_cache"
    assert report["legacy_compatibility_notes"]
