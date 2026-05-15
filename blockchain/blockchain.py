from __future__ import annotations

import math
import time
from typing import Any

from block import Block
from logger import vorliq_logger
from transaction import SYSTEM_ADDRESSES, SYSTEM_ADDRESS, TREASURY_ADDRESS, Transaction


class MiningCooldownError(ValueError):
    def __init__(self, wait_seconds: int) -> None:
        self.wait_seconds = wait_seconds
        super().__init__(f"too soon to mine the next block; wait {wait_seconds} seconds")


class Blockchain:
    difficulty = 4
    maximum_supply = 21_000_000.0
    initial_mining_reward = 50.0
    halving_interval = 210_000
    BLOCK_TIME_TARGET = 60
    BLOCK_TIME_MINIMUM = 30
    DIFFICULTY_ADJUSTMENT_INTERVAL = 10
    TREASURY_PERCENTAGE = 0.05
    TREASURY_ADDRESS = TREASURY_ADDRESS

    def __init__(self) -> None:
        self.mining_reward = self.initial_mining_reward
        self.proof_target = "0" * self.difficulty
        self.chain: list[Block] = [self.create_genesis_block()]
        self.pending_transactions: list[Transaction] = []

    def create_genesis_block(self) -> Block:
        genesis_block = Block(
            index=0,
            transactions=[],
            previous_hash="0",
            timestamp=time.time() - self.BLOCK_TIME_MINIMUM,
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

        if block.timestamp - latest_block.timestamp < self.BLOCK_TIME_MINIMUM:
            vorliq_logger.warning("Rejected block %s because it was mined too soon after block %s", block.index, latest_block.index)
            return False

        previous_miner = getattr(latest_block, "miner_address", None)
        current_miner = getattr(block, "miner_address", None)
        if previous_miner and current_miner and previous_miner == current_miner:
            vorliq_logger.warning("Rejected block %s because miner %s mined consecutive blocks", block.index, current_miner)
            return False

        if not block.has_valid_proof(getattr(block, "difficulty", self.difficulty)):
            vorliq_logger.warning("Rejected block %s because proof of work was invalid", block.index)
            return False

        if not self._transactions_are_valid_for_next_block(block.transactions):
            vorliq_logger.warning("Rejected block %s because a transaction was invalid", block.index)
            return False

        self.chain.append(block)
        self.adjust_difficulty()
        return True

    def is_chain_valid(self) -> bool:
        if not self.chain:
            vorliq_logger.warning("Chain validation failed because the chain is empty")
            return False

        genesis_block = self.chain[0]
        if genesis_block.hash != genesis_block.calculate_hash():
            vorliq_logger.warning("Chain validation failed because the genesis hash changed")
            return False
        if not genesis_block.hash.startswith("0" * getattr(genesis_block, "difficulty", self.difficulty)):
            vorliq_logger.warning("Chain validation failed because genesis proof of work is invalid")
            return False

        for index in range(1, len(self.chain)):
            current_block = self.chain[index]
            previous_block = self.chain[index - 1]

            if current_block.hash != current_block.calculate_hash():
                vorliq_logger.warning("Chain validation failed at block %s: hash mismatch", current_block.index)
                return False

            block_difficulty = getattr(current_block, "difficulty", self.difficulty)
            if not current_block.hash.startswith("0" * block_difficulty):
                vorliq_logger.warning("Chain validation failed at block %s: proof of work invalid", current_block.index)
                return False

            if current_block.previous_hash != previous_block.hash:
                vorliq_logger.warning("Chain validation failed at block %s: previous hash mismatch", current_block.index)
                return False

            current_miner = getattr(current_block, "miner_address", None)
            previous_miner = getattr(previous_block, "miner_address", None)
            if current_miner and current_block.timestamp - previous_block.timestamp < self.BLOCK_TIME_MINIMUM:
                vorliq_logger.warning("Chain validation failed at block %s: block was mined too soon", current_block.index)
                return False
            if current_miner and previous_miner and current_miner == previous_miner:
                vorliq_logger.warning("Chain validation failed at block %s: consecutive miner address", current_block.index)
                return False

        if not self._chain_transactions_are_valid(self.chain):
            vorliq_logger.warning("Chain validation failed because balances or transaction signatures are invalid")
            return False

        vorliq_logger.info("Chain validation passed for %s blocks", len(self.chain))
        return True

    def add_pending_transaction(self, transaction: Transaction) -> bool:
        if not isinstance(transaction, Transaction):
            raise TypeError("transaction must be a Transaction instance")

        if not transaction.verify_transaction():
            raise ValueError("transaction signature is invalid")

        if not self._pending_transaction_has_spendable_balance(transaction):
            raise ValueError("sender does not have enough confirmed VLQ for this transaction")

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

        latest_block = self.get_latest_block()
        elapsed_seconds = time.time() - latest_block.timestamp
        if elapsed_seconds < self.BLOCK_TIME_MINIMUM:
            wait_seconds = int(math.ceil(self.BLOCK_TIME_MINIMUM - elapsed_seconds))
            raise MiningCooldownError(wait_seconds)

        valid_transactions = self._select_valid_pending_transactions()
        dropped_count = len(self.pending_transactions) - len(valid_transactions)
        if dropped_count:
            vorliq_logger.warning("Dropped %s invalid pending transactions before mining", dropped_count)

        block = Block(
            index=len(self.chain),
            transactions=valid_transactions,
            previous_hash=self.get_latest_block().hash,
            miner_address=miner_address,
        )
        block.proof_of_work(self.difficulty)

        previous_miner = getattr(latest_block, "miner_address", None)
        if previous_miner and previous_miner == miner_address:
            raise ValueError("the same address cannot mine two consecutive blocks")

        if not self.add_block(block):
            raise RuntimeError("mined block failed validation")

        mining_reward = self.get_current_mining_reward()
        miner_reward = round(mining_reward * (1 - self.TREASURY_PERCENTAGE), 8)
        treasury_reward = round(mining_reward * self.TREASURY_PERCENTAGE, 8)
        reward_transaction = Transaction(
            sender_address=SYSTEM_ADDRESS,
            receiver_address=miner_address,
            amount=miner_reward,
        )
        treasury_transaction = Transaction(
            sender_address=SYSTEM_ADDRESS,
            receiver_address=self.TREASURY_ADDRESS,
            amount=treasury_reward,
        )
        self.pending_transactions = (
            [reward_transaction, treasury_transaction] if mining_reward > 0 else []
        )
        vorliq_logger.info("Mined block %s with hash %s", block.index, block.hash)

        return block

    def get_treasury_balance(self) -> float:
        balance = 0.0
        for block in self.chain:
            for transaction in block.transactions:
                if isinstance(transaction, dict):
                    transaction = Transaction.from_dict(transaction)
                if transaction.sender_address == self.TREASURY_ADDRESS:
                    balance -= transaction.amount
                if transaction.receiver_address == self.TREASURY_ADDRESS:
                    balance += transaction.amount
        return balance

    def adjust_difficulty(self) -> None:
        height = self.get_block_height()
        if height <= 0 or height % self.DIFFICULTY_ADJUSTMENT_INTERVAL != 0:
            return

        if len(self.chain) <= self.DIFFICULTY_ADJUSTMENT_INTERVAL:
            return

        window_start = self.chain[-(self.DIFFICULTY_ADJUSTMENT_INTERVAL + 1)]
        window_end = self.chain[-1]
        elapsed_time = max(window_end.timestamp - window_start.timestamp, 0.0)
        average_block_time = elapsed_time / self.DIFFICULTY_ADJUSTMENT_INTERVAL
        old_difficulty = int(self.difficulty)
        new_difficulty = old_difficulty

        if average_block_time < self.BLOCK_TIME_TARGET * 0.75:
            new_difficulty = old_difficulty + 1
        elif average_block_time > self.BLOCK_TIME_TARGET * 1.25:
            new_difficulty = max(2, old_difficulty - 1)

        if new_difficulty != old_difficulty:
            self.difficulty = new_difficulty
            self.proof_target = "0" * self.difficulty
            vorliq_logger.info(
                "Difficulty adjusted from %s to %s after average block time %.2f seconds",
                old_difficulty,
                new_difficulty,
                average_block_time,
            )
        else:
            vorliq_logger.info(
                "Difficulty checked at height %s and remained %s after average block time %.2f seconds",
                height,
                self.difficulty,
                average_block_time,
            )

    def get_pending_transactions(self) -> list[dict[str, Any]]:
        return [transaction.to_dict() for transaction in self.pending_transactions]

    def get_chain_data(self) -> list[dict[str, Any]]:
        return [block.to_dict() for block in self.chain]

    def get_block_height(self) -> int:
        return len(self.chain) - 1

    def get_current_mining_reward(self) -> float:
        halvings = len(self.chain) // self.halving_interval
        scheduled_reward = self.mining_reward / (2**halvings)
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

    def prune_pending_transactions(self, drop_system_rewards: bool = False) -> None:
        confirmed_identities = {
            self._transaction_identity(transaction)
            for block in self.chain
            for transaction in block.transactions
        }
        balances = self._confirmed_balances()
        retained_transactions: list[Transaction] = []

        for pending_transaction in self.pending_transactions:
            transaction = (
                Transaction.from_dict(pending_transaction)
                if isinstance(pending_transaction, dict)
                else pending_transaction
            )

            if drop_system_rewards and transaction.sender_address == SYSTEM_ADDRESS:
                continue

            if self._transaction_identity(transaction) in confirmed_identities:
                continue

            trial_balances = dict(balances)
            if self._apply_transactions_to_balances([transaction], trial_balances):
                retained_transactions.append(transaction)
                balances = trial_balances

        removed = len(self.pending_transactions) - len(retained_transactions)
        if removed:
            vorliq_logger.info("Pruned %s confirmed or invalid pending transactions", removed)
        self.pending_transactions = retained_transactions

    def to_dict(self) -> dict[str, Any]:
        return {
            "coin": "VLQ",
            "difficulty": self.difficulty,
            "mining_reward": self.get_current_mining_reward(),
            "maximum_supply": self.maximum_supply,
            "halving_interval": self.halving_interval,
            "block_time_target": self.BLOCK_TIME_TARGET,
            "block_time_minimum": self.BLOCK_TIME_MINIMUM,
            "difficulty_adjustment_interval": self.DIFFICULTY_ADJUSTMENT_INTERVAL,
            "treasury_percentage": self.TREASURY_PERCENTAGE,
            "treasury_address": self.TREASURY_ADDRESS,
            "treasury_balance": self.get_treasury_balance(),
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

    def _chain_transactions_are_valid(self, chain: list[Block]) -> bool:
        balances: dict[str, float] = {}

        for block in chain:
            if not self._apply_transactions_to_balances(block.transactions, balances):
                return False

        return True

    def _transactions_are_valid_for_next_block(self, transactions: list[Any]) -> bool:
        balances = self._confirmed_balances()
        return self._apply_transactions_to_balances(transactions, balances)

    def _apply_transactions_to_balances(
        self,
        transactions: list[Any],
        balances: dict[str, float],
    ) -> bool:
        for transaction in transactions:
            if isinstance(transaction, dict):
                transaction = Transaction.from_dict(transaction)

            if not isinstance(transaction, Transaction) or not transaction.verify_transaction():
                return False

            sender = transaction.sender_address
            receiver = transaction.receiver_address
            amount = float(transaction.amount)

            if sender not in SYSTEM_ADDRESSES:
                available = balances.get(sender, 0.0)
                if available + 1e-9 < amount:
                    vorliq_logger.warning(
                        "Transaction rejected during balance validation: %s has %s VLQ but tried to spend %s",
                        sender,
                        available,
                        amount,
                    )
                    return False
                balances[sender] = available - amount

            balances[receiver] = balances.get(receiver, 0.0) + amount

        return True

    def _confirmed_balances(self) -> dict[str, float]:
        balances: dict[str, float] = {}

        for block in self.chain:
            if not self._apply_transactions_to_balances(block.transactions, balances):
                raise ValueError("current chain contains invalid balances")

        return balances

    def _pending_transaction_has_spendable_balance(self, transaction: Transaction) -> bool:
        if transaction.sender_address in SYSTEM_ADDRESSES:
            return True

        balances = self._confirmed_balances()

        for pending_transaction in self.pending_transactions:
            if isinstance(pending_transaction, dict):
                pending_transaction = Transaction.from_dict(pending_transaction)
            if pending_transaction.sender_address == transaction.sender_address:
                balances[transaction.sender_address] = (
                    balances.get(transaction.sender_address, 0.0) - pending_transaction.amount
                )

        return balances.get(transaction.sender_address, 0.0) + 1e-9 >= transaction.amount

    def _select_valid_pending_transactions(self) -> list[Transaction]:
        balances = self._confirmed_balances()
        valid_transactions: list[Transaction] = []

        for pending_transaction in self.pending_transactions:
            transaction = (
                Transaction.from_dict(pending_transaction)
                if isinstance(pending_transaction, dict)
                else pending_transaction
            )

            trial_balances = dict(balances)
            if self._apply_transactions_to_balances([transaction], trial_balances):
                valid_transactions.append(transaction)
                balances = trial_balances
            else:
                vorliq_logger.warning(
                    "Pending transaction from %s to %s for %s VLQ was dropped before mining",
                    getattr(transaction, "sender_address", "unknown"),
                    getattr(transaction, "receiver_address", "unknown"),
                    getattr(transaction, "amount", "unknown"),
                )

        return valid_transactions

    def _transaction_identity(self, transaction: Any) -> tuple[Any, ...]:
        if isinstance(transaction, dict):
            transaction = Transaction.from_dict(transaction)
        return (
            transaction.signature,
            transaction.sender_address,
            transaction.receiver_address,
            float(transaction.amount),
            float(transaction.timestamp),
        )
