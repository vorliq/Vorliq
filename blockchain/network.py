from __future__ import annotations

import copy
from typing import Any
from urllib.parse import urlparse

import requests

from block import Block
from blockchain import Blockchain
from logger import vorliq_logger


class Network:
    def __init__(self) -> None:
        self.peers: set[str] = set()

    def register_peer(self, peer_url: str) -> bool:
        normalized_peer = self._normalize_peer_url(peer_url)
        if normalized_peer in self.peers:
            vorliq_logger.info("Peer already registered: %s", normalized_peer)
            return False
        self.peers.add(normalized_peer)
        vorliq_logger.info("Peer registered: %s", normalized_peer)
        return True

    def remove_peer(self, peer_url: str) -> bool:
        normalized_peer = self._normalize_peer_url(peer_url)
        if normalized_peer in self.peers:
            self.peers.remove(normalized_peer)
            vorliq_logger.info("Peer removed: %s", normalized_peer)
            return True
        vorliq_logger.info("Peer removal skipped because peer was not known: %s", normalized_peer)
        return False

    def get_peers(self) -> list[str]:
        return sorted(self.peers)

    def broadcast_transaction(self, transaction: dict[str, Any]) -> None:
        for peer in self.get_peers():
            try:
                response = requests.post(f"{peer}/transaction", json=transaction, timeout=5)
                response.raise_for_status()
                vorliq_logger.info("Transaction broadcast succeeded to %s", peer)
            except requests.RequestException as exc:
                vorliq_logger.warning("Transaction broadcast failed to %s: %s", peer, exc)

    def broadcast_block(self, block: dict[str, Any]) -> None:
        for peer in self.get_peers():
            try:
                response = requests.post(f"{peer}/api/peer/block", json={"block": block}, timeout=5)
                response.raise_for_status()
                vorliq_logger.info("Block broadcast succeeded to %s", peer)
            except requests.RequestException as exc:
                vorliq_logger.warning("Block broadcast failed to %s: %s", peer, exc)

    def sync_chain(self, local_blockchain: Blockchain) -> bool:
        best_chain = local_blockchain.chain
        # Compare by HEIGHT (the tip block's index), not list length: a pruned node
        # retains only its most recent N blocks, so its list is short while its
        # height is large. Length comparison would let a peer with more *blocks*
        # but a lower *height* wrongly replace a pruned node's chain.
        best_height = local_blockchain.get_block_height()
        local_prune_point = getattr(local_blockchain, "prune_point", None)

        for peer in self.get_peers():
            try:
                response = requests.get(f"{peer}/chain", timeout=6)
                response.raise_for_status()
                peer_chain_data = response.json().get("chain", [])
                peer_chain = [Block.from_dict(block_data) for block_data in peer_chain_data]
            except (requests.RequestException, ValueError, KeyError, TypeError) as exc:
                vorliq_logger.warning("Failed to sync chain from %s: %s", peer, exc)
                continue

            if not peer_chain:
                continue
            peer_height = peer_chain[-1].index
            if peer_height <= best_height:
                continue

            if not self._is_valid_chain(peer_chain, local_blockchain):
                vorliq_logger.warning(
                    "Rejected longer chain from %s because it failed full hash, link, proof, or balance validation",
                    peer,
                )
                continue

            # If THIS node is pruned, a longer offered chain may only be adopted
            # when it reconciles with our prune-point commitment — i.e. its history
            # reaches exactly the state we committed to at the prune height. A chain
            # that rewrote our pruned history is rejected even though it is longer
            # and internally valid, so a fork can never erase committed history.
            if local_prune_point and not local_blockchain.offered_chain_matches_prune_point(peer_chain):
                vorliq_logger.warning(
                    "Rejected longer chain from %s because it contradicts our prune-point commitment at height %s",
                    peer,
                    local_prune_point.get("height"),
                )
                continue

            best_chain = peer_chain
            best_height = peer_height
            vorliq_logger.info(
                "Longer valid chain found from %s reaching height %s (%s blocks)", peer, peer_height, len(peer_chain)
            )

        if best_height > local_blockchain.get_block_height():
            local_blockchain.chain = best_chain
            # We adopted a genesis-rooted full chain (the only kind _is_valid_chain
            # accepts), so this node now holds the complete history and is no longer
            # pruned — drop the prune point and the derived caches so reads rebuild
            # against the adopted chain.
            local_blockchain.prune_point = None
            local_blockchain._indexes = None
            local_blockchain._valid_cache = None
            local_blockchain._valid_cache_height = -1
            local_blockchain._valid_cache_tip = None
            local_blockchain.pending_transactions = self._filter_pending_after_chain_update(local_blockchain)
            local_blockchain.prune_pending_transactions(drop_system_rewards=True)
            vorliq_logger.info("Local chain updated to longer network chain reaching height %s", best_height)
            return True

        vorliq_logger.info("Chain sync complete; local chain is already longest")
        return False

    def check_peer_statuses(self) -> dict[str, bool]:
        statuses = {}

        for peer in self.get_peers():
            try:
                response = requests.get(f"{peer}/health", timeout=4)
                statuses[peer] = response.ok
            except requests.RequestException:
                statuses[peer] = False
                vorliq_logger.warning("Peer health check failed for %s", peer)

        return statuses

    def discover_peers(self, current_peers: list[str] | None = None) -> list[str]:
        if current_peers:
            for peer in current_peers:
                try:
                    self.register_peer(peer)
                except ValueError as exc:
                    vorliq_logger.warning("Skipped invalid peer %s: %s", peer, exc)

        for peer in list(self.peers):
            try:
                response = requests.get(f"{peer}/peers", timeout=5)
                response.raise_for_status()
                discovered_peers = response.json().get("peers", [])
            except (requests.RequestException, ValueError, TypeError) as exc:
                vorliq_logger.warning("Failed to discover peers from %s: %s", peer, exc)
                continue

            for discovered_peer in discovered_peers:
                try:
                    self.register_peer(discovered_peer)
                except ValueError as exc:
                    vorliq_logger.warning("Skipped invalid discovered peer %s: %s", discovered_peer, exc)

        return self.get_peers()

    def announce_to_peers(self, local_node_url: str, current_peers: list[str] | set[str]) -> None:
        normalized_local_url = self._normalize_peer_url(local_node_url)

        for peer in current_peers:
            try:
                normalized_peer = self._normalize_peer_url(peer)
            except ValueError as exc:
                vorliq_logger.warning("Skipped invalid announcement peer %s: %s", peer, exc)
                continue

            if normalized_peer == normalized_local_url:
                continue

            try:
                requests.post(
                    f"{normalized_peer}/peers/register",
                    json={"peer": normalized_local_url, "_announced": True},
                    timeout=5,
                )
                vorliq_logger.info("Announced local node %s to peer %s", normalized_local_url, normalized_peer)
            except requests.RequestException as exc:
                vorliq_logger.warning("Failed to announce local node to %s: %s", normalized_peer, exc)

    def _normalize_peer_url(self, peer_url: str) -> str:
        if not isinstance(peer_url, str) or not peer_url.strip():
            raise ValueError("peer must be a non-empty URL string")

        peer_url = peer_url.strip().rstrip("/")
        parsed = urlparse(peer_url)

        if parsed.scheme not in {"http", "https"}:
            raise ValueError("peer URL must start with http:// or https://")

        if not parsed.hostname:
            raise ValueError("peer URL must include a host")

        netloc = parsed.hostname
        if parsed.port:
            netloc = f"{netloc}:{parsed.port}"
        return f"{parsed.scheme}://{netloc}"

    def _is_valid_chain(self, chain: list[Block], blockchain_rules: Blockchain) -> bool:
        if not chain:
            return False
        if chain[0].previous_hash != "0":
            return False

        candidate = copy.copy(blockchain_rules)
        candidate.chain = chain
        candidate.pending_transactions = []
        candidate._indexes = None
        # The offered chain is genesis-rooted and self-contained, so it must be
        # validated on its own terms. Crucially, clear any prune point inherited
        # from the local node via the shallow copy: otherwise a *pruned* local
        # node would validate the peer's full chain against its own prune-point
        # back-link (whose first block is genesis, previous_hash "0", not the
        # prune-point hash) and wrongly reject every full chain. Reconciliation
        # with our prune commitment is a separate, explicit step in sync_chain.
        candidate.prune_point = None
        candidate._valid_cache = None
        candidate._valid_cache_height = -1
        candidate._valid_cache_tip = None
        # A peer's chain is untrusted, so it is validated in full — including block
        # spacing. A node only adopts a peer chain that satisfies every rule the
        # network enforces, so a peer cannot push a chain with invalid timing.
        # (Our own persisted chain is grandfathered on reload; that is a separate,
        # trusted path in storage.py.)
        return candidate.is_chain_valid()

    def _filter_pending_after_chain_update(self, blockchain: Blockchain) -> list[Any]:
        retained_transactions = []
        for transaction in list(blockchain.pending_transactions):
            if getattr(transaction, "sender_address", None) == "SYSTEM":
                continue
            if blockchain._pending_transaction_has_spendable_balance(transaction):
                retained_transactions.append(transaction)
        return retained_transactions
