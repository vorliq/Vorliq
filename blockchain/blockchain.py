from __future__ import annotations

import hashlib
import json
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
        # Chain pruning: when set, all blocks up to and including
        # prune_point["height"] have been dropped from self.chain, and this record
        # is the cryptographic, balance-bearing commitment to that pruned history.
        # It carries the prune-point block hash (which the first retained block
        # links back to), a UTXO-style confirmed-balance snapshot of every wallet
        # as of the prune point, the total issued supply at that point, and a
        # commitment hash over all of it. Balance and supply computations seed
        # from this snapshot instead of from zero, so a pruned chain stays exactly
        # as verifiable and balance-accurate as a full one.
        self.prune_point: dict[str, Any] | None = None

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
            # The block just passed full admission validation (index, link, proof
            # of work, and transaction/signature checks) against a valid tip, so if
            # the chain was known-valid it stays valid. Maintain the memoised result
            # in O(1) instead of forcing a full O(n) re-validation on the next read
            # — this is what stops per-block validation from becoming O(n^2) as the
            # chain grows. Update it *before* the index merge below so the index's
            # chain_valid_fast() read is the O(1) memoised path, not an O(n) revalidate.
            if self._valid_cache is True:
                self._valid_cache_height = self.get_block_height()
                self._valid_cache_tip = block.hash
            self.adjust_difficulty()
            # Maintain the read index incrementally: merge only this block's
            # transactions into the existing index in O(block) time rather than
            # discarding it and forcing an O(n) full rebuild on the next read.
            # Done after adjust_difficulty() so the summary captures the current
            # difficulty/reward, exactly as a full rebuild would. The pending
            # overlay is reconciled lazily by get_indexes(). If anything goes
            # wrong we drop the index so the next read rebuilds from scratch —
            # the chain itself is never put at risk by index maintenance.
            if self._indexes is not None:
                try:
                    self._indexes.add_block(self, block)
                except Exception:
                    vorliq_logger.exception(
                        "Incremental index update failed for block %s; dropping index for rebuild",
                        block.index,
                    )
                    self._indexes = None
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

        # On a pruned chain the first retained block is not the original genesis;
        # its integrity is bound to the dropped history by the prune-point
        # commitment (the snapshot hash and the back-link). Verify that first, then
        # the retained blocks validate exactly as normal (their hashes, proofs of
        # work and links are real), with balances seeded from the prune snapshot.
        if self.prune_point and not self.prune_commitment_is_valid():
            vorliq_logger.warning("Chain validation failed because the prune-point commitment is invalid")
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
        # Keep the incrementally-maintained index: a new pending transaction only
        # shifts the cheap pending overlay, which get_indexes() reconciles in
        # O(pending) via the pending fingerprint — no full O(n) rebuild needed.
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
            # Continue from the tip's true index, not the retained-list length, so
            # mining keeps producing correctly-numbered blocks after a prune.
            index=latest_block.index + 1,
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
        # add_block() above already merged this block into the index's confirmed
        # core. Swapping in the next round's reward/treasury pending pool only
        # changes the pending overlay, which get_indexes() reconciles in
        # O(pending) via the fingerprint — no full rebuild on each mined block.
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

    def get_treasury_transparency(self, max_points: int = 90, recent: int = 15) -> dict[str, Any]:
        """Public, sign-in-free view of the community treasury: the current
        balance, every inflow (the 5% of each block's mining reward routed to the
        treasury) and outflow (faucet starter grants and approved payouts), and a
        downsampled balance-over-time series for a chart. Built from the
        treasury address's own confirmed transactions in the read index, so it is
        verifiable against the block explorer."""
        records = self.get_indexes().transactions_for_address(self.TREASURY_ADDRESS)
        confirmed = [r for r in records if r.get("status") == "confirmed"]
        confirmed.sort(key=lambda r: (int(r.get("block_index") or 0), float(r.get("timestamp") or 0)))

        inflows: list[dict[str, Any]] = []
        outflows: list[dict[str, Any]] = []
        series: list[dict[str, Any]] = []
        balance = total_inflow = total_outflow = faucet_out = payout_out = 0.0
        for record in confirmed:
            amount = float(record.get("amount") or 0)
            timestamp = float(record.get("timestamp") or 0)
            block_index = record.get("block_index")
            if record.get("receiver_address") == self.TREASURY_ADDRESS:
                balance += amount
                total_inflow += amount
                inflows.append({"amount": amount, "timestamp": timestamp, "block_index": block_index, "source": "mining_reward"})
            elif record.get("sender_address") == self.TREASURY_ADDRESS:
                balance -= amount
                total_outflow += amount
                category = str(record.get("category") or record.get("type") or "").lower()
                if "faucet" in category:
                    kind = "faucet"
                    faucet_out += amount
                elif "loan" in category or "lending" in category:
                    kind = "loan"
                    payout_out += amount
                else:
                    kind = "payout"
                    payout_out += amount
                outflows.append({"amount": amount, "timestamp": timestamp, "block_index": block_index, "to_address": record.get("receiver_address"), "kind": kind})
            series.append({"timestamp": timestamp, "block_index": block_index, "balance": round(balance, 8)})

        if len(series) > max_points and max_points > 1:
            step = (len(series) - 1) / (max_points - 1)
            series = [series[round(i * step)] for i in range(max_points)]

        return {
            "treasury_address": self.TREASURY_ADDRESS,
            "balance": round(balance, 8),
            "total_inflow": round(total_inflow, 8),
            "total_outflow": round(total_outflow, 8),
            "inflow_count": len(inflows),
            "outflow_count": len(outflows),
            "faucet_outflow_total": round(faucet_out, 8),
            "payout_outflow_total": round(payout_out, 8),
            "recent_inflows": inflows[-recent:][::-1],
            "recent_outflows": outflows[-recent:][::-1],
            "balance_series": series,
        }

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
            # The chain advanced or reorganised by a path that did not maintain
            # the index incrementally; rebuild authoritatively from scratch.
            return self.rebuild_indexes()
        # Chain tip matches, so the confirmed core is current. Reconcile only the
        # pending overlay if the pending pool changed since it was last applied —
        # an O(pending) refresh, never an O(n) rebuild.
        from indexes import _pending_fingerprint

        fingerprint = _pending_fingerprint(self.pending_transactions)
        if getattr(self._indexes, "pending_fingerprint", None) != fingerprint:
            try:
                self._indexes.refresh_pending_overlay(self)
            except Exception:
                vorliq_logger.exception("Pending overlay refresh failed; rebuilding index")
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
        # Compute the summary directly from cheap O(n) sums rather than forcing a
        # full index rebuild via get_indexes(): on a chain where every block
        # invalidates the index, going through the index meant the constantly-polled
        # summary endpoint rebuilt the whole index, which does not scale. Validity
        # uses the memoised fast path. (Reuse the cached index summary only when it
        # is already current, so we never trigger a rebuild.)
        if self._indexes is not None and getattr(self._indexes, "chain_height", None) == self.get_block_height():
            summary = dict(self._indexes.indexes.get("chain_summary", {}))
            if summary:
                return self._with_prune_context(summary)
        last_block = self.get_latest_block()
        return self._with_prune_context({
            "block_height": self.get_block_height(),
            "total_blocks": len(self.chain),
            "total_transactions": sum(len(block.transactions or []) for block in self.chain),
            "total_issued": self.get_total_issued(),
            "current_difficulty": self.difficulty,
            "current_mining_reward": self.get_current_mining_reward(),
            "last_block_hash": last_block.hash,
            "last_block_timestamp": last_block.timestamp,
            # Integrity only (grandfathered spacing), memoised so it is O(1).
            "chain_valid": self.chain_valid_fast(),
        })

    def _with_prune_context(self, summary: dict[str, Any]) -> dict[str, Any]:
        """Annotate a chain summary so consumers can tell, honestly, when the
        reported block count is a *retained* count rather than the full history.
        On an unpruned chain this adds nothing surprising (retained == total)."""
        summary = dict(summary)
        summary["retained_blocks"] = len(self.chain)
        summary["pruned"] = self.prune_point is not None
        summary["prune_point"] = self._public_prune_point()
        return summary

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
        # The true height is the index carried by the tip block, not the length of
        # the retained list: after pruning, self.chain holds only the most recent N
        # blocks but each block keeps its original index, so the height (and every
        # derived quantity — next block index, halving schedule) must come from the
        # tip's index. For an unpruned chain chain[-1].index == len(chain) - 1, so
        # this is identical to the old behaviour.
        if not self.chain:
            return -1
        return self.chain[-1].index

    def get_current_mining_reward(self) -> float:
        # Halvings are driven by the total number of blocks ever mined, which is
        # the tip's index + 1 — not the retained-list length, which shrinks on a
        # prune. For an unpruned chain this equals len(self.chain), so the reward
        # schedule is unchanged; for a pruned chain it stays on the correct
        # schedule instead of resetting to the genesis reward.
        total_blocks = self.get_block_height() + 1
        halvings = total_blocks // self.halving_interval
        scheduled_reward = self.mining_reward / (2**halvings)
        remaining_supply = max(self.maximum_supply - self.get_total_issued(), 0.0)
        return min(scheduled_reward, remaining_supply)

    def get_total_issued(self) -> float:
        # Served from the incrementally-maintained index when it is current: the
        # index tracks total_issued by adding each new block's SYSTEM-minted
        # amount, so this is O(1) instead of an O(n) rescan of the whole chain on
        # every /diagnostics and /economics read. That rescan (which built a
        # Transaction object per transaction) was both the original log-spam
        # trigger and a reason diagnostics slowed down as the chain grew. The
        # index value is provably equal to the full scan (see
        # test_incremental_index, which asserts total_issued agreement). We gate
        # on an exact tip match and fall back to the full scan otherwise.
        indexes = self._indexes
        if indexes is not None and self.chain:
            latest = self.get_latest_block()
            if (
                getattr(indexes, "chain_height", None) == self.get_block_height()
                and getattr(indexes, "latest_block_hash", None) == latest.hash
            ):
                summary = indexes.indexes.get("chain_summary")
                if isinstance(summary, dict) and "total_issued" in summary:
                    return float(summary["total_issued"])

        total = self._pruned_issued_seed()
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

        # Seed from the pruned-history snapshot so a pruned chain reports the same
        # balance as a full one even on this fallback path (the index path already
        # seeds via build()).
        balance = float((self.prune_point or {}).get("balances", {}).get(address, 0.0)) if self.prune_point else 0.0
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

    def _pruned_balance_seed(self) -> dict[str, float]:
        """Confirmed balances carried over from pruned history (empty if the full
        chain is present). Every balance/ledger computation seeds from this so a
        pruned chain reproduces exactly the same balances as the full chain."""
        if self.prune_point:
            balances = self.prune_point.get("balances") or {}
            return {address: float(value) for address, value in balances.items()}
        return {}

    def _pruned_issued_seed(self) -> float:
        if self.prune_point:
            return float(self.prune_point.get("total_issued") or 0.0)
        return 0.0

    @staticmethod
    def compute_prune_commitment(height: int, block_hash: str, total_issued: float, balances: dict[str, float]) -> str:
        """Deterministic cryptographic commitment to the pruned history's end
        state: the prune-point height and block hash, the total issued supply, and
        the full confirmed-balance snapshot. Any node can recompute this from the
        retained snapshot and check it against the value stored in the
        genesis-equivalent record, so pruned history cannot be silently altered."""
        payload = json.dumps(
            {
                "height": int(height),
                "block_hash": str(block_hash),
                "total_issued": round(float(total_issued), 8),
                "balances": {str(a): round(float(b), 8) for a, b in sorted(balances.items())},
            },
            sort_keys=True,
            separators=(",", ":"),
        )
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()

    def prune_commitment_is_valid(self) -> bool:
        """Verify the retained prune-point snapshot matches its stored commitment
        and that the first retained block links back to the prune-point hash."""
        if not self.prune_point:
            return True
        expected = self.compute_prune_commitment(
            self.prune_point.get("height", -1),
            self.prune_point.get("block_hash", ""),
            self.prune_point.get("total_issued", 0.0),
            self.prune_point.get("balances") or {},
        )
        if expected != self.prune_point.get("commitment"):
            return False
        # The first retained block must link back to the prune point, binding the
        # retained chain to the committed pruned history.
        if self.chain and self.chain[0].previous_hash != self.prune_point.get("block_hash"):
            return False
        return True

    def offered_chain_matches_prune_point(self, offered_chain: list[Block]) -> bool:
        """Whether an offered (genesis-rooted) peer chain reproduces this node's
        prune-point commitment at the prune height.

        A pruned node has dropped its early history and kept only a cryptographic
        commitment to it (the prune-point block hash plus a confirmed-balance
        snapshot). When a full-chain peer offers a longer chain, the pruned node
        must not blindly adopt it: it has to confirm the offered chain's history
        reaches exactly the state we committed to at the prune height, otherwise a
        fork that rewrote pruned history could replace our chain. We check two
        things that together are airtight: the offered chain's block at the prune
        height hashes to our recorded prune-point hash (the block hash commits to
        all prior history via the previous-hash chain), and the confirmed-balance
        state recomputed from the offered chain's prefix reproduces our snapshot's
        commitment exactly. No prune point means there is nothing to reconcile."""
        if not self.prune_point:
            return True
        height = int(self.prune_point.get("height", -1))
        expected_hash = self.prune_point.get("block_hash")
        tip_block = next((block for block in offered_chain if block.index == height), None)
        if tip_block is None or tip_block.hash != expected_hash:
            return False
        balances: dict[str, float] = {}
        total_issued = 0.0
        for block in offered_chain:
            if block.index > height:
                continue
            for transaction in block.transactions:
                tx = transaction if isinstance(transaction, Transaction) else Transaction.from_dict(transaction)
                sender = tx.sender_address
                receiver = tx.receiver_address
                amount = float(tx.amount)
                if sender == SYSTEM_ADDRESS:
                    total_issued += amount
                else:
                    balances[sender] = balances.get(sender, 0.0) - amount
                balances[receiver] = balances.get(receiver, 0.0) + amount
        balances = {address: value for address, value in balances.items() if abs(value) > 1e-12}
        commitment = self.compute_prune_commitment(height, expected_hash, total_issued, balances)
        return commitment == self.prune_point.get("commitment")

    def prune_chain(self, keep_blocks: int) -> dict[str, Any]:
        """Drop all but the most recent ``keep_blocks`` blocks, replacing the
        pruned history with a cryptographic, balance-bearing commitment.

        The retained chain stays fully verifiable: the first kept block links back
        to the prune-point hash recorded in the commitment, and every balance and
        supply computation seeds from the UTXO snapshot, so the pruned chain
        produces byte-for-byte the same balances as the full chain would. This is
        balance-bearing — the snapshot is computed with exactly the index's
        confirmed-balance convention (SYSTEM mints add to supply and are not
        debited; every other sender is debited) so the seed and the retained
        blocks compose to the same totals as a full rebuild."""
        if keep_blocks < 1:
            raise ValueError("keep_blocks must be at least 1")
        with self._append_lock:
            total = len(self.chain)
            if total <= keep_blocks:
                return {
                    "pruned": False,
                    "reason": "chain already at or below the keep target",
                    "height": self.get_block_height(),
                    "retained_blocks": total,
                    "prune_point": self._public_prune_point(),
                }

            prune_index = total - keep_blocks  # number of front blocks to drop
            prune_point_block = self.chain[prune_index - 1]

            balances = self._pruned_balance_seed()
            total_issued = self._pruned_issued_seed()
            for block in self.chain[:prune_index]:
                for transaction in block.transactions:
                    tx = transaction if isinstance(transaction, Transaction) else Transaction.from_dict(transaction)
                    sender = tx.sender_address
                    receiver = tx.receiver_address
                    amount = float(tx.amount)
                    if sender == SYSTEM_ADDRESS:
                        total_issued += amount
                    else:
                        balances[sender] = balances.get(sender, 0.0) - amount
                    balances[receiver] = balances.get(receiver, 0.0) + amount

            # Drop zero balances so the snapshot (and its commitment) is canonical.
            balances = {address: value for address, value in balances.items() if abs(value) > 1e-12}
            commitment = self.compute_prune_commitment(
                prune_point_block.index, prune_point_block.hash, total_issued, balances
            )
            self.prune_point = {
                "height": prune_point_block.index,
                "block_hash": prune_point_block.hash,
                "balances": balances,
                "total_issued": total_issued,
                "commitment": commitment,
                "pruned_at": time.time(),
            }
            dropped = prune_index
            self.chain = self.chain[prune_index:]
            # The derived caches must rebuild from the new prune baseline. Reset the
            # validity memo, then rebuild the index immediately so every balance
            # read goes through the prune-seeded index path rather than the
            # unseeded fallback.
            self._valid_cache = None
            self._valid_cache_height = -1
            self._valid_cache_tip = None
            self._indexes = None
            self.rebuild_indexes()
            vorliq_logger.warning(
                "Pruned chain: dropped %s blocks up to height %s (prune-point hash %s); retaining %s blocks from height %s to %s",
                dropped,
                prune_point_block.index,
                prune_point_block.hash,
                len(self.chain),
                self.chain[0].index,
                self.chain[-1].index,
            )
            return {
                "pruned": True,
                "dropped_blocks": dropped,
                "retained_blocks": len(self.chain),
                "height": self.get_block_height(),
                "prune_point": self._public_prune_point(),
            }

    def prune_height(self) -> int | None:
        """The height up to and including which blocks have been pruned, or None on
        an unpruned chain. A block index <= this value is no longer retained on this
        node (its balance contribution survives in the prune-point snapshot, but the
        individual block and its transactions are not stored here)."""
        if not self.prune_point:
            return None
        return int(self.prune_point.get("height", -1))

    def is_pruned_block_index(self, index: int) -> bool:
        """True iff `index` refers to a block that existed but has been pruned away,
        as opposed to a block that simply never existed (index above the tip)."""
        height = self.prune_height()
        return height is not None and 0 <= index <= height

    def _public_prune_point(self) -> dict[str, Any] | None:
        """Prune-point metadata safe to expose over the API (no full balance map)."""
        if not self.prune_point:
            return None
        return {
            "height": self.prune_point.get("height"),
            "block_hash": self.prune_point.get("block_hash"),
            "commitment": self.prune_point.get("commitment"),
            "total_issued": self.prune_point.get("total_issued"),
            "snapshot_addresses": len(self.prune_point.get("balances") or {}),
            "pruned_at": self.prune_point.get("pruned_at"),
        }

    def _chain_transactions_are_valid(self, chain: list[Block]) -> bool:
        balances: dict[str, float] = self._pruned_balance_seed()

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
        # Prefer the incrementally-maintained confirmed-balance index. It is kept
        # in lock-step with the chain as blocks are appended and is provably
        # identical to a full re-derivation (see test_incremental_index), so we
        # can hand back a copy in O(addresses) instead of rescanning every
        # transaction in the whole chain on every block append and every send
        # validation. That full rescan was a second unbounded O(n) under the
        # write lock — alongside the old index rebuild — and is what kept block
        # processing growing with chain length. We read self._indexes directly
        # and gate on an exact tip match so this never triggers a rebuild and
        # never trusts a stale index; any mismatch falls back to the full scan.
        # A copy is returned because callers mutate the result with trial
        # transactions.
        indexes = self._indexes
        if indexes is not None and self.chain:
            latest = self.get_latest_block()
            if (
                getattr(indexes, "chain_height", None) == self.get_block_height()
                and getattr(indexes, "latest_block_hash", None) == latest.hash
            ):
                confirmed = indexes.indexes.get("confirmed_balances_by_address")
                if confirmed is not None:
                    return dict(confirmed)

        balances: dict[str, float] = self._pruned_balance_seed()
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
