from __future__ import annotations

import json
import time

from blockchain import Blockchain
from logger import vorliq_logger
from transaction import Transaction
from wallet import Wallet


def age_latest_block(blockchain: Blockchain) -> None:
    latest = blockchain.get_latest_block()
    latest.timestamp = time.time() - blockchain.BLOCK_TIME_MINIMUM - 1
    latest.proof_of_work(blockchain.difficulty)


def main() -> None:
    vorliq_logger.info("Starting blockchain core test")
    Blockchain.BLOCK_TIME_MINIMUM = 0
    print("Creating wallet one...")
    wallet_one = Wallet()
    print(f"Wallet one address: {wallet_one.address}")

    print("Creating wallet two...")
    wallet_two = Wallet()
    print(f"Wallet two address: {wallet_two.address}")

    print("Creating transaction from wallet one to wallet two for 100 VLQ...")
    transaction = Transaction(
        sender_address=wallet_one.address,
        receiver_address=wallet_two.address,
        amount=100,
    )

    print("Signing transaction...")
    transaction.sign_transaction(wallet_one)
    print(f"Transaction signature valid: {transaction.verify_transaction()}")

    blockchain = Blockchain()
    print("Funding wallet one through a system transaction for the local test...")
    funding_transaction = Transaction(
        sender_address="SYSTEM",
        receiver_address=wallet_one.address,
        amount=200,
    )
    blockchain.add_pending_transaction(funding_transaction)
    age_latest_block(blockchain)
    blockchain.mine_pending_transactions(wallet_two.address)
    age_latest_block(blockchain)

    print("Adding transaction to pending pool...")
    blockchain.add_pending_transaction(transaction)
    print(f"Pending transactions before mining: {len(blockchain.pending_transactions)}")

    print("Mining block...")
    mined_block = blockchain.mine_pending_transactions(wallet_one.address)
    print(f"Mined block index: {mined_block.index}")
    print(f"Mined block hash: {mined_block.hash}")
    print(f"Mined block nonce: {mined_block.nonce}")
    print(f"Block added: {len(blockchain.chain) == 3}")
    print(f"Pending transactions after mining: {len(blockchain.pending_transactions)}")
    print("Mining reward is pending for the next block.")

    chain_is_valid = blockchain.is_chain_valid()
    print(f"Blockchain valid: {chain_is_valid}")

    print("Full chain:")
    print(json.dumps(blockchain.to_dict(), indent=2))
    vorliq_logger.info("Blockchain core test completed")


if __name__ == "__main__":
    main()
