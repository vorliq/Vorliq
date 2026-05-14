from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from block import Block
from blockchain import Blockchain
from lending import LendingPool
from registry import NodeRegistry
from transaction import Transaction


class Storage:
    def __init__(self, data_dir: str | Path | None = None) -> None:
        self.data_dir = Path(data_dir) if data_dir else Path(__file__).resolve().parent / "data"
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.chain_file = self.data_dir / "chain.json"
        self.pending_file = self.data_dir / "pending.json"
        self.lending_file = self.data_dir / "lending.json"
        self.peers_file = self.data_dir / "peers.json"
        self.registry_file = self.data_dir / "registry.json"

    def save_chain(self, blockchain: Blockchain) -> None:
        chain_data = {
            "coin": "VLQ",
            "difficulty": blockchain.difficulty,
            "maximum_supply": blockchain.maximum_supply,
            "halving_interval": blockchain.halving_interval,
            "chain": [block.to_dict() for block in blockchain.chain],
        }
        self._write_json(self.chain_file, chain_data)

    def load_chain(self) -> Blockchain | None:
        if not self.chain_file.exists():
            return None

        data = self._read_json(self.chain_file)
        blocks = [self._block_from_dict(block_data) for block_data in data.get("chain", [])]

        if not blocks:
            return None

        blockchain = Blockchain()
        blockchain.chain = blocks

        if not blockchain.is_chain_valid():
            raise ValueError("saved blockchain data is not valid")

        return blockchain

    def save_pending(self, pending_transactions: list[Any]) -> None:
        pending_data = [self._transaction_to_dict(transaction) for transaction in pending_transactions]
        self._write_json(self.pending_file, pending_data)

    def load_pending(self) -> list[dict[str, Any]]:
        if not self.pending_file.exists():
            return []

        data = self._read_json(self.pending_file)
        if not isinstance(data, list):
            raise ValueError("pending transaction data must be a list")

        return [self._transaction_to_dict(transaction) for transaction in data]

    def save_lending_pool(self, lending_pool: LendingPool) -> None:
        lending_data = {
            "loan_requests": lending_pool.loan_requests,
        }
        self._write_json(self.lending_file, lending_data)

    def load_lending_pool(self) -> LendingPool:
        lending_pool = LendingPool()

        if not self.lending_file.exists():
            return lending_pool

        data = self._read_json(self.lending_file)
        loan_requests = data.get("loan_requests", {})

        if not isinstance(loan_requests, dict):
            raise ValueError("lending pool data must contain a loan_requests object")

        lending_pool.loan_requests = loan_requests
        return lending_pool

    def save_peers(self, peer_urls: set[str]) -> None:
        self._write_json(self.peers_file, sorted(peer_urls))

    def load_peers(self) -> set[str]:
        if not self.peers_file.exists():
            return set()

        data = self._read_json(self.peers_file)
        if not isinstance(data, list):
            raise ValueError("peer data must be a list")

        return {str(peer) for peer in data}

    def save_registry(self, registry: NodeRegistry) -> None:
        self._write_json(self.registry_file, {"registered_nodes": registry.registered_nodes})

    def load_registry(self) -> NodeRegistry:
        registry = NodeRegistry()

        if not self.registry_file.exists():
            return registry

        data = self._read_json(self.registry_file)
        registered_nodes = data.get("registered_nodes", {})

        if not isinstance(registered_nodes, dict):
            raise ValueError("registry data must contain a registered_nodes object")

        registry.registered_nodes = registered_nodes
        return registry

    def _write_json(self, path: Path, data: Any) -> None:
        path.write_text(json.dumps(data, indent=2, sort_keys=True), encoding="utf-8")

    def _read_json(self, path: Path) -> Any:
        return json.loads(path.read_text(encoding="utf-8"))

    def _block_from_dict(self, data: dict[str, Any]) -> Block:
        block = Block.from_dict(data)
        block.transactions = [
            Transaction.from_dict(transaction) if isinstance(transaction, dict) else transaction
            for transaction in block.transactions
        ]
        return block

    def _transaction_to_dict(self, transaction: Any) -> dict[str, Any]:
        if isinstance(transaction, Transaction):
            return transaction.to_dict()
        if isinstance(transaction, dict):
            return Transaction.from_dict(transaction).to_dict()
        raise TypeError(f"Unsupported transaction type: {type(transaction)!r}")
