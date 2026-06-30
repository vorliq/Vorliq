from __future__ import annotations

import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BLOCKCHAIN_DIR = ROOT / "blockchain"
sys.path.insert(0, str(BLOCKCHAIN_DIR))

from block import Block  # noqa: E402
from blockchain import Blockchain  # noqa: E402
from diagnose_chain_startup import evaluate_chain_payload  # noqa: E402


def payload(blockchain: Blockchain) -> dict:
    return {
        "difficulty": blockchain.difficulty,
        "chain": [block.to_dict() for block in blockchain.chain],
    }


def test_reports_valid_chain_without_exposing_chain_values():
    blockchain = Blockchain()

    result = evaluate_chain_payload(payload(blockchain))

    assert result == {"status": "valid", "code": "CHAIN_VALID", "block_count": 1}


def test_reports_minimum_time_violation_by_safe_code_and_index():
    blockchain = Blockchain()
    genesis = blockchain.get_latest_block()
    block = Block(
        index=1,
        transactions=[],
        previous_hash=genesis.hash,
        timestamp=genesis.timestamp + 1,
        miner_address="example-miner",
    )
    block.proof_of_work(blockchain.difficulty)
    blockchain.chain.append(block)

    result = evaluate_chain_payload(payload(blockchain))

    assert result == {"status": "invalid", "code": "BLOCK_MINIMUM_TIME_VIOLATION", "index": 1}


def test_reports_consecutive_miner_violation_by_safe_code_and_index():
    blockchain = Blockchain()
    genesis = blockchain.get_latest_block()
    first = Block(
        index=1,
        transactions=[],
        previous_hash=genesis.hash,
        timestamp=time.time(),
        miner_address="example-miner",
    )
    first.proof_of_work(blockchain.difficulty)
    second = Block(
        index=2,
        transactions=[],
        previous_hash=first.hash,
        timestamp=first.timestamp + blockchain.BLOCK_TIME_MINIMUM + 1,
        miner_address="example-miner",
    )
    second.proof_of_work(blockchain.difficulty)
    blockchain.chain.extend([first, second])

    result = evaluate_chain_payload(payload(blockchain))

    assert result == {"status": "invalid", "code": "CONSECUTIVE_MINER_VIOLATION", "index": 2}


def test_same_miner_after_the_gap_is_not_flagged():
    # The same miner mining two consecutive blocks is ALLOWED once
    # SAME_MINER_MIN_GAP seconds have elapsed (the liveness guarantee a lone
    # miner relies on). The diagnostic must not flag this — it previously did,
    # falsely failing every healthy single-miner production chain (INCIDENT_267).
    blockchain = Blockchain()
    genesis = blockchain.get_latest_block()
    first = Block(
        index=1,
        transactions=[],
        previous_hash=genesis.hash,
        timestamp=time.time(),
        miner_address="example-miner",
    )
    first.proof_of_work(blockchain.difficulty)
    second = Block(
        index=2,
        transactions=[],
        previous_hash=first.hash,
        # A full gap window (plus one second) after the first: allowed.
        timestamp=first.timestamp + blockchain.SAME_MINER_MIN_GAP + 1,
        miner_address="example-miner",
    )
    second.proof_of_work(blockchain.difficulty)
    blockchain.chain.extend([first, second])

    result = evaluate_chain_payload(payload(blockchain))

    assert result.get("code") != "CONSECUTIVE_MINER_VIOLATION"
    assert result == {"status": "valid", "code": "CHAIN_VALID", "block_count": 3}
