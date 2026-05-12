from __future__ import annotations

from typing import Any

from block import Block
from transaction import SYSTEM_ADDRESS, Transaction


class Blockchain:
    difficulty = 4
    mining_reward = 50.0

    def __init__(self) -> None:
        self.chain: list[Block] = [self.create_genesis_block()]
        self.pending_transactions: list[Transaction] = []

    def create_genesis_block(self) -> Block:
        genesis_block = Block(
            index=0,
            transactions=[],
            previous_hash="0",
        )
        genesis_block.proof_of_work(self.difficulty)
        return genesis_block

    def get_latest_block(self) -> Block:
        return self.chain[-1]

    def add_block(self, block: Block) -> bool:
        latest_block = self.get_latest_block()

        if block.index != latest_block.index + 1:
            return False

        if block.previous_hash != latest_block.hash:
            return False

        if not block.has_valid_proof(self.difficulty):
            return False

        if not self._all_transactions_are_valid(block.transactions):
            return False

        self.chain.append(block)
        return True

    def is_chain_valid(self) -> bool:
        if not self.chain:
            return False

        genesis_block = self.chain[0]
        if genesis_block.hash != genesis_block.calculate_hash():
            return False
        if not genesis_block.hash.startswith("0" * self.difficulty):
            return False

        for index in range(1, len(self.chain)):
            current_block = self.chain[index]
            previous_block = self.chain[index - 1]

            if current_block.hash != current_block.calculate_hash():
                return False

            if not current_block.hash.startswith("0" * self.difficulty):
                return False

            if current_block.previous_hash != previous_block.hash:
                return False

            if not self._all_transactions_are_valid(current_block.transactions):
                return False

        return True

    def add_pending_transaction(self, transaction: Transaction) -> bool:
        if not isinstance(transaction, Transaction):
            raise TypeError("transaction must be a Transaction instance")

        if not transaction.verify_transaction():
            raise ValueError("transaction signature is invalid")

        self.pending_transactions.append(transaction)
        return True

    def mine_pending_transactions(self, miner_address: str) -> Block:
        if not miner_address:
            raise ValueError("miner_address is required")

        block = Block(
            index=len(self.chain),
            transactions=list(self.pending_transactions),
            previous_hash=self.get_latest_block().hash,
        )
        block.proof_of_work(self.difficulty)

        if not self.add_block(block):
            raise RuntimeError("mined block failed validation")

        reward_transaction = Transaction(
            sender_address=SYSTEM_ADDRESS,
            receiver_address=miner_address,
            amount=self.mining_reward,
        )
        self.pending_transactions = [reward_transaction]

        return block

    def get_pending_transactions(self) -> list[dict[str, Any]]:
        return [transaction.to_dict() for transaction in self.pending_transactions]

    def get_chain_data(self) -> list[dict[str, Any]]:
        return [block.to_dict() for block in self.chain]

    def get_balance(self, address: str) -> float:
        if not address:
            raise ValueError("address is required")

        balance = 0.0
        transactions = []

        for block in self.chain:
            transactions.extend(block.transactions)

        transactions.extend(self.pending_transactions)

        for transaction in transactions:
            if isinstance(transaction, dict):
                transaction = Transaction.from_dict(transaction)

            if transaction.sender_address == address:
                balance -= transaction.amount

            if transaction.receiver_address == address:
                balance += transaction.amount

        return balance

    def to_dict(self) -> dict[str, Any]:
        return {
            "coin": "VLQ",
            "difficulty": self.difficulty,
            "mining_reward": self.mining_reward,
            "is_valid": self.is_chain_valid(),
            "pending_transactions": self.get_pending_transactions(),
            "chain": self.get_chain_data(),
        }

    def _all_transactions_are_valid(self, transactions: list[Any]) -> bool:
        for transaction in transactions:
            if isinstance(transaction, dict):
                transaction = Transaction.from_dict(transaction)
            if not isinstance(transaction, Transaction):
                return False
            if not transaction.verify_transaction():
                return False
        return True
