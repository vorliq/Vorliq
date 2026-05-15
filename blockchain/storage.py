from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from block import Block
from blockchain import Blockchain
from exchange import Exchange
from forum import Forum
from governance import Governance
from lending import LendingPool
from logger import vorliq_logger
from price import PriceDiscovery
from registry import NodeRegistry
from transaction import Transaction
from treasury import Treasury


class Storage:
    def __init__(self, data_dir: str | Path | None = None) -> None:
        self.data_dir = Path(data_dir) if data_dir else Path(__file__).resolve().parent / "data"
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.chain_file = self.data_dir / "chain.json"
        self.pending_file = self.data_dir / "pending.json"
        self.lending_file = self.data_dir / "lending.json"
        self.exchange_file = self.data_dir / "exchange.json"
        self.forum_file = self.data_dir / "forum.json"
        self.governance_file = self.data_dir / "governance.json"
        self.treasury_file = self.data_dir / "treasury.json"
        self.price_file = self.data_dir / "price.json"
        self.peers_file = self.data_dir / "peers.json"
        self.registry_file = self.data_dir / "registry.json"

    def save_chain(self, blockchain: Blockchain) -> None:
        chain_data = {
            "coin": "VLQ",
            "difficulty": blockchain.difficulty,
            "mining_reward": getattr(blockchain, "mining_reward", blockchain.initial_mining_reward),
            "initial_mining_reward": blockchain.initial_mining_reward,
            "maximum_supply": blockchain.maximum_supply,
            "halving_interval": blockchain.halving_interval,
            "chain": [block.to_dict() for block in blockchain.chain],
        }
        self._write_json(self.chain_file, chain_data)
        vorliq_logger.info("Saved blockchain to disk with %s blocks", len(blockchain.chain))

    def load_chain(self) -> Blockchain | None:
        if not self.chain_file.exists():
            vorliq_logger.info("No saved blockchain found on disk")
            return None

        data = self._read_json(self.chain_file)
        blocks = [self._block_from_dict(block_data) for block_data in data.get("chain", [])]

        if not blocks:
            return None

        blockchain = Blockchain()
        blockchain.chain = blocks
        blockchain.difficulty = int(data.get("difficulty", blockchain.difficulty))
        blockchain.proof_target = "0" * blockchain.difficulty
        saved_reward = float(
            data.get("mining_reward", data.get("initial_mining_reward", blockchain.initial_mining_reward))
        )
        blockchain.mining_reward = saved_reward
        blockchain.initial_mining_reward = saved_reward

        if not blockchain.is_chain_valid():
            raise ValueError("saved blockchain data is not valid")

        vorliq_logger.info("Loaded blockchain from disk with %s blocks", len(blockchain.chain))
        return blockchain

    def save_pending(self, pending_transactions: list[Any]) -> None:
        pending_data = [self._transaction_to_dict(transaction) for transaction in pending_transactions]
        self._write_json(self.pending_file, pending_data)
        vorliq_logger.info("Saved %s pending transactions to disk", len(pending_data))

    def load_pending(self) -> list[dict[str, Any]]:
        if not self.pending_file.exists():
            vorliq_logger.info("No saved pending transactions found on disk")
            return []

        data = self._read_json(self.pending_file)
        if not isinstance(data, list):
            raise ValueError("pending transaction data must be a list")

        pending = [self._transaction_to_dict(transaction) for transaction in data]
        vorliq_logger.info("Loaded %s pending transactions from disk", len(pending))
        return pending

    def save_lending_pool(self, lending_pool: LendingPool) -> None:
        lending_data = {
            "loan_requests": lending_pool.loan_requests,
        }
        self._write_json(self.lending_file, lending_data)
        vorliq_logger.info("Saved lending pool with %s loan records", len(lending_pool.loan_requests))

    def load_lending_pool(self) -> LendingPool:
        lending_pool = LendingPool()

        if not self.lending_file.exists():
            vorliq_logger.info("No saved lending pool found on disk")
            return lending_pool

        data = self._read_json(self.lending_file)
        loan_requests = data.get("loan_requests", {})

        if not isinstance(loan_requests, dict):
            raise ValueError("lending pool data must contain a loan_requests object")

        lending_pool.loan_requests = loan_requests
        vorliq_logger.info("Loaded lending pool with %s loan records", len(loan_requests))
        return lending_pool

    def save_exchange(self, exchange: Exchange) -> None:
        self._write_json(self.exchange_file, {"offers": exchange.offers})
        vorliq_logger.info("Saved exchange with %s offer records", len(exchange.offers))

    def load_exchange(self) -> Exchange:
        exchange = Exchange()

        if not self.exchange_file.exists():
            vorliq_logger.info("No saved exchange found on disk")
            return exchange

        data = self._read_json(self.exchange_file)
        offers = data.get("offers", {})

        if not isinstance(offers, dict):
            raise ValueError("exchange data must contain an offers object")

        exchange.offers = offers
        vorliq_logger.info("Loaded exchange with %s offer records", len(offers))
        return exchange

    def save_forum(self, forum: Forum) -> None:
        self._write_json(self.forum_file, {"posts": forum.posts})
        vorliq_logger.info("Saved forum with %s post records", len(forum.posts))

    def load_forum(self) -> Forum:
        forum = Forum()

        if not self.forum_file.exists():
            vorliq_logger.info("No saved forum found on disk")
            return forum

        data = self._read_json(self.forum_file)
        posts = data.get("posts", {})

        if not isinstance(posts, dict):
            raise ValueError("forum data must contain a posts object")

        forum.posts = posts
        vorliq_logger.info("Loaded forum with %s post records", len(posts))
        return forum

    def save_governance(self, governance: Governance) -> None:
        self._write_json(
            self.governance_file,
            {
                "proposals": governance.proposals,
                "governance_settings": governance.governance_settings,
            },
        )
        vorliq_logger.info("Saved governance with %s proposal records", len(governance.proposals))

    def load_governance(self) -> Governance:
        governance = Governance()

        if not self.governance_file.exists():
            vorliq_logger.info("No saved governance found on disk")
            return governance

        data = self._read_json(self.governance_file)
        proposals = data.get("proposals", {})
        settings = data.get("governance_settings", {})

        if not isinstance(proposals, dict):
            raise ValueError("governance data must contain a proposals object")
        if settings and not isinstance(settings, dict):
            raise ValueError("governance settings data must be an object")

        governance.proposals = proposals
        governance.governance_settings.update(settings)
        vorliq_logger.info("Loaded governance with %s proposal records", len(proposals))
        return governance

    def save_treasury(self, treasury: Treasury) -> None:
        self._write_json(self.treasury_file, {"proposals": treasury.proposals})
        vorliq_logger.info("Saved treasury with %s proposal records", len(treasury.proposals))

    def load_treasury(self) -> Treasury:
        treasury = Treasury()
        if not self.treasury_file.exists():
            vorliq_logger.info("No saved treasury found on disk")
            return treasury

        data = self._read_json(self.treasury_file)
        proposals = data.get("proposals", {})
        if not isinstance(proposals, dict):
            raise ValueError("treasury data must contain a proposals object")
        treasury.proposals = proposals
        vorliq_logger.info("Loaded treasury with %s proposal records", len(proposals))
        return treasury

    def save_price_discovery(self, price_discovery: PriceDiscovery) -> None:
        self._write_json(self.price_file, {"signals": price_discovery.signals})
        vorliq_logger.info("Saved price discovery with %s signal records", len(price_discovery.signals))

    def load_price_discovery(self) -> PriceDiscovery:
        price_discovery = PriceDiscovery()
        if not self.price_file.exists():
            vorliq_logger.info("No saved price discovery found on disk")
            return price_discovery

        data = self._read_json(self.price_file)
        signals = data.get("signals", {})
        if not isinstance(signals, dict):
            raise ValueError("price discovery data must contain a signals object")
        price_discovery.signals = signals
        price_discovery.expire_old_signals()
        vorliq_logger.info("Loaded price discovery with %s signal records", len(price_discovery.signals))
        return price_discovery

    def save_peers(self, peer_urls: set[str]) -> None:
        self._write_json(self.peers_file, sorted(peer_urls))
        vorliq_logger.info("Saved %s peer records to disk", len(peer_urls))

    def load_peers(self) -> set[str]:
        if not self.peers_file.exists():
            vorliq_logger.info("No saved peer list found on disk")
            return set()

        data = self._read_json(self.peers_file)
        if not isinstance(data, list):
            raise ValueError("peer data must be a list")

        peers = {str(peer) for peer in data}
        vorliq_logger.info("Loaded %s peer records from disk", len(peers))
        return peers

    def save_registry(self, registry: NodeRegistry) -> None:
        self._write_json(self.registry_file, {"registered_nodes": registry.registered_nodes})
        vorliq_logger.info("Saved node registry with %s records", len(registry.registered_nodes))

    def load_registry(self) -> NodeRegistry:
        registry = NodeRegistry()

        if not self.registry_file.exists():
            vorliq_logger.info("No saved node registry found on disk")
            return registry

        data = self._read_json(self.registry_file)
        registered_nodes = data.get("registered_nodes", {})

        if not isinstance(registered_nodes, dict):
            raise ValueError("registry data must contain a registered_nodes object")

        registry.registered_nodes = registered_nodes
        vorliq_logger.info("Loaded node registry with %s records", len(registered_nodes))
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
