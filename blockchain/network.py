from __future__ import annotations

from typing import Any
from urllib.parse import urlparse

import requests

from block import Block
from blockchain import Blockchain


class Network:
    def __init__(self) -> None:
        self.peers: set[str] = set()

    def register_peer(self, peer_url: str) -> bool:
        normalized_peer = self._normalize_peer_url(peer_url)
        if normalized_peer in self.peers:
            return False
        self.peers.add(normalized_peer)
        return True

    def remove_peer(self, peer_url: str) -> bool:
        normalized_peer = self._normalize_peer_url(peer_url)
        if normalized_peer in self.peers:
            self.peers.remove(normalized_peer)
            return True
        return False

    def get_peers(self) -> list[str]:
        return sorted(self.peers)

    def broadcast_transaction(self, transaction: dict[str, Any]) -> None:
        for peer in self.get_peers():
            try:
                requests.post(f"{peer}/transaction", json=transaction, timeout=5)
            except requests.RequestException as exc:
                print(f"Warning: failed to broadcast transaction to {peer}: {exc}")

    def broadcast_block(self, block: dict[str, Any]) -> None:
        for peer in self.get_peers():
            try:
                requests.post(f"{peer}/receive_block", json=block, timeout=5)
            except requests.RequestException as exc:
                print(f"Warning: failed to broadcast block to {peer}: {exc}")

    def sync_chain(self, local_blockchain: Blockchain) -> bool:
        best_chain = local_blockchain.chain

        for peer in self.get_peers():
            try:
                response = requests.get(f"{peer}/chain", timeout=6)
                response.raise_for_status()
                peer_chain_data = response.json().get("chain", [])
                peer_chain = [Block.from_dict(block_data) for block_data in peer_chain_data]
            except (requests.RequestException, ValueError, KeyError, TypeError) as exc:
                print(f"Warning: failed to sync chain from {peer}: {exc}")
                continue

            if len(peer_chain) > len(best_chain) and self._is_valid_chain(peer_chain, local_blockchain):
                best_chain = peer_chain

        if len(best_chain) > len(local_blockchain.chain):
            local_blockchain.chain = best_chain
            return True

        return False

    def discover_peers(self, current_peers: list[str] | None = None) -> list[str]:
        if current_peers:
            for peer in current_peers:
                try:
                    self.register_peer(peer)
                except ValueError as exc:
                    print(f"Warning: skipped invalid peer {peer}: {exc}")

        for peer in list(self.peers):
            try:
                response = requests.get(f"{peer}/peers", timeout=5)
                response.raise_for_status()
                discovered_peers = response.json().get("peers", [])
            except (requests.RequestException, ValueError, TypeError) as exc:
                print(f"Warning: failed to discover peers from {peer}: {exc}")
                continue

            for discovered_peer in discovered_peers:
                try:
                    self.register_peer(discovered_peer)
                except ValueError as exc:
                    print(f"Warning: skipped invalid discovered peer {discovered_peer}: {exc}")

        return self.get_peers()

    def _normalize_peer_url(self, peer_url: str) -> str:
        if not isinstance(peer_url, str) or not peer_url.strip():
            raise ValueError("peer must be a non-empty URL string")

        peer_url = peer_url.strip().rstrip("/")
        parsed = urlparse(peer_url)

        if parsed.scheme not in {"http", "https"}:
            raise ValueError("peer URL must start with http:// or https://")

        if not parsed.hostname or not parsed.port:
            raise ValueError("peer URL must include a host and port")

        return f"{parsed.scheme}://{parsed.hostname}:{parsed.port}"

    def _is_valid_chain(self, chain: list[Block], blockchain_rules: Blockchain) -> bool:
        if not chain:
            return False

        for index, block in enumerate(chain):
            if block.hash != block.calculate_hash():
                return False

            if not block.hash.startswith("0" * blockchain_rules.difficulty):
                return False

            if not blockchain_rules._all_transactions_are_valid(block.transactions):
                return False

            if index == 0:
                if block.previous_hash != "0":
                    return False
            else:
                previous_block = chain[index - 1]
                if block.previous_hash != previous_block.hash:
                    return False

        return True
