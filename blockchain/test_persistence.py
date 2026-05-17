from __future__ import annotations

import json
import tempfile
import time

from blockchain import Blockchain
from lending import LendingPool
from logger import vorliq_logger
from network import Network
from storage import Storage
from transaction import SYSTEM_ADDRESS, Transaction


def age_latest_block(blockchain: Blockchain) -> None:
    latest = blockchain.get_latest_block()
    latest.timestamp = time.time() - blockchain.BLOCK_TIME_MINIMUM - 1
    latest.proof_of_work(blockchain.difficulty)


def print_result(name: str, passed: bool) -> None:
    status = "PASS" if passed else "FAIL"
    print(f"{status}: {name}")


def main() -> None:
    vorliq_logger.info("Starting persistence test")
    Blockchain.BLOCK_TIME_MINIMUM = 0
    temp_dir = tempfile.TemporaryDirectory()
    storage = Storage(temp_dir.name)

    blockchain = Blockchain()
    age_latest_block(blockchain)
    blockchain.mine_pending_transactions("miner-address")
    age_latest_block(blockchain)
    blockchain.mine_pending_transactions("second-miner-address")

    pending_transaction = Transaction(
        sender_address=SYSTEM_ADDRESS,
        receiver_address="pending-receiver-address",
        amount=25,
    )
    blockchain.add_pending_transaction(pending_transaction)

    lending_pool = LendingPool(blockchain)
    loan_id = lending_pool.create_loan_request(
        requester_address="loan-requester-address",
        amount=500,
        reason="community garden supplies",
    )

    network = Network()
    fake_peer = "http://192.168.1.99:5001"
    network.register_peer(fake_peer)

    storage.save_chain(blockchain)
    storage.save_pending(blockchain.pending_transactions)
    storage.save_lending_pool(lending_pool)
    storage.save_peers(network.peers)

    restored_blockchain = Blockchain()
    restored_lending_pool = LendingPool()
    restored_network = Network()

    loaded_blockchain = storage.load_chain()
    if loaded_blockchain is not None:
        restored_blockchain = loaded_blockchain

    restored_blockchain.pending_transactions = [
        Transaction.from_dict(transaction) for transaction in storage.load_pending()
    ]

    restored_lending_pool = storage.load_lending_pool()
    restored_lending_pool.blockchain = restored_blockchain
    restored_network.peers = storage.load_peers()

    chain_check = len(restored_blockchain.chain) == 3
    pending_check = (
        len(restored_blockchain.pending_transactions) >= 1
        and any(
            transaction.receiver_address == "pending-receiver-address"
            and transaction.amount == 25
            for transaction in restored_blockchain.pending_transactions
        )
    )
    loan = restored_lending_pool.get_loan(loan_id)
    loan_check = loan is not None and loan["status"] == "pending"
    peer_check = fake_peer in restored_network.peers

    print_result("restored chain has genesis plus two mined blocks", chain_check)
    print_result("pending transaction restored", pending_check)
    print_result("loan request restored with pending status", loan_check)
    print_result("fake peer restored", peer_check)
    print()
    print("Restored chain JSON:")
    print(json.dumps(restored_blockchain.to_dict(), indent=2, sort_keys=True))
    temp_dir.cleanup()
    vorliq_logger.info("Persistence test completed")


if __name__ == "__main__":
    main()
