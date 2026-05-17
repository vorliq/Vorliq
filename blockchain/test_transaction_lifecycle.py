from __future__ import annotations

from block import Block
from blockchain import Blockchain
from storage import Storage
from transaction import SYSTEM_ADDRESS, Transaction


def test_new_transactions_have_stable_tx_id() -> None:
    transaction = Transaction("SYSTEM", "VLQ_RECEIVER", 5, timestamp=1000)
    same_transaction = Transaction("SYSTEM", "VLQ_RECEIVER", 5, timestamp=1000)

    assert transaction.tx_id
    assert transaction.tx_id == same_transaction.tx_id


def test_old_transactions_without_tx_id_can_be_read() -> None:
    blockchain = Blockchain()
    old_transaction = {
        "sender_address": "SYSTEM",
        "receiver_address": "VLQ_OLD",
        "amount": 3,
        "timestamp": 1000,
        "signature": None,
        "sender_public_key": None,
    }
    block = Block(
        1,
        [old_transaction],
        blockchain.get_latest_block().hash,
        timestamp=blockchain.get_latest_block().timestamp + blockchain.BLOCK_TIME_MINIMUM + 1,
    )
    block.proof_of_work(blockchain.difficulty)
    assert blockchain.add_block(block)

    records, total, has_more = blockchain.get_transaction_records(25, 0, status="confirmed")

    assert total == 1
    assert not has_more
    assert records[0]["tx_id"]
    assert records[0]["status"] == "confirmed"


def test_storage_preserves_old_block_hashes_without_tx_id(tmp_path) -> None:
    blockchain = Blockchain()
    old_transaction = {
        "sender_address": "SYSTEM",
        "receiver_address": "VLQ_OLD_STORAGE",
        "amount": 4,
        "timestamp": 1000,
        "signature": None,
        "sender_public_key": None,
    }
    block = Block(
        1,
        [old_transaction],
        blockchain.get_latest_block().hash,
        timestamp=blockchain.get_latest_block().timestamp + blockchain.BLOCK_TIME_MINIMUM + 1,
    )
    block.proof_of_work(blockchain.difficulty)
    assert blockchain.add_block(block)
    original_hash = block.hash

    storage = Storage(tmp_path)
    storage.save_chain(blockchain)
    loaded = storage.load_chain()

    assert loaded is not None
    assert loaded.chain[1].hash == original_hash
    assert loaded.is_chain_valid()
    assert loaded.get_transaction_detail(loaded.safe_transaction_record(old_transaction, "confirmed", loaded.chain[1])["tx_id"])


def test_pending_transaction_list_and_lookup_work() -> None:
    blockchain = Blockchain()
    transaction = Transaction("SYSTEM", "VLQ_PENDING", 7, timestamp=1000)
    blockchain.add_pending_transaction(transaction)

    records, total, _ = blockchain.get_pending_transaction_records(25, 0)
    detail = blockchain.get_transaction_detail(transaction.tx_id)

    assert total == 1
    assert records[0]["tx_id"] == transaction.tx_id
    assert detail["status"] == "pending"
    assert detail["confirmations"] == 0


def test_confirmed_transaction_lookup_and_block_lookup_work() -> None:
    blockchain = Blockchain()
    transaction = Transaction("SYSTEM", "VLQ_CONFIRMED", 9, timestamp=1000)
    blockchain.add_pending_transaction(transaction)
    mined_block = blockchain.mine_pending_transactions("VLQ_MINER")

    detail = blockchain.get_transaction_detail(transaction.tx_id)
    block_by_index = blockchain.get_block_detail(str(mined_block.index))
    block_by_hash = blockchain.get_block_detail(mined_block.hash)

    assert detail["status"] == "confirmed"
    assert detail["block_index"] == mined_block.index
    assert block_by_index["hash"] == mined_block.hash
    assert block_by_hash["index"] == mined_block.index
    assert block_by_hash["transactions"][0]["tx_id"] == transaction.tx_id


def test_address_history_includes_pending_and_confirmed_transactions() -> None:
    blockchain = Blockchain()
    confirmed = Transaction("SYSTEM", "VLQ_HISTORY", 11, timestamp=1000)
    pending = Transaction("SYSTEM", "VLQ_HISTORY", 13, timestamp=1100)
    blockchain.add_pending_transaction(confirmed)
    blockchain.mine_pending_transactions("VLQ_MINER")
    blockchain.add_pending_transaction(pending)

    history = blockchain.get_address_history("VLQ_HISTORY", 25, 0)

    assert len(history["confirmed_incoming"]) == 1
    assert len(history["pending_incoming"]) == 1
    assert history["total_received"] == 11
    assert history["pending_incoming_total"] == 13
    assert history["transaction_count"] == 2


def test_transaction_api_records_do_not_expose_private_fields() -> None:
    blockchain = Blockchain()
    transaction = Transaction(
        "SYSTEM",
        "VLQ_SAFE",
        1,
        timestamp=1000,
        metadata={"message": "hello", "private_key": "do-not-return", "admin_token": "nope"},
    )
    blockchain.add_pending_transaction(transaction)

    record = blockchain.get_transaction_detail(transaction.tx_id)

    assert record["signature_present"] is False
    assert record["public_key_present"] is False
    assert "signature" not in record
    assert "sender_public_key" not in record
    assert "private_key" not in record["metadata"]
    assert "admin_token" not in record["metadata"]
    assert record["message"] == "hello"
