from __future__ import annotations

from typing import Any

from block import Block
from logger import vorliq_logger
from transaction import SYSTEM_ADDRESS, Transaction


class Blockchain:
    difficulty = 4
    maximum_supply = 21_000_000.0
    initial_mining_reward = 50.0
    halving_interval = 210_000

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
        vorliq_logger.info("Genesis block created with hash %s", genesis_block.hash)
        return genesis_block

    def get_latest_block(self) -> Block:
        return self.chain[-1]

    def add_block(self, block: Block) -> bool:
        latest_block = self.get_latest_block()

        if block.index != latest_block.index + 1:
            vorliq_logger.warning("Rejected block with invalid index %s", block.index)
            return False

        if block.previous_hash != latest_block.hash:
            vorliq_logger.warning("Rejected block %s because previous hash did not match", block.index)
            return False

        if not block.has_valid_proof(self.difficulty):
            vorliq_logger.warning("Rejected block %s because proof of work was invalid", block.index)
            return False

        if not self._all_transactions_are_valid(block.transactions):
            vorliq_logger.warning("Rejected block %s because a transaction was invalid", block.index)
            return False

        self.chain.append(block)
        return True

    def is_chain_valid(self) -> bool:
        if not self.chain:
            vorliq_logger.warning("Chain validation failed because the chain is empty")
            return False

        genesis_block = self.chain[0]
        if genesis_block.hash != genesis_block.calculate_hash():
            vorliq_logger.warning("Chain validation failed because the genesis hash changed")
            return False
        if not genesis_block.hash.startswith("0" * self.difficulty):
            vorliq_logger.warning("Chain validation failed because genesis proof of work is invalid")
            return False

        for index in range(1, len(self.chain)):
            current_block = self.chain[index]
            previous_block = self.chain[index - 1]

            if current_block.hash != current_block.calculate_hash():
                vorliq_logger.warning("Chain validation failed at block %s: hash mismatch", current_block.index)
                return False

            if not current_block.hash.startswith("0" * self.difficulty):
                vorliq_logger.warning("Chain validation failed at block %s: proof of work invalid", current_block.index)
                return False

            if current_block.previous_hash != previous_block.hash:
                vorliq_logger.warning("Chain validation failed at block %s: previous hash mismatch", current_block.index)
                return False

            if not self._all_transactions_are_valid(current_block.transactions):
                vorliq_logger.warning("Chain validation failed at block %s: invalid transaction", current_block.index)
                return False

        vorliq_logger.info("Chain validation passed for %s blocks", len(self.chain))
        return True

    def add_pending_transaction(self, transaction: Transaction) -> bool:
        if not isinstance(transaction, Transaction):
            raise TypeError("transaction must be a Transaction instance")

        if not transaction.verify_transaction():
            raise ValueError("transaction signature is invalid")

        self.pending_transactions.append(transaction)
        vorliq_logger.info(
            "Transaction added to pending pool from %s to %s for %s VLQ",
            transaction.sender_address,
            transaction.receiver_address,
            transaction.amount,
        )
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

        mining_reward = self.get_current_mining_reward()
        reward_transaction = Transaction(
            sender_address=SYSTEM_ADDRESS,
            receiver_address=miner_address,
            amount=mining_reward,
        )
        self.pending_transactions = [reward_transaction] if mining_reward > 0 else []
        vorliq_logger.info("Mined block %s with hash %s", block.index, block.hash)

        return block

    def get_pending_transactions(self) -> list[dict[str, Any]]:
        return [transaction.to_dict() for transaction in self.pending_transactions]

    def get_chain_data(self) -> list[dict[str, Any]]:
        return [block.to_dict() for block in self.chain]

    def get_block_height(self) -> int:
        return len(self.chain) - 1

    def get_current_mining_reward(self) -> float:
        halvings = len(self.chain) // self.halving_interval
        scheduled_reward = self.initial_mining_reward / (2**halvings)
        remaining_supply = max(self.maximum_supply - self.get_total_issued(), 0.0)
        return min(scheduled_reward, remaining_supply)

    def get_total_issued(self) -> float:
        total = 0.0

        for block in self.chain:
            for transaction in block.transactions:
                if isinstance(transaction, dict):
                    transaction = Transaction.from_dict(transaction)

                if transaction.sender_address == SYSTEM_ADDRESS:
                    total += transaction.amount

        return total

    def get_token_economics(self) -> dict[str, float | int]:
        return {
            "maximum_supply": self.maximum_supply,
            "current_mining_reward": self.get_current_mining_reward(),
            "current_block_height": self.get_block_height(),
            "halving_interval": self.halving_interval,
            "total_issued": self.get_total_issued(),
        }

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
            "mining_reward": self.get_current_mining_reward(),
            "maximum_supply": self.maximum_supply,
            "halving_interval": self.halving_interval,
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
