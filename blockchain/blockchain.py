from __future__ import annotations

import math
import os
import threading
import time
from typing import Any

from block import Block
from logger import vorliq_logger
from transaction import SYSTEM_ADDRESSES, SYSTEM_ADDRESS, TREASURY_ADDRESS, Transaction


class MiningCooldownError(ValueError):
    def __init__(self, wait_seconds: int) -> None:
        self.wait_seconds = wait_seconds
        super().__init__(f"too soon to mine the next block; wait {wait_seconds} seconds")


class StaleBlockError(RuntimeError):
    """Raised when a block was solved against a tip that has since advanced (some
    other miner won the race). The solved block is discarded rather than appended,
    so the caller can simply try again on the new tip."""


class Blockchain:
    # Proof-of-work difficulty (leading zero hex digits). Configurable so the e2e
    # suite can mine quickly; production leaves the default of 4.
    difficulty = int(os.environ.get("VORLIQ_DIFFICULTY", "4"))
    maximum_supply = 21_000_000.0
    initial_mining_reward = 50.0
    halving_interval = 210_000
    BLOCK_TIME_TARGET = 60
    # Minimum spacing between blocks. Configurable only so the end-to-end suite can
    # confirm transactions quickly; production leaves the default of 30 seconds.
    BLOCK_TIME_MINIMUM = int(os.environ.get("VORLIQ_BLOCK_TIME_MINIMUM", "30"))
    # Anti-monopoly window: a miner may not mine two CONSECUTIVE blocks within
    # this gap, so a *different* miner always gets first claim on the immediate
    # next block. Crucially it is a time window, not an absolute ban: after the
    # gap a lone miner may mine again, so a network that drops to a single active
    # miner keeps producing blocks instead of halting forever (which would strand
    # every pending transaction). Derived from the minimum spacing so it relaxes
    # to 0 when block time is relaxed (dev/e2e). Production: 2 x 30s = 60s.
    SAME_MINER_MIN_GAP = 2 * int(os.environ.get("VORLIQ_BLOCK_TIME_MINIMUM", "30"))
    DIFFICULTY_ADJUSTMENT_INTERVAL = 10
    TREASURY_PERCENTAGE = 0.05
    TREASURY_ADDRESS = TREASURY_ADDRESS

    def __init__(self) -> None:
        self.mining_reward = self.initial_mining_reward
        self.proof_target = "0" * self.difficulty
        self.chain: list[Block] = [self.create_genesis_block()]
        self.pending_transactions: list[Transaction] = []
        self._indexes = None
        # Memoised structural-validity result for the hot read paths, keyed by the
        # chain tip. Full is_chain_valid is O(n) (it recomputes every block hash);
        # recomputing it on every diagnostics/summary read does not scale, so those
        # paths use chain_valid_fast() which recomputes at most once per new tip.
        self._valid_cache = None
        self._valid_cache_height = -1
        self._valid_cache_tip = None
        # Serializes tip validation and append so concurrent miners cannot
        # both extend the same tip (two blocks claiming the same index).
        self._append_lock = threading.Lock()

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
        # The tip read, every validation against that tip, and the append must
        # happen under one held lock. Without it, two concurrent miners can both
        # validate against the same tip and both append, forking the chain in
        # place with two blocks at the same index.
        with self._append_lock:
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
            if (
                previous_miner
                and current_miner
                and previous_miner == current_miner
                and block.timestamp - latest_block.timestamp < self.SAME_MINER_MIN_GAP
            ):
                vorliq_logger.warning("Rejected block %s because miner %s mined a consecutive block within the anti-monopoly window", block.index, current_miner)
                return False

            if not block.has_valid_proof(getattr(block, "difficulty", self.difficulty)):
                vorliq_logger.warning("Rejected block %s because proof of work was invalid", block.index)
                return False

            if not self._transactions_are_valid_for_next_block(block.transactions):
                vorliq_logger.warning("Rejected block %s because a transaction was invalid", block.index)
                return False

            self.chain.append(block)
            self._indexes = None
            self.adjust_difficulty()
            return True

    def is_chain_valid(self, enforce_block_spacing: bool = True) -> bool:
        # Two kinds of rule are checked here, and they are not the same kind of
        # thing. Structural integrity — the genesis hash, every block's hash and
        # proof of work, the previous-hash links, and the balance/signature
        # ledger — is a permanent, tamper-evident invariant: it must hold for
        # every block forever. The block-spacing rules (BLOCK_TIME_MINIMUM and
        # the same-miner anti-monopoly gap) are admission policy: they govern
        # whether a *new* block may join the tip, and they are already enforced
        # at admission in add_block() and the mining cooldown.
        #
        # Re-applying admission policy to already-admitted historical blocks is
        # wrong, because the policy value can change over time (it is read from
        # the environment) and tests/local nodes mine faster than production. A
        # block that was validly admitted under the policy in force when it was
        # mined must stay valid forever, or the persisted chain cannot survive a
        # restart. So callers validating our own trusted, already-persisted chain
        # (reload, save, status) pass enforce_block_spacing=False to check
        # integrity only, while callers admitting new or untrusted blocks (peer
        # chain adoption) keep the default and enforce spacing too.
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
            if enforce_block_spacing:
                if current_miner and current_block.timestamp - previous_block.timestamp < self.BLOCK_TIME_MINIMUM:
                    vorliq_logger.warning("Chain validation failed at block %s: block was mined too soon", current_block.index)
                    return False
                if (
                    current_miner
                    and previous_miner
                    and current_miner == previous_miner
                    and current_block.timestamp - previous_block.timestamp < self.SAME_MINER_MIN_GAP
                ):
                    vorliq_logger.warning("Chain validation failed at block %s: consecutive miner within the anti-monopoly window", current_block.index)
                    return False

        if not self._chain_transactions_are_valid(self.chain):
            vorliq_logger.warning("Chain validation failed because balances or transaction signatures are invalid")
            return False

        vorliq_logger.info("Chain validation passed for %s blocks", len(self.chain))
        return True

    def chain_valid_fast(self) -> bool:
        """Structural validity for hot, frequently-polled read paths (diagnostics,
        the index chain summary). Memoised by chain tip so the O(n) recompute runs
        at most once per new block, not once per request. Authoritative, fresh
        validation (save, startup, peer adoption) still calls is_chain_valid."""
        tip = self.chain[-1].hash if self.chain else None
        height = self.get_block_height()
        if self._valid_cache is not None and self._valid_cache_height == height and self._valid_cache_tip == tip:
            return self._valid_cache
        result = self.is_chain_valid(enforce_block_spacing=False)
        self._valid_cache = result
        self._valid_cache_height = height
        self._valid_cache_tip = tip
        return result

    def add_pending_transaction(self, transaction: Transaction) -> bool:
        if not isinstance(transaction, Transaction):
            raise TypeError("transaction must be a Transaction instance")

        if not transaction.verify_transaction():
            raise ValueError("transaction signature is invalid")

        if not self._pending_transaction_has_spendable_balance(transaction):
            raise ValueError("sender does not have enough confirmed VLQ for this transaction")

        self.pending_transactions.append(transaction)
        self._indexes = None
        vorliq_logger.info(
            "Transaction added to pending pool from %s to %s for %s VLQ",
            transaction.sender_address,
            transaction.receiver_address,
            transaction.amount,
        )
        return True

    def build_candidate_block(self, miner_address: str) -> tuple[Block, str]:
        """Phase 1 of mining: validate and assemble an un-mined candidate block.

        This is cheap — it does no proof of work — so a caller can run it while
        holding a lock only briefly, release the lock, compute the (expensive)
        proof of work without blocking anyone, and then call finalize_mined_block
        to append. Returns (candidate_block, expected_previous_hash); the latter is
        the tip the block was built on, used to detect a stale race at finalize."""
        if not miner_address:
            raise ValueError("miner_address is required")
        miner_address = str(miner_address).replace("\x00", "").strip()
        if miner_address in SYSTEM_ADDRESSES or miner_address == self.TREASURY_ADDRESS:
            raise ValueError("reserved system addresses cannot receive public mining rewards")
        # Gate mining on the *integrity* of our own chain, not on the spacing of
        # historical blocks — otherwise a node carrying grandfathered fast blocks
        # could never mine again. The new block's own spacing is still enforced
        # by the cooldown check below and by add_block().
        if not self.is_chain_valid(enforce_block_spacing=False):
            raise ValueError("current chain is invalid; mining is disabled until validated recovery completes")

        latest_block = self.get_latest_block()
        elapsed_seconds = time.time() - latest_block.timestamp
        if elapsed_seconds < self.BLOCK_TIME_MINIMUM:
            wait_seconds = int(math.ceil(self.BLOCK_TIME_MINIMUM - elapsed_seconds))
            raise MiningCooldownError(wait_seconds)

        valid_transactions = self._select_valid_pending_transactions()
        dropped_count = len(self.pending_transactions) - len(valid_transactions)
        if dropped_count:
            vorliq_logger.warning("Dropped %s invalid pending transactions before mining", dropped_count)

        # Snapshot the difficulty onto the block so the proof of work the caller
        # computes targets the difficulty in force when the candidate was built.
        block = Block(
            index=len(self.chain),
            transactions=valid_transactions,
            previous_hash=latest_block.hash,
            miner_address=miner_address,
            difficulty=self.difficulty,
        )

        # Same-miner anti-monopoly cooldown, checked before proof of work so we do
        # not burn the work on a block that cannot be accepted. Measured against
        # the candidate block's own timestamp (the time it would be mined), the
        # same value add_block re-checks, so the boundary is identical.
        previous_miner = getattr(latest_block, "miner_address", None)
        if previous_miner and previous_miner == miner_address:
            same_miner_elapsed = block.timestamp - latest_block.timestamp
            if same_miner_elapsed < self.SAME_MINER_MIN_GAP:
                wait_seconds = int(math.ceil(self.SAME_MINER_MIN_GAP - same_miner_elapsed))
                # Keep the substring the API layer matches on, but make it a soft,
                # time-bounded cooldown so a lone miner is not blocked forever.
                raise ValueError(f"the same address cannot mine two consecutive blocks yet; wait {wait_seconds} seconds")

        return block, latest_block.hash

    def finalize_mined_block(self, block: Block, expected_previous_hash: str) -> Block:
        """Phase 2 of mining: append an already-proof-of-worked block, but only if
        the tip has not advanced since the candidate was built. If another block
        was appended in the meantime, the solved block is stale (its previous_hash
        and difficulty no longer match the chain), so we raise StaleBlockError
        instead of corrupting the chain."""
        latest_block = self.get_latest_block()
        if latest_block.hash != expected_previous_hash:
            raise StaleBlockError(
                "chain tip advanced while mining; the solved block is stale and was not appended"
            )

        if not self.add_block(block):
            raise RuntimeError("mined block failed validation")

        mining_reward = self.get_current_mining_reward()
        miner_reward = round(mining_reward * (1 - self.TREASURY_PERCENTAGE), 8)
        treasury_reward = round(mining_reward * self.TREASURY_PERCENTAGE, 8)
        reward_transaction = Transaction(
            sender_address=SYSTEM_ADDRESS,
            receiver_address=block.miner_address,
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
        self._indexes = None
        vorliq_logger.info("Mined block %s with hash %s", block.index, block.hash)
        return block

    def mine_pending_transactions(self, miner_address: str) -> Block:
        """Atomic build + proof of work + append. Used directly by tests and any
        single-threaded caller; the threaded service splits these phases so the
        proof of work runs outside the chain lock (see app.py)."""
        block, expected_previous_hash = self.build_candidate_block(miner_address)
        block.proof_of_work(block.difficulty)
        return self.finalize_mined_block(block, expected_previous_hash)

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
        # The e2e suite mines with no minimum block spacing, which would make the
        # retarget keep raising difficulty until proof-of-work is unusably slow.
        # This flag pins difficulty for tests only; production never sets it.
        if os.environ.get("VORLIQ_DISABLE_DIFFICULTY_ADJUSTMENT") == "true":
            return
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
        return [self.safe_transaction_record(transaction, status="pending") for transaction in self.pending_transactions]

    def set_indexes(self, indexes: Any | None) -> None:
        self._indexes = indexes

    def rebuild_indexes(self) -> Any:
        from indexes import BlockchainIndexes

        self._indexes = BlockchainIndexes.build(self)
        return self._indexes

    def get_indexes(self) -> Any:
        if self._indexes is None:
            return self.rebuild_indexes()
        latest_block = self.get_latest_block()
        if (
            getattr(self._indexes, "chain_height", None) != self.get_block_height()
            or getattr(self._indexes, "latest_block_hash", None) != latest_block.hash
        ):
            return self.rebuild_indexes()
        return self._indexes

    def index_health(self, *, exists: bool = True, valid: bool = True, message: str | None = None) -> dict[str, Any]:
        indexes = self.get_indexes()
        return indexes.health(self, exists=exists, valid=valid, message=message)

    def get_chain_data(self) -> list[dict[str, Any]]:
        return [block.to_dict() for block in self.chain]

    def get_blocks_page(self, limit: int, offset: int) -> tuple[list[dict[str, Any]], int, bool]:
        if self._indexes is not None:
            return self.get_indexes().blocks_page(limit, offset)
        blocks = [self.safe_block_record(block, include_transactions=True) for block in reversed(self.chain)]
        total = len(blocks)
        page = blocks[offset : offset + limit]
        return page, total, offset + limit < total

    def get_chain_summary(self) -> dict[str, Any]:
        if self._indexes is not None:
            summary = dict(self.get_indexes().indexes.get("chain_summary", {}))
            if summary:
                return summary
        last_block = self.get_latest_block()
        return {
            "block_height": self.get_block_height(),
            "total_blocks": len(self.chain),
            "total_transactions": sum(len(block.transactions or []) for block in self.chain),
            "total_issued": self.get_total_issued(),
            "current_difficulty": self.difficulty,
            "current_mining_reward": self.get_current_mining_reward(),
            "last_block_hash": last_block.hash,
            "last_block_timestamp": last_block.timestamp,
            # Reported validity of our own persisted chain: integrity only, so a
            # chain with grandfathered fast blocks is not mislabelled invalid.
            "chain_valid": self.is_chain_valid(enforce_block_spacing=False),
        }

    def get_mining_status(self) -> dict[str, Any]:
        last_block = self.get_latest_block()
        now = time.time()
        seconds_since_last_block = max(now - float(last_block.timestamp), 0.0)
        seconds_until_next_allowed_block = max(self.BLOCK_TIME_MINIMUM - seconds_since_last_block, 0.0)
        # Our own chain's integrity gates whether mining is offered; the per-block
        # spacing is surfaced separately as seconds_until_next_allowed_block.
        chain_valid = self.is_chain_valid(enforce_block_spacing=False)
        current_reward = self.get_current_mining_reward()
        miner_reward = round(current_reward * (1 - self.TREASURY_PERCENTAGE), 8)
        treasury_reward = round(current_reward * self.TREASURY_PERCENTAGE, 8)
        previous_miner = getattr(last_block, "miner_address", None)
        pending_transactions = self.pending_transactions or []
        pending_user_transactions = [
            transaction for transaction in pending_transactions
            if self._coerce_transaction(transaction).sender_address != SYSTEM_ADDRESS
        ]

        can_mine_now = chain_valid and seconds_until_next_allowed_block <= 0
        reason_if_not = None
        if not chain_valid:
            reason_if_not = "Chain validation failed."
        elif seconds_until_next_allowed_block > 0:
            reason_if_not = f"Next block is allowed in {int(math.ceil(seconds_until_next_allowed_block))} seconds."

        return {
            "enabled": True,
            "current_block_height": self.get_block_height(),
            "chain_valid": chain_valid,
            "current_difficulty": self.difficulty,
            "current_mining_reward": current_reward,
            "treasury_percentage": self.TREASURY_PERCENTAGE,
            "miner_reward_after_treasury": miner_reward,
            "treasury_reward_per_block": treasury_reward,
            "block_time_target": self.BLOCK_TIME_TARGET,
            "block_time_minimum": self.BLOCK_TIME_MINIMUM,
            "seconds_since_last_block": round(seconds_since_last_block, 2),
            "seconds_until_next_allowed_block": int(math.ceil(seconds_until_next_allowed_block)),
            "last_block_timestamp": last_block.timestamp,
            "last_block_hash": last_block.hash,
            "last_miner_address": previous_miner,
            "can_mine_now": can_mine_now,
            "reason_if_not": reason_if_not,
            "pending_transaction_count": len(pending_transactions),
            "pending_user_transaction_count": len(pending_user_transactions),
        }

    def _block_reward_record(self, block_index: int, miner_address: str | None) -> dict[str, Any]:
        current_reward = self.get_current_mining_reward()
        expected_miner_reward = round(current_reward * (1 - self.TREASURY_PERCENTAGE), 8)
        expected_treasury_reward = round(current_reward * self.TREASURY_PERCENTAGE, 8)
        reward_block = self.chain[block_index + 1] if block_index + 1 < len(self.chain) else None
        miner_reward = None
        treasury_reward = None

        if reward_block is not None:
            for transaction in reward_block.transactions or []:
                tx = self._coerce_transaction(transaction)
                if tx.sender_address != SYSTEM_ADDRESS:
                    continue
                if miner_address and tx.receiver_address == miner_address and miner_reward is None:
                    miner_reward = tx.amount
                if tx.receiver_address == self.TREASURY_ADDRESS and treasury_reward is None:
                    treasury_reward = tx.amount

        return {
            "miner_reward_amount": miner_reward if miner_reward is not None else expected_miner_reward,
            "treasury_reward_amount": treasury_reward if treasury_reward is not None else expected_treasury_reward,
            "reward_status": "confirmed" if reward_block is not None else "pending_next_block",
        }

    def get_mining_history(self, limit: int, offset: int) -> dict[str, Any]:
        mined_blocks = [block for block in self.chain[1:] if getattr(block, "miner_address", None)]
        rows: list[dict[str, Any]] = []
        for block in reversed(mined_blocks):
            previous_block = self.chain[block.index - 1] if block.index > 0 else None
            rewards = self._block_reward_record(block.index, getattr(block, "miner_address", None))
            rows.append(
                {
                    "block_index": block.index,
                    "block_hash": block.hash,
                    "timestamp": block.timestamp,
                    "miner_address": getattr(block, "miner_address", None),
                    "transaction_count": len(block.transactions or []),
                    "difficulty": getattr(block, "difficulty", None),
                    "seconds_since_previous_block": (
                        round(block.timestamp - previous_block.timestamp, 2)
                        if previous_block is not None
                        else None
                    ),
                    **rewards,
                }
            )

        total = len(rows)
        page = rows[offset : offset + limit]
        return {
            "history": page,
            "total": total,
            "limit": limit,
            "offset": offset,
            "has_more": offset + limit < total,
        }

    def get_address_transactions(self, address: str, limit: int, offset: int) -> tuple[list[dict[str, Any]], int, bool]:
        if not address:
            raise ValueError("address is required")

        matches = self._confirmed_transaction_records(address=address)

        total = len(matches)
        page = matches[offset : offset + limit]
        return page, total, offset + limit < total

    def _coerce_transaction(self, transaction: Any) -> Transaction:
        if isinstance(transaction, Transaction):
            return transaction
        if isinstance(transaction, dict):
            return Transaction.from_dict(transaction)
        raise ValueError("invalid transaction")

    def _safe_metadata(self, metadata: Any) -> Any:
        if not isinstance(metadata, dict):
            return {}
        safe: dict[str, Any] = {}
        blocked_fragments = ("private", "password", "secret", "token", "key")
        for key, value in metadata.items():
            key_text = str(key)
            lowered = key_text.lower()
            if any(fragment in lowered for fragment in blocked_fragments):
                continue
            if isinstance(value, (str, int, float, bool)) or value is None:
                safe[key_text] = value
            elif isinstance(value, list):
                safe[key_text] = [
                    item for item in value
                    if isinstance(item, (str, int, float, bool)) or item is None
                ][:20]
            elif isinstance(value, dict):
                safe[key_text] = self._safe_metadata(value)
        return safe

    def _transaction_matches_address(self, transaction: Transaction, address: str | None) -> bool:
        return not address or transaction.sender_address == address or transaction.receiver_address == address

    def _record_matches_address(self, record: dict[str, Any], address: str | None) -> bool:
        return not address or record.get("sender_address") == address or record.get("receiver_address") == address

    def _transaction_matches_type(self, transaction: Transaction, tx_type: str | None) -> bool:
        if not tx_type:
            return True
        lowered = tx_type.lower()
        return lowered in {
            str(getattr(transaction, "transaction_type", "")).lower(),
            str(getattr(transaction, "category", "")).lower(),
        }

    def safe_transaction_record(
        self,
        transaction: Any,
        status: str,
        block: Block | None = None,
        transaction_index: int | None = None,
    ) -> dict[str, Any]:
        tx = self._coerce_transaction(transaction)
        block_index = block.index if block else None
        block_hash = block.hash if block else None
        confirmations = max(self.get_block_height() - block.index + 1, 0) if block else 0
        tx_id = tx.tx_id or tx.calculate_tx_id()
        metadata = self._safe_metadata(getattr(tx, "metadata", {}))
        message = metadata.get("message") if isinstance(metadata.get("message"), str) else None
        return {
            "tx_id": tx_id,
            "status": status,
            "block_index": block_index,
            "block_hash": block_hash,
            "block_timestamp": block.timestamp if block else None,
            "confirmations": confirmations,
            "timestamp": tx.timestamp,
            "sender": tx.sender_address,
            "sender_address": tx.sender_address,
            "recipient": tx.receiver_address,
            "receiver_address": tx.receiver_address,
            "amount": tx.amount,
            "type": getattr(tx, "transaction_type", None) or getattr(tx, "category", None) or "transfer",
            "category": getattr(tx, "category", None) or getattr(tx, "transaction_type", None) or "transfer",
            "message": message,
            "metadata": metadata,
            "signature_present": bool(tx.signature),
            "public_key_present": bool(tx.sender_public_key),
            "transaction_index": transaction_index,
        }

    def _pending_transaction_records(
        self,
        address: str | None = None,
        tx_type: str | None = None,
    ) -> list[dict[str, Any]]:
        if self._indexes is not None and not tx_type:
            indexes = self.get_indexes()
            if address:
                records = [
                    record for record in indexes.transactions_for_address(address)
                    if record.get("status") == "pending"
                ]
            else:
                records = [
                    record
                    for record in indexes.indexes.get("transactions_by_id", {}).values()
                    if record.get("status") == "pending"
                ]
            return sorted(records, key=lambda item: float(item.get("timestamp") or 0), reverse=True)
        records = []
        for index, transaction in enumerate(self.pending_transactions or []):
            tx = self._coerce_transaction(transaction)
            if self._transaction_matches_address(tx, address) and self._transaction_matches_type(tx, tx_type):
                records.append(self.safe_transaction_record(tx, status="pending", transaction_index=index))
        return sorted(records, key=lambda item: float(item.get("timestamp") or 0), reverse=True)

    def _confirmed_transaction_records(
        self,
        address: str | None = None,
        tx_type: str | None = None,
    ) -> list[dict[str, Any]]:
        if self._indexes is not None and not tx_type:
            indexes = self.get_indexes()
            if address:
                records = [
                    record for record in indexes.transactions_for_address(address)
                    if record.get("status") == "confirmed"
                ]
            else:
                records = [
                    record
                    for record in indexes.indexes.get("transactions_by_id", {}).values()
                    if record.get("status") == "confirmed"
                ]
            return sorted(records, key=lambda item: float(item.get("timestamp") or 0), reverse=True)
        records: list[dict[str, Any]] = []
        for block in reversed(self.chain):
            for index, transaction in enumerate(block.transactions or []):
                tx = self._coerce_transaction(transaction)
                if self._transaction_matches_address(tx, address) and self._transaction_matches_type(tx, tx_type):
                    records.append(
                        self.safe_transaction_record(
                            tx,
                            status="confirmed",
                            block=block,
                            transaction_index=index,
                        )
                    )
        return sorted(records, key=lambda item: float(item.get("timestamp") or 0), reverse=True)

    def get_pending_transaction_records(
        self,
        limit: int,
        offset: int,
        address: str | None = None,
    ) -> tuple[list[dict[str, Any]], int, bool]:
        records = self._pending_transaction_records(address=address)
        total = len(records)
        return records[offset : offset + limit], total, offset + limit < total

    def get_transaction_records(
        self,
        limit: int,
        offset: int,
        address: str | None = None,
        tx_type: str | None = None,
        status: str = "all",
    ) -> tuple[list[dict[str, Any]], int, bool]:
        if status not in {"pending", "confirmed", "all"}:
            raise ValueError("status must be pending, confirmed, or all")
        if self._indexes is not None and not tx_type:
            indexed_records = list(self.get_indexes().indexes.get("transactions_by_id", {}).values())
            records = [
                record for record in indexed_records
                if (status == "all" or record.get("status") == status)
                and self._record_matches_address(record, address)
            ]
            records.sort(key=lambda item: float(item.get("timestamp") or 0), reverse=True)
            total = len(records)
            return records[offset : offset + limit], total, offset + limit < total
        records: list[dict[str, Any]] = []
        if status in {"pending", "all"}:
            records.extend(self._pending_transaction_records(address=address, tx_type=tx_type))
        if status in {"confirmed", "all"}:
            records.extend(self._confirmed_transaction_records(address=address, tx_type=tx_type))
        records.sort(key=lambda item: float(item.get("timestamp") or 0), reverse=True)
        total = len(records)
        return records[offset : offset + limit], total, offset + limit < total

    def get_transaction_detail(self, tx_id: str) -> dict[str, Any] | None:
        if not tx_id:
            raise ValueError("transaction ID is required")
        if self._indexes is not None:
            record = self.get_indexes().transaction_detail(tx_id)
            if record:
                return record
        for record in self._pending_transaction_records():
            if record["tx_id"] == tx_id:
                return record
        for record in self._confirmed_transaction_records():
            if record["tx_id"] == tx_id:
                return record
        return None

    def safe_block_record(self, block: Block, include_transactions: bool = False) -> dict[str, Any]:
        transactions = [
            self.safe_transaction_record(transaction, status="confirmed", block=block, transaction_index=index)
            for index, transaction in enumerate(block.transactions or [])
        ]
        record: dict[str, Any] = {
            "index": block.index,
            "hash": block.hash,
            "previous_hash": block.previous_hash,
            "timestamp": block.timestamp,
            "nonce": block.nonce,
            "difficulty": getattr(block, "difficulty", None),
            "miner_address": getattr(block, "miner_address", None),
            "transaction_count": len(transactions),
            "mining_reward_transactions": [
                transaction for transaction in transactions if transaction["sender_address"] == SYSTEM_ADDRESS
            ],
            "confirmations": max(self.get_block_height() - block.index + 1, 0),
        }
        if include_transactions:
            record["transactions"] = transactions
        return record

    def get_block_detail(self, index_or_hash: str) -> dict[str, Any] | None:
        if index_or_hash is None or str(index_or_hash).strip() == "":
            raise ValueError("block index or hash is required")
        term = str(index_or_hash).strip()
        if self._indexes is not None:
            return self.get_indexes().block_detail(term)
        target_index: int | None = None
        if term.isdigit():
            target_index = int(term)
        for block in self.chain:
            if (target_index is not None and block.index == target_index) or block.hash == term:
                return self.safe_block_record(block, include_transactions=True)
        return None

    def get_address_history(self, address: str, limit: int, offset: int) -> dict[str, Any]:
        if not address:
            raise ValueError("address is required")
        if self._indexes is not None:
            all_records = self.get_indexes().transactions_for_address(address)
            confirmed = [tx for tx in all_records if tx["status"] == "confirmed"]
            pending = [tx for tx in all_records if tx["status"] == "pending"]
            confirmed_incoming = [tx for tx in confirmed if tx["receiver_address"] == address]
            confirmed_outgoing = [tx for tx in confirmed if tx["sender_address"] == address]
            pending_incoming = [tx for tx in pending if tx["receiver_address"] == address]
            pending_outgoing = [tx for tx in pending if tx["sender_address"] == address]
            mined_rewards = [
                tx for tx in confirmed_incoming
                if tx["sender_address"] == SYSTEM_ADDRESS and tx["type"] in {"mining_reward", "treasury_reward"}
            ]
            page = all_records[offset : offset + limit]
            confirmed_balance = self.get_indexes().confirmed_balance(address)
            return {
                "address": address,
                "balance": self.get_indexes().balance(address),
                "confirmed_balance": confirmed_balance,
                "pending_incoming": pending_incoming,
                "pending_outgoing": pending_outgoing,
                "confirmed_incoming": confirmed_incoming,
                "confirmed_outgoing": confirmed_outgoing,
                "mined_rewards": mined_rewards,
                "total_sent": sum(float(tx["amount"]) for tx in confirmed_outgoing),
                "total_received": sum(float(tx["amount"]) for tx in confirmed_incoming),
                "pending_incoming_total": sum(float(tx["amount"]) for tx in pending_incoming),
                "pending_outgoing_total": sum(float(tx["amount"]) for tx in pending_outgoing),
                "transaction_count": len(all_records),
                "transactions": page,
                "total": len(all_records),
                "limit": limit,
                "offset": offset,
                "has_more": offset + limit < len(all_records),
            }
        confirmed = self._confirmed_transaction_records(address=address)
        pending = self._pending_transaction_records(address=address)
        confirmed_incoming = [tx for tx in confirmed if tx["receiver_address"] == address]
        confirmed_outgoing = [tx for tx in confirmed if tx["sender_address"] == address]
        pending_incoming = [tx for tx in pending if tx["receiver_address"] == address]
        pending_outgoing = [tx for tx in pending if tx["sender_address"] == address]
        mined_rewards = [
            tx for tx in confirmed_incoming
            if tx["sender_address"] == SYSTEM_ADDRESS and tx["type"] in {"mining_reward", "treasury_reward"}
        ]
        all_records = sorted(
            [*pending, *confirmed],
            key=lambda item: float(item.get("timestamp") or 0),
            reverse=True,
        )
        page = all_records[offset : offset + limit]
        confirmed_balance = 0.0
        for transaction in confirmed:
            if transaction["receiver_address"] == address:
                confirmed_balance += float(transaction["amount"])
            if transaction["sender_address"] == address:
                confirmed_balance -= float(transaction["amount"])
        return {
            "address": address,
            "balance": self.get_balance(address),
            "confirmed_balance": confirmed_balance,
            "pending_incoming": pending_incoming,
            "pending_outgoing": pending_outgoing,
            "confirmed_incoming": confirmed_incoming,
            "confirmed_outgoing": confirmed_outgoing,
            "mined_rewards": mined_rewards,
            "total_sent": sum(float(tx["amount"]) for tx in confirmed_outgoing),
            "total_received": sum(float(tx["amount"]) for tx in confirmed_incoming),
            "pending_incoming_total": sum(float(tx["amount"]) for tx in pending_incoming),
            "pending_outgoing_total": sum(float(tx["amount"]) for tx in pending_outgoing),
            "transaction_count": len(all_records),
            "transactions": page,
            "total": len(all_records),
            "limit": limit,
            "offset": offset,
            "has_more": offset + limit < len(all_records),
        }

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
        if self._indexes is not None:
            return self.get_indexes().balance(address)

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
        self._indexes = None

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
            "is_valid": self.is_chain_valid(enforce_block_spacing=False),
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
