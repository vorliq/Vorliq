from __future__ import annotations

import time
from typing import Any

from transaction import SYSTEM_ADDRESS, TREASURY_ADDRESS, Transaction


SCHEMA_VERSION = 1
LATEST_BLOCK_LIMIT = 500


class BlockchainIndexes:
    """Derived read indexes for public blockchain lookups.

    These indexes are rebuilt from the in-memory blockchain and are never a
    source of truth. Historical blocks and transaction objects are not mutated.
    """

    def __init__(
        self,
        *,
        schema_version: int,
        built_at: str,
        chain_height: int,
        latest_block_hash: str | None,
        indexes: dict[str, Any],
        valid: bool = True,
        status: str = "ok",
        message: str = "indexes are current",
    ) -> None:
        self.schema_version = schema_version
        self.built_at = built_at
        self.chain_height = chain_height
        self.latest_block_hash = latest_block_hash
        self.indexes = indexes
        self.valid = valid
        self.status = status
        self.message = message
        # Tracking for the incrementally-maintained pending overlay. The
        # confirmed core (blocks, confirmed balances, confirmed tx records) is
        # merged one block at a time in add_block(); the pending overlay (which
        # changes far more often than the chain) is re-derived cheaply in
        # refresh_pending_overlay(). These record which tx_ids/addresses the
        # *current* overlay contributed so the next refresh can strip its own
        # previous additions without rebuilding the whole index.
        self._pending_tx_ids: set[str] = set()
        self._pending_addresses: set[str] = set()
        # Pending transaction records by address, kept out of the chain-sized
        # confirmed buckets and merged at read time (see transactions_for_address).
        self._pending_records_by_address: dict[str, list[dict[str, Any]]] = {}
        # Fingerprint of the pending pool this index's overlay reflects; the
        # blockchain compares it to detect a changed pool and trigger an
        # O(pending) overlay refresh instead of an O(n) full rebuild.
        self.pending_fingerprint: tuple[int, tuple[str, ...]] | None = None

    @classmethod
    def build(cls, blockchain: Any) -> "BlockchainIndexes":
        blocks_by_index: dict[str, dict[str, Any]] = {}
        blocks_by_hash: dict[str, dict[str, Any]] = {}
        transactions_by_id: dict[str, dict[str, Any]] = {}
        transactions_by_address: dict[str, list[dict[str, Any]]] = {}
        transactions_by_block: dict[str, list[dict[str, Any]]] = {}
        # Seed confirmed balances and issued supply from the prune-point snapshot
        # (empty when the full chain is present) so a pruned chain's index reports
        # exactly the same balances and supply as a full rebuild would.
        prune_point = getattr(blockchain, "prune_point", None)
        if prune_point:
            confirmed_balances = {a: float(v) for a, v in (prune_point.get("balances") or {}).items()}
            total_issued = float(prune_point.get("total_issued") or 0.0)
        else:
            confirmed_balances = {}
            total_issued = 0.0
        balances_by_address: dict[str, float] = {}
        miner_stats: dict[str, dict[str, Any]] = {}
        treasury_ledger_index: list[dict[str, Any]] = []

        for block in blockchain.chain:
            block_record = blockchain.safe_block_record(block, include_transactions=True)
            index_key = str(block.index)
            hash_key = str(block.hash)
            blocks_by_index[index_key] = block_record
            blocks_by_hash[hash_key] = block_record
            transactions_by_block[index_key] = []

            miner_address = getattr(block, "miner_address", None)
            if miner_address:
                stats = miner_stats.setdefault(
                    miner_address,
                    {
                        "address": miner_address,
                        "blocks_mined": 0,
                        "last_block_index": None,
                        "last_block_hash": None,
                        "last_mined_at": None,
                    },
                )
                stats["blocks_mined"] += 1
                stats["last_block_index"] = block.index
                stats["last_block_hash"] = block.hash
                stats["last_mined_at"] = block.timestamp

            for tx_index, transaction in enumerate(block.transactions or []):
                tx = _coerce_transaction(transaction)
                record = blockchain.safe_transaction_record(
                    tx,
                    status="confirmed",
                    block=block,
                    transaction_index=tx_index,
                )
                transactions_by_id[record["tx_id"]] = record
                transactions_by_block[index_key].append(record)
                _append_address_record(transactions_by_address, record["sender_address"], record)
                _append_address_record(transactions_by_address, record["receiver_address"], record)

                amount = float(record["amount"])
                sender = record["sender_address"]
                receiver = record["receiver_address"]
                if sender == SYSTEM_ADDRESS:
                    total_issued += amount
                else:
                    confirmed_balances[sender] = confirmed_balances.get(sender, 0.0) - amount
                confirmed_balances[receiver] = confirmed_balances.get(receiver, 0.0) + amount

                if sender == TREASURY_ADDRESS or receiver == TREASURY_ADDRESS:
                    treasury_ledger_index.append(record)

        balances_by_address.update(confirmed_balances)

        # The pending overlay is kept in its own small structure rather than
        # mixed into the (chain-length-sized) confirmed address buckets. The
        # reward and treasury transactions are pending in every single block, so
        # their addresses' buckets grow with the chain; if the overlay lived
        # inside those buckets, reconciling it on each block would have to filter
        # and re-sort O(chain length) records — exactly the per-block cost we are
        # eliminating. Keeping it separate makes refresh_pending_overlay O(pending),
        # and transactions_for_address() merges the two at read time.
        pending_tx_ids: set[str] = set()
        pending_addresses: set[str] = set()
        pending_records_by_address: dict[str, list[dict[str, Any]]] = {}
        for pending_index, transaction in enumerate(blockchain.pending_transactions or []):
            tx = _coerce_transaction(transaction)
            record = blockchain.safe_transaction_record(tx, status="pending", transaction_index=pending_index)
            transactions_by_id.setdefault(record["tx_id"], record)
            sender = record["sender_address"]
            receiver = record["receiver_address"]
            if sender:
                pending_records_by_address.setdefault(sender, []).append(record)
            if receiver and receiver != sender:
                pending_records_by_address.setdefault(receiver, []).append(record)
            pending_tx_ids.add(record["tx_id"])
            pending_addresses.add(sender)
            pending_addresses.add(receiver)
            amount = float(record["amount"])
            if sender != SYSTEM_ADDRESS:
                balances_by_address[sender] = balances_by_address.get(sender, 0.0) - amount
            balances_by_address[receiver] = balances_by_address.get(receiver, 0.0) + amount

        for records in transactions_by_address.values():
            records.sort(key=lambda item: float(item.get("timestamp") or 0), reverse=True)
        for records in pending_records_by_address.values():
            records.sort(key=lambda item: float(item.get("timestamp") or 0), reverse=True)
        for records in transactions_by_block.values():
            records.sort(key=lambda item: int(item.get("transaction_index") or 0))
        treasury_ledger_index.sort(key=lambda item: float(item.get("timestamp") or 0), reverse=True)

        latest_block = blockchain.get_latest_block() if blockchain.chain else None
        latest_blocks = [
            blocks_by_index[str(block.index)]
            for block in reversed(blockchain.chain[-LATEST_BLOCK_LIMIT:])
        ]
        chain_summary = {
            "block_height": blockchain.get_block_height(),
            "total_blocks": len(blockchain.chain),
            "total_transactions": sum(len(block.transactions or []) for block in blockchain.chain),
            "total_issued": total_issued,
            "current_difficulty": blockchain.difficulty,
            "current_mining_reward": blockchain.get_current_mining_reward(),
            "last_block_hash": latest_block.hash if latest_block else None,
            "last_block_timestamp": latest_block.timestamp if latest_block else None,
            # Integrity-only: this summarises our own chain, where historical
            # block spacing is grandfathered (enforced at admission, not reload).
            # Memoised per tip so rebuilding the index does not re-run the O(n)
            # full validation on top of the O(n) index build every block.
            "chain_valid": blockchain.chain_valid_fast(),
        }

        indexes = {
            "blocks_by_index": blocks_by_index,
            "blocks_by_hash": blocks_by_hash,
            "transactions_by_id": transactions_by_id,
            "transactions_by_address": transactions_by_address,
            "transactions_by_block": transactions_by_block,
            "balances_by_address": balances_by_address,
            "confirmed_balances_by_address": confirmed_balances,
            "miner_stats": miner_stats,
            "latest_blocks": latest_blocks,
            "treasury_ledger_index": treasury_ledger_index,
            "chain_summary": chain_summary,
        }

        instance = cls(
            schema_version=SCHEMA_VERSION,
            built_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            chain_height=blockchain.get_block_height(),
            latest_block_hash=latest_block.hash if latest_block else None,
            indexes=indexes,
        )
        instance._pending_tx_ids = pending_tx_ids
        instance._pending_addresses = pending_addresses
        instance._pending_records_by_address = pending_records_by_address
        instance.pending_fingerprint = _pending_fingerprint(blockchain.pending_transactions)
        return instance

    @classmethod
    def from_payload(cls, payload: dict[str, Any], blockchain: Any) -> "BlockchainIndexes":
        if not isinstance(payload, dict):
            raise ValueError("index payload must be an object")
        if int(payload.get("schema_version", 0)) != SCHEMA_VERSION:
            raise ValueError("index schema version is not supported")
        indexes = payload.get("indexes")
        if not isinstance(indexes, dict):
            raise ValueError("index payload is missing indexes")

        required = {
            "blocks_by_index",
            "blocks_by_hash",
            "transactions_by_id",
            "transactions_by_address",
            "transactions_by_block",
            "balances_by_address",
            "miner_stats",
            "latest_blocks",
            "chain_summary",
        }
        missing = [name for name in required if name not in indexes]
        if missing:
            raise ValueError(f"index payload is missing {', '.join(missing)}")

        latest_block = blockchain.get_latest_block() if blockchain.chain else None
        chain_height = int(payload.get("chain_height", -1))
        latest_block_hash = payload.get("latest_block_hash")
        if chain_height != blockchain.get_block_height() or latest_block_hash != (latest_block.hash if latest_block else None):
            raise ValueError("index payload does not match current chain")

        instance = cls(
            schema_version=SCHEMA_VERSION,
            built_at=str(payload.get("built_at") or ""),
            chain_height=chain_height,
            latest_block_hash=latest_block_hash,
            indexes=indexes,
        )
        # The persisted snapshot has a pending overlay baked in from save time.
        # Recover which records belong to that overlay so a later refresh can
        # strip them, and rebuild the separate pending-by-address structure.
        # Leave the fingerprint unset so the first get_indexes() reconciles the
        # overlay against the live pending pool.
        for tx_id, record in indexes.get("transactions_by_id", {}).items():
            if isinstance(record, dict) and record.get("status") == "pending":
                instance._pending_tx_ids.add(tx_id)
                sender = record.get("sender_address")
                receiver = record.get("receiver_address")
                if sender:
                    instance._pending_addresses.add(sender)
                    instance._pending_records_by_address.setdefault(sender, []).append(record)
                if receiver:
                    instance._pending_addresses.add(receiver)
                    if receiver != sender:
                        instance._pending_records_by_address.setdefault(receiver, []).append(record)
        # Older snapshots stored pending records inside the confirmed address
        # buckets. Strip them out so the confirmed buckets are confirmed-only and
        # the overlay is the single source of pending records (new snapshots are
        # already written this way). This is a one-time O(records) pass on load.
        transactions_by_address = indexes.get("transactions_by_address")
        if isinstance(transactions_by_address, dict) and instance._pending_tx_ids:
            for address, bucket in list(transactions_by_address.items()):
                if not isinstance(bucket, list):
                    continue
                confirmed_only = [r for r in bucket if r.get("status") != "pending"]
                if len(confirmed_only) != len(bucket):
                    if confirmed_only:
                        transactions_by_address[address] = confirmed_only
                    else:
                        del transactions_by_address[address]
        for records in instance._pending_records_by_address.values():
            records.sort(key=lambda item: float(item.get("timestamp") or 0), reverse=True)
        return instance

    def to_payload(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "built_at": self.built_at,
            "chain_height": self.chain_height,
            "latest_block_hash": self.latest_block_hash,
            "indexes": self.indexes,
        }

    def health(self, blockchain: Any | None = None, *, exists: bool = True, valid: bool | None = None, message: str | None = None) -> dict[str, Any]:
        chain_height = self.chain_height
        latest_block_hash = self.latest_block_hash
        chain_match = True
        if blockchain is not None:
            latest_block = blockchain.get_latest_block() if blockchain.chain else None
            chain_height = blockchain.get_block_height()
            latest_block_hash = latest_block.hash if latest_block else None
            chain_match = self.chain_height == chain_height and self.latest_block_hash == latest_block_hash
        effective_valid = self.valid if valid is None else valid
        status = "ok" if effective_valid and chain_match else "warning" if effective_valid else "error"
        return {
            "success": True,
            "exists": bool(exists),
            "valid": bool(effective_valid),
            "schema_version": self.schema_version,
            "chain_height": self.chain_height,
            "latest_block_hash": self.latest_block_hash,
            "built_at": self.built_at,
            "status": status,
            "rebuild_needed": not (effective_valid and chain_match),
            "index_chain_match": chain_match,
            "message": message or self.message,
        }

    def blocks_page(self, limit: int, offset: int) -> tuple[list[dict[str, Any]], int, bool]:
        blocks = list(self.indexes.get("blocks_by_index", {}).values())
        blocks.sort(key=lambda item: int(item.get("index", 0)), reverse=True)
        total = len(blocks)
        return blocks[offset : offset + limit], total, offset + limit < total

    def block_detail(self, index_or_hash: str) -> dict[str, Any] | None:
        term = str(index_or_hash).strip()
        by_index = self.indexes.get("blocks_by_index", {})
        by_hash = self.indexes.get("blocks_by_hash", {})
        if term.isdigit() and term in by_index:
            return by_index[term]
        return by_hash.get(term)

    def transaction_detail(self, tx_id: str) -> dict[str, Any] | None:
        return self.indexes.get("transactions_by_id", {}).get(tx_id)

    def transactions_for_address(self, address: str) -> list[dict[str, Any]]:
        # Pending records are held separately so overlay reconciliation stays
        # O(pending); merge them in front of the confirmed bucket (both are kept
        # in descending-timestamp order, and pending are the newest).
        pending = self._pending_records_by_address.get(address)
        confirmed = self.indexes.get("transactions_by_address", {}).get(address, [])
        if not pending:
            return list(confirmed)
        return list(pending) + list(confirmed)

    def balance(self, address: str) -> float:
        return float(self.indexes.get("balances_by_address", {}).get(address, 0.0))

    def confirmed_balance(self, address: str) -> float:
        return float(self.indexes.get("confirmed_balances_by_address", {}).get(address, 0.0))

    def add_block(self, blockchain: Any, block: Any) -> None:
        """Merge a single newly-appended confirmed block into the existing
        indexes in O(block) time instead of rebuilding from the whole chain.

        This maintains the confirmed core only — blocks, confirmed balances,
        confirmed transaction records, miner stats, the treasury ledger, the
        latest-blocks window, and the running summary totals. The pending
        overlay is reconciled separately in refresh_pending_overlay(), because
        the pending pool changes far more often than the chain and re-deriving
        it is already cheap. The per-block work here mirrors build() exactly so
        the incrementally maintained index is byte-for-byte equivalent to a full
        rebuild — this is balance-bearing code and the two paths must agree."""
        idx = self.indexes
        blocks_by_index = idx["blocks_by_index"]
        blocks_by_hash = idx["blocks_by_hash"]
        transactions_by_id = idx["transactions_by_id"]
        transactions_by_address = idx["transactions_by_address"]
        transactions_by_block = idx["transactions_by_block"]
        confirmed_balances = idx["confirmed_balances_by_address"]
        miner_stats = idx["miner_stats"]
        treasury_ledger = idx["treasury_ledger_index"]
        latest_blocks = idx["latest_blocks"]
        chain_summary = idx["chain_summary"]

        block_record = blockchain.safe_block_record(block, include_transactions=True)
        index_key = str(block.index)
        hash_key = str(block.hash)
        blocks_by_index[index_key] = block_record
        blocks_by_hash[hash_key] = block_record
        block_bucket = transactions_by_block.setdefault(index_key, [])

        miner_address = getattr(block, "miner_address", None)
        if miner_address:
            stats = miner_stats.setdefault(
                miner_address,
                {
                    "address": miner_address,
                    "blocks_mined": 0,
                    "last_block_index": None,
                    "last_block_hash": None,
                    "last_mined_at": None,
                },
            )
            stats["blocks_mined"] += 1
            stats["last_block_index"] = block.index
            stats["last_block_hash"] = block.hash
            stats["last_mined_at"] = block.timestamp

        issued_delta = 0.0
        new_treasury_records: list[dict[str, Any]] = []
        # Collect this block's records per address so we can prepend them to the
        # address buckets in one shot. The block is the chain tip, so its records
        # are the newest in the chain; build() keeps each address bucket sorted
        # descending by timestamp, so the correct, build-identical placement is
        # the front of the bucket. Prepending (an O(len) memmove) instead of
        # re-sorting the whole bucket (O(len log len) with a per-element key
        # call) is what keeps per-block work flat as buckets grow without bound —
        # the treasury and miner addresses appear in every block, so their
        # buckets are O(chain length).
        new_address_records: dict[str, list[dict[str, Any]]] = {}
        for tx_index, transaction in enumerate(block.transactions or []):
            tx = _coerce_transaction(transaction)
            record = blockchain.safe_transaction_record(
                tx,
                status="confirmed",
                block=block,
                transaction_index=tx_index,
            )
            transactions_by_id[record["tx_id"]] = record
            block_bucket.append(record)
            sender = record["sender_address"]
            receiver = record["receiver_address"]
            if sender:
                new_address_records.setdefault(sender, []).append(record)
            if receiver and receiver != sender:
                new_address_records.setdefault(receiver, []).append(record)

            amount = float(record["amount"])
            if sender == SYSTEM_ADDRESS:
                issued_delta += amount
            else:
                confirmed_balances[sender] = confirmed_balances.get(sender, 0.0) - amount
            confirmed_balances[receiver] = confirmed_balances.get(receiver, 0.0) + amount

            if sender == TREASURY_ADDRESS or receiver == TREASURY_ADDRESS:
                new_treasury_records.append(record)

        # block_bucket was appended in tx order already, so it is sorted.
        # Prepend each address's new records (kept in ascending tx order, which
        # is how build()'s stable sort orders records sharing this block's
        # timestamp) to the front of the existing descending bucket.
        for address, records in new_address_records.items():
            bucket = transactions_by_address.get(address)
            if bucket:
                bucket[:0] = records
            else:
                transactions_by_address[address] = list(records)
        # The new block's treasury records are the newest; prepend them to keep
        # the ledger descending without re-sorting the whole ledger.
        if new_treasury_records:
            treasury_ledger[:0] = new_treasury_records

        latest_blocks.insert(0, block_record)
        if len(latest_blocks) > LATEST_BLOCK_LIMIT:
            del latest_blocks[LATEST_BLOCK_LIMIT:]

        chain_summary["total_issued"] = float(chain_summary.get("total_issued", 0.0)) + issued_delta
        chain_summary["block_height"] = blockchain.get_block_height()
        chain_summary["total_blocks"] = len(blockchain.chain)
        chain_summary["total_transactions"] = int(chain_summary.get("total_transactions", 0)) + len(block.transactions or [])
        chain_summary["current_difficulty"] = blockchain.difficulty
        chain_summary["current_mining_reward"] = blockchain.get_current_mining_reward()
        chain_summary["last_block_hash"] = block.hash
        chain_summary["last_block_timestamp"] = block.timestamp
        chain_summary["chain_valid"] = blockchain.chain_valid_fast()

        self.chain_height = blockchain.get_block_height()
        self.latest_block_hash = block.hash
        self.built_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        # This block changed confirmed balances but balances_by_address (which
        # also folds in the pending overlay) is only rebuilt by
        # refresh_pending_overlay. Invalidate the fingerprint so the next
        # get_indexes() is guaranteed to run that O(pending) refresh and fold the
        # new confirmed balances in, even in the rare case where the pending pool
        # is unchanged across the block.
        self.pending_fingerprint = None

    def refresh_pending_overlay(self, blockchain: Any) -> None:
        """Re-derive the pending overlay on top of the (incrementally
        maintained) confirmed core in O(pending) time.

        The overlay lives in its own small structures (a pending-by-address map,
        pending entries in transactions_by_id keyed by the tracked tx_ids, and a
        balances_by_address dict that is confirmed balances plus the live pending
        deltas). None of this work touches the chain-length-sized confirmed
        address buckets, so the cost is bounded by the size of the pending pool,
        not the chain. The send/spend path validates against the chain directly,
        never against this overlay, so a brief staleness here is a display
        concern only — but we keep it exact."""
        idx = self.indexes
        transactions_by_id = idx["transactions_by_id"]
        confirmed_balances = idx["confirmed_balances_by_address"]

        # 1. Remove the previous overlay's own additions to transactions_by_id
        #    (only the tracked pending tx_ids — never a confirmed record).
        for tx_id in self._pending_tx_ids:
            record = transactions_by_id.get(tx_id)
            if record is not None and record.get("status") == "pending":
                del transactions_by_id[tx_id]

        # 2. Rebuild the small pending-by-address map and recompute balances from
        #    the confirmed core plus the current pending deltas.
        balances = dict(confirmed_balances)
        new_pending_tx_ids: set[str] = set()
        new_pending_addresses: set[str] = set()
        pending_records_by_address: dict[str, list[dict[str, Any]]] = {}
        for pending_index, transaction in enumerate(blockchain.pending_transactions or []):
            tx = _coerce_transaction(transaction)
            record = blockchain.safe_transaction_record(tx, status="pending", transaction_index=pending_index)
            transactions_by_id.setdefault(record["tx_id"], record)
            sender = record["sender_address"]
            receiver = record["receiver_address"]
            if sender:
                pending_records_by_address.setdefault(sender, []).append(record)
            if receiver and receiver != sender:
                pending_records_by_address.setdefault(receiver, []).append(record)
            new_pending_tx_ids.add(record["tx_id"])
            new_pending_addresses.add(sender)
            new_pending_addresses.add(receiver)
            amount = float(record["amount"])
            if sender != SYSTEM_ADDRESS:
                balances[sender] = balances.get(sender, 0.0) - amount
            balances[receiver] = balances.get(receiver, 0.0) + amount

        for records in pending_records_by_address.values():
            records.sort(key=lambda item: float(item.get("timestamp") or 0), reverse=True)

        idx["balances_by_address"] = balances
        self._pending_records_by_address = pending_records_by_address
        self._pending_tx_ids = new_pending_tx_ids
        self._pending_addresses = new_pending_addresses
        self.pending_fingerprint = _pending_fingerprint(blockchain.pending_transactions)


def _pending_fingerprint(pending_transactions: Any) -> tuple[int, tuple[str, ...]]:
    """A cheap identity of the pending pool used to detect when the overlay is
    stale. Order-sensitive on tx_id; the pool is small so this is O(pending)."""
    ids: list[str] = []
    for transaction in pending_transactions or []:
        if isinstance(transaction, dict):
            ids.append(str(transaction.get("tx_id") or transaction.get("transaction_id") or ""))
        else:
            ids.append(str(getattr(transaction, "tx_id", "") or ""))
    return (len(ids), tuple(ids))


def _coerce_transaction(transaction: Any) -> Transaction:
    if isinstance(transaction, Transaction):
        return transaction
    if isinstance(transaction, dict):
        return Transaction.from_dict(transaction)
    raise ValueError("invalid transaction")


def _append_address_record(index: dict[str, list[dict[str, Any]]], address: str, record: dict[str, Any]) -> None:
    if not address:
        return
    bucket = index.setdefault(address, [])
    if not any(item.get("tx_id") == record.get("tx_id") and item.get("status") == record.get("status") for item in bucket):
        bucket.append(record)
