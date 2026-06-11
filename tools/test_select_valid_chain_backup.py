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

from blockchain import Blockchain
from select_valid_chain_backup import evaluate_archive, select_newest_valid_archive


def chain_payload(blockchain: Blockchain) -> dict:
    return {
        "difficulty": blockchain.difficulty,
        "chain": [block.to_dict() for block in blockchain.chain],
    }


def write_archive(path: Path, data: dict) -> None:
    encoded = json.dumps(data).encode("utf-8")
    member = tarfile.TarInfo("vorliq-backup/blockchain/data/chain.json")
    member.size = len(encoded)
    with tarfile.open(path, "w:gz") as archive:
        archive.addfile(member, io.BytesIO(encoded))


def test_selects_newest_valid_archive_after_invalid_archive(tmp_path):
    valid = Blockchain()
    invalid = chain_payload(valid)
    invalid["chain"][0]["hash"] = "invalid"

    older_valid = tmp_path / "vorliq-backup-older.tar.gz"
    newer_invalid = tmp_path / "vorliq-backup-newer.tar.gz"
    write_archive(older_valid, chain_payload(valid))
    time.sleep(0.01)
    write_archive(newer_invalid, invalid)

    selected, summary = select_newest_valid_archive(tmp_path)

    assert selected == older_valid
    assert summary["status"] == "valid_archive_found"
    assert summary["selected_age_rank"] == 2
    assert summary["invalid_codes"] == {"GENESIS_HASH_MISMATCH": 1}
    assert evaluate_archive(older_valid)["status"] == "valid"


def test_reports_no_valid_archive_without_exposing_archive_names(tmp_path):
    invalid = chain_payload(Blockchain())
    invalid["chain"][0]["hash"] = "invalid"
    write_archive(tmp_path / "vorliq-backup-invalid.tar.gz", invalid)

    selected, summary = select_newest_valid_archive(tmp_path)

    assert selected is None
    assert summary == {
        "status": "no_valid_archive",
        "archives_checked": 1,
        "invalid_codes": {"GENESIS_HASH_MISMATCH": 1},
    }
