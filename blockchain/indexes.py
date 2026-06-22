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

    @classmethod
    def build(cls, blockchain: Any) -> "BlockchainIndexes":
        blocks_by_index: dict[str, dict[str, Any]] = {}
        blocks_by_hash: dict[str, dict[str, Any]] = {}
        transactions_by_id: dict[str, dict[str, Any]] = {}
        transactions_by_address: dict[str, list[dict[str, Any]]] = {}
        transactions_by_block: dict[str, list[dict[str, Any]]] = {}
        confirmed_balances: dict[str, float] = {}
        balances_by_address: dict[str, float] = {}
        miner_stats: dict[str, dict[str, Any]] = {}
        treasury_ledger_index: list[dict[str, Any]] = []
        total_issued = 0.0

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

        for pending_index, transaction in enumerate(blockchain.pending_transactions or []):
            tx = _coerce_transaction(transaction)
            record = blockchain.safe_transaction_record(tx, status="pending", transaction_index=pending_index)
            transactions_by_id.setdefault(record["tx_id"], record)
            _append_address_record(transactions_by_address, record["sender_address"], record)
            _append_address_record(transactions_by_address, record["receiver_address"], record)
            amount = float(record["amount"])
            if record["sender_address"] != SYSTEM_ADDRESS:
                balances_by_address[record["sender_address"]] = balances_by_address.get(record["sender_address"], 0.0) - amount
            balances_by_address[record["receiver_address"]] = balances_by_address.get(record["receiver_address"], 0.0) + amount

        for records in transactions_by_address.values():
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
            "chain_valid": blockchain.is_chain_valid(enforce_block_spacing=False),
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

        return cls(
            schema_version=SCHEMA_VERSION,
            built_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            chain_height=blockchain.get_block_height(),
            latest_block_hash=latest_block.hash if latest_block else None,
            indexes=indexes,
        )

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

        return cls(
            schema_version=SCHEMA_VERSION,
            built_at=str(payload.get("built_at") or ""),
            chain_height=chain_height,
            latest_block_hash=latest_block_hash,
            indexes=indexes,
        )

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
        return list(self.indexes.get("transactions_by_address", {}).get(address, []))

    def balance(self, address: str) -> float:
        return float(self.indexes.get("balances_by_address", {}).get(address, 0.0))

    def confirmed_balance(self, address: str) -> float:
        return float(self.indexes.get("confirmed_balances_by_address", {}).get(address, 0.0))


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
