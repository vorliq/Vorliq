from __future__ import annotations

import json
import logging
import os
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
BLOCKCHAIN_DIR = ROOT / "blockchain"
sys.path.insert(0, str(BLOCKCHAIN_DIR))

from block import Block  # noqa: E402
from blockchain import Blockchain  # noqa: E402


def evaluate_chain_payload(data: Any) -> dict[str, Any]:
    if not isinstance(data, dict) or not isinstance(data.get("chain"), list) or not data["chain"]:
        return {"status": "invalid", "code": "CHAIN_PAYLOAD_INVALID"}

    try:
        chain = [Block.from_dict(block) for block in data["chain"]]
        rules = Blockchain()
        rules.chain = chain
        rules.difficulty = int(data.get("difficulty", rules.difficulty))
        rules.proof_target = "0" * rules.difficulty
    except Exception:
        return {"status": "invalid", "code": "CHAIN_PAYLOAD_INVALID"}

    genesis = chain[0]
    if genesis.hash != genesis.calculate_hash():
        return {"status": "invalid", "code": "GENESIS_HASH_MISMATCH", "index": 0}
    if not genesis.hash.startswith("0" * getattr(genesis, "difficulty", rules.difficulty)):
        return {"status": "invalid", "code": "GENESIS_PROOF_INVALID", "index": 0}

    for index in range(1, len(chain)):
        current = chain[index]
        previous = chain[index - 1]
        if current.hash != current.calculate_hash():
            return {"status": "invalid", "code": "BLOCK_HASH_MISMATCH", "index": index}
        if not current.hash.startswith("0" * getattr(current, "difficulty", rules.difficulty)):
            return {"status": "invalid", "code": "BLOCK_PROOF_INVALID", "index": index}
        if current.previous_hash != previous.hash:
            return {"status": "invalid", "code": "BLOCK_LINK_MISMATCH", "index": index}

        current_miner = getattr(current, "miner_address", None)
        previous_miner = getattr(previous, "miner_address", None)
        if current_miner and current.timestamp - previous.timestamp < rules.BLOCK_TIME_MINIMUM:
            return {"status": "invalid", "code": "BLOCK_MINIMUM_TIME_VIOLATION", "index": index}
        # The anti-monopoly rule only rejects the SAME miner mining two consecutive
        # blocks WITHIN the gap window — once SAME_MINER_MIN_GAP seconds have
        # elapsed the same miner may mine again (this is the liveness guarantee a
        # lone miner relies on). Match the real rule in Blockchain.is_chain_valid
        # exactly by reusing rules.SAME_MINER_MIN_GAP, so the two can never drift.
        # Without this gap condition the diagnostic falsely flagged every healthy
        # single-miner chain (see INCIDENT_267.md).
        if (
            current_miner
            and previous_miner
            and current_miner == previous_miner
            and current.timestamp - previous.timestamp < rules.SAME_MINER_MIN_GAP
        ):
            return {"status": "invalid", "code": "CONSECUTIVE_MINER_VIOLATION", "index": index}

    if not rules._chain_transactions_are_valid(chain):
        return {"status": "invalid", "code": "CHAIN_TRANSACTION_VALIDATION_FAILED"}

    return {"status": "valid", "code": "CHAIN_VALID", "block_count": len(chain)}


def evaluate_file(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"status": "unavailable", "code": "CHAIN_FILE_MISSING"}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {"status": "invalid", "code": "CHAIN_JSON_INVALID"}
    return evaluate_chain_payload(data)


def main() -> int:
    logging.disable(logging.CRITICAL)
    data_dir = Path(os.environ.get("VORLIQ_DATA_DIR") or BLOCKCHAIN_DIR / "data")
    main_result = evaluate_file(data_dir / "chain.json")
    backup_result = evaluate_file(data_dir / "chain.json.bak")
    print(json.dumps({"diagnostic": "chain_startup", "main": main_result, "backup": backup_result}, sort_keys=True))
    return 0 if main_result["status"] == "valid" else 1


if __name__ == "__main__":
    raise SystemExit(main())
