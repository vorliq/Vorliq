from __future__ import annotations

import io
import json
import sys
import tarfile
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BLOCKCHAIN_DIR = ROOT / "blockchain"
sys.path.insert(0, str(BLOCKCHAIN_DIR))
sys.path.insert(0, str(ROOT / "tools"))

from block import Block  # noqa: E402
from blockchain import Blockchain  # noqa: E402
from chain_forensic_reconciliation import build_directory_report, build_report  # noqa: E402


def payload(blockchain: Blockchain) -> dict:
    return {"difficulty": blockchain.difficulty, "chain": [block.to_dict() for block in blockchain.chain]}


def write_archive(
    path: Path,
    chain_data: dict,
    pending: list | None = None,
    profiles: dict | None = None,
) -> None:
    files = {
        "vorliq-backup/blockchain/data/chain.json": chain_data,
        "vorliq-backup/blockchain/data/pending.json": pending or [],
        "vorliq-backup/blockchain/data/faucet.json": {"claims": {}},
        "vorliq-backup/blockchain/data/lending.json": {"loan_requests": {}},
        "vorliq-backup/blockchain/data/treasury.json": {"proposals": {}},
        "vorliq-backup/blockchain/data/governance.json": {"proposals": {}, "rule_changes": []},
        "vorliq-backup/blockchain/data/forum.json": {"posts": {}},
        "vorliq-backup/blockchain/data/exchange.json": {"offers": {}},
        "vorliq-backup/blockchain/data/profiles.json": {"profiles": profiles or {}},
        "vorliq-backup/backend/data/incidents.json": {"incidents": []},
    }
    with tarfile.open(path, "w:gz") as archive:
        for name, data in files.items():
            encoded = json.dumps(data).encode("utf-8")
            member = tarfile.TarInfo(name)
            member.size = len(encoded)
            archive.addfile(member, io.BytesIO(encoded))


def broken_link_chain() -> Blockchain:
    blockchain = Blockchain()
    blockchain.mine_pending_transactions("miner-one")
    blockchain.chain[-1].timestamp -= blockchain.BLOCK_TIME_MINIMUM + 1
    blockchain.chain[-1].proof_of_work(blockchain.difficulty)
    blockchain.mine_pending_transactions("miner-two")
    original_second = blockchain.chain[2]
    replacement_first = Block(
        index=1,
        transactions=[],
        previous_hash=blockchain.chain[0].hash,
        timestamp=blockchain.chain[0].timestamp + blockchain.BLOCK_TIME_MINIMUM + 1,
        miner_address="replacement-miner",
    )
    replacement_first.proof_of_work(blockchain.difficulty)
    blockchain.chain = [blockchain.chain[0], replacement_first, original_second]
    return blockchain


def test_report_is_sanitized_and_quantifies_invalid_newer_archive(tmp_path):
    valid = Blockchain()
    valid_archive = tmp_path / "vorliq-backup-valid.tar.gz"
    invalid_archive = tmp_path / "vorliq-backup-invalid.tar.gz"
    write_archive(valid_archive, payload(valid), profiles={"member": {"status": "active"}})
    time.sleep(0.01)
    write_archive(
        invalid_archive,
        payload(broken_link_chain()),
        pending=[{"category": "transfer"}],
        profiles={"member": {"status": "updated"}},
    )

    report = build_report(tmp_path)
    encoded = json.dumps(report)

    assert report["status"] == "valid_archive_selected"
    assert report["newer_invalid_archive_count"] == 1
    assert report["latest_invalid_comparison"]["validation"]["code"] == "BLOCK_LINK_MISMATCH"
    assert report["latest_invalid_comparison"]["blocks_not_restored"] == 2
    assert report["latest_invalid_comparison"]["prefix_before_failure_validation"]["status"] == "valid"
    assert report["user_visible_record_deltas"]["profiles"]["later_changed_count"] == 1
    assert report["sanitized_classification"]["broken_predecessor_or_branch_boundary_pattern"] is True
    assert "vorliq-backup-invalid" not in encoded
    assert "replacement-miner" not in encoded


def test_preserved_state_directory_report_is_sanitized(tmp_path):
    selected_directory = tmp_path / "selected"
    invalid_directory = tmp_path / "invalid"
    selected_directory.mkdir()
    invalid_directory.mkdir()
    selected = Blockchain()

    (selected_directory / "chain.json").write_text(json.dumps(payload(selected)), encoding="utf-8")
    (invalid_directory / "chain.json").write_text(json.dumps(payload(broken_link_chain())), encoding="utf-8")
    (selected_directory / "profiles.json").write_text(
        json.dumps({"profiles": {"member": {"status": "active"}}}),
        encoding="utf-8",
    )
    (invalid_directory / "profiles.json").write_text(
        json.dumps({"profiles": {"member": {"status": "updated"}}}),
        encoding="utf-8",
    )

    report = build_directory_report(selected_directory, invalid_directory)
    encoded = json.dumps(report)

    assert report["status"] == "preserved_state_compared"
    assert report["preserved_invalid_comparison"]["validation"]["code"] == "BLOCK_LINK_MISMATCH"
    assert report["user_visible_record_deltas"]["profiles"]["later_changed_count"] == 1
    assert "replacement-miner" not in encoded
