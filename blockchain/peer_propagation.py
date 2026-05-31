from __future__ import annotations

import hashlib
import ipaddress
import json
import math
import os
import time
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import urlparse, urlunparse

import requests

from block import Block
from blockchain import Blockchain
from logger import vorliq_logger
from registry import NodeRegistry
from transaction import LENDING_POOL_ADDRESS, SYSTEM_ADDRESS, SYSTEM_ADDRESSES, TREASURY_ADDRESS, Transaction
from wallet import address_from_public_key_pem, is_reserved_address, validate_address


EVENT_RETENTION_LIMIT = 500
MAX_PEER_TRANSACTION_BYTES = 12_000
MAX_PEER_BLOCK_BYTES = 250_000
MAX_PEER_BLOCK_TRANSACTIONS = 500
MAX_PUBLIC_TRANSACTION_AMOUNT = 21_000_000.0
SAFE_STATUSES = {"accepted", "duplicate", "rejected", "quarantined", "failed"}
SAFE_TYPES = {"transaction", "block"}
SAFE_DIRECTIONS = {"inbound", "outbound"}
FORBIDDEN_MARKERS = (
    "private_key",
    "private key",
    "begin ec private key",
    "begin rsa private key",
    "begin openssh private key",
    "admin_token",
    "password",
    "bearer ",
    "ssh-ed25519",
    "ssh-rsa",
    "raw_ip",
    "user_agent",
    "server_path",
)


def env_bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default
    return min(max(value, minimum), maximum)


def payload_size(data: Any) -> int:
    return len(json.dumps(data, separators=(",", ":"), default=str).encode("utf-8"))


def safe_text(value: Any, max_length: int = 160) -> str:
    text = str(value or "").replace("\x00", "").strip()
    text = text.replace("\r", " ").replace("\n", " ")
    return text[:max_length]


def safe_hash(value: Any) -> str:
    text = json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def normalize_public_url(value: Any) -> str:
    text = safe_text(value, 240).rstrip("/")
    parsed = urlparse(text)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("peer_url must be a safe http or https URL")
    netloc = parsed.hostname.lower()
    if parsed.port:
        netloc = f"{netloc}:{parsed.port}"
    return urlunparse((parsed.scheme, netloc, "", "", "", ""))


def safe_public_peer_url(value: Any) -> str:
    normalized = normalize_public_url(value)
    hostname = urlparse(normalized).hostname or ""
    try:
        ipaddress.ip_address(hostname)
        return ""
    except ValueError:
        return normalized


def payload_has_forbidden_marker(value: Any) -> bool:
    try:
        serialized = json.dumps(value, default=str).lower()
    except TypeError:
        return True
    return any(marker in serialized for marker in FORBIDDEN_MARKERS)


class PeerEventLog:
    def __init__(self, path: Path, retention_limit: int = EVENT_RETENTION_LIMIT) -> None:
        self.path = path
        self.retention_limit = retention_limit
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def load(self) -> list[dict[str, Any]]:
        if not self.path.exists():
            return []
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except Exception as exc:
            vorliq_logger.warning("Peer event log could not be read safely: %s", exc)
            return []
        events = data.get("events", data) if isinstance(data, dict) else data
        if not isinstance(events, list):
            return []
        return [self._safe_event(event) for event in events if isinstance(event, dict)][-self.retention_limit :]

    def append(self, event: dict[str, Any]) -> dict[str, Any]:
        safe_event = self._safe_event(event)
        events = [*self.load(), safe_event][-self.retention_limit :]
        payload = {"schema_version": 1, "events": events}
        tmp_path = self.path.with_name(f".{self.path.name}.{os.getpid()}.{int(time.time() * 1000)}.tmp")
        tmp_path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        os.replace(tmp_path, self.path)
        return safe_event

    def status(self) -> dict[str, Any]:
        events = self.load()
        counts = {status: 0 for status in SAFE_STATUSES}
        accepted_transactions = 0
        accepted_blocks = 0
        for event in events:
            status = event.get("status")
            if status in counts:
                counts[status] += 1
            if status == "accepted" and event.get("type") == "transaction":
                accepted_transactions += 1
            if status == "accepted" and event.get("type") == "block":
                accepted_blocks += 1
        return {
            "recent_event_count": len(events),
            "accepted_transactions": accepted_transactions,
            "accepted_blocks": accepted_blocks,
            "duplicates": counts["duplicate"],
            "rejected": counts["rejected"],
            "quarantined": counts["quarantined"],
            "failed": counts["failed"],
            "last_event_at": events[-1]["timestamp"] if events else None,
        }

    def query(self, *, limit: int = 25, offset: int = 0, status: str = "", event_type: str = "") -> dict[str, Any]:
        events = list(reversed(self.load()))
        if status:
            events = [event for event in events if event.get("status") == status]
        if event_type:
            events = [event for event in events if event.get("type") == event_type]
        total = len(events)
        page = events[offset : offset + limit]
        return {
            "events": page,
            "total": total,
            "limit": limit,
            "offset": offset,
            "has_more": offset + limit < total,
        }

    def _safe_event(self, event: dict[str, Any]) -> dict[str, Any]:
        status = safe_text(event.get("status"), 32).lower()
        event_type = safe_text(event.get("type"), 32).lower()
        direction = safe_text(event.get("direction"), 32).lower()
        return {
            "event_id": safe_text(event.get("event_id") or f"peer_{uuid.uuid4().hex}", 80),
            "timestamp": safe_text(event.get("timestamp") or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), 40),
            "direction": direction if direction in SAFE_DIRECTIONS else "inbound",
            "type": event_type if event_type in SAFE_TYPES else "transaction",
            "peer_url": self._safe_peer_url(event.get("peer_url")),
            "status": status if status in SAFE_STATUSES else "failed",
            "reason": safe_text(event.get("reason"), 80),
            "tx_id": safe_text(event.get("tx_id"), 80),
            "block_index": self._safe_int(event.get("block_index")),
            "block_hash": safe_text(event.get("block_hash"), 80),
            "safe_message": self._safe_message(event.get("safe_message")),
        }

    def _safe_peer_url(self, value: Any) -> str:
        try:
            return safe_public_peer_url(value)
        except ValueError:
            return ""

    def _safe_message(self, value: Any) -> str:
        message = safe_text(value, 220)
        return "Peer event message redacted." if payload_has_forbidden_marker(message) else message

    def _safe_int(self, value: Any) -> int | None:
        if value in {None, ""}:
            return None
        try:
            return int(value)
        except (TypeError, ValueError):
            return None


class PeerPropagation:
    def __init__(self, event_log: PeerEventLog) -> None:
        self.event_log = event_log

    @property
    def broadcast_enabled(self) -> bool:
        return env_bool("VORLIQ_PEER_BROADCAST_ENABLED", False)

    @property
    def receive_enabled(self) -> bool:
        return env_bool("VORLIQ_PEER_RECEIVE_ENABLED", True)

    @property
    def max_peers(self) -> int:
        return env_int("VORLIQ_PEER_BROADCAST_MAX_PEERS", 5, 1, 25)

    @property
    def timeout_seconds(self) -> float:
        return env_int("VORLIQ_PEER_BROADCAST_TIMEOUT_MS", 3000, 500, 30_000) / 1000

    def eligible_peers(
        self,
        registry: NodeRegistry,
        *,
        local_node_url: str,
        is_local_development: bool,
    ) -> list[str]:
        local_url = ""
        try:
            local_url = normalize_public_url(local_node_url)
        except ValueError:
            local_url = ""
        peers: list[str] = []
        for node in registry.get_all_nodes(include_archived=False):
            node_url = node.get("node_url")
            try:
                peer_url = normalize_public_url(node_url)
            except ValueError:
                continue
            parsed = urlparse(peer_url)
            if peer_url == local_url:
                continue
            if parsed.scheme != "https" and not is_local_development:
                continue
            lifecycle = node.get("lifecycle_status") or ("active" if node.get("active") else "inactive")
            if lifecycle != "active" or node.get("active") is not True:
                continue
            if node.get("sync_status") != "synced":
                continue
            if peer_url not in peers:
                peers.append(peer_url)
        return peers[: self.max_peers]

    def propagation_status(
        self,
        registry: NodeRegistry,
        *,
        local_node_url: str,
        is_local_development: bool,
    ) -> dict[str, Any]:
        active_peers = registry.get_active_nodes()
        eligible = self.eligible_peers(
            registry,
            local_node_url=local_node_url,
            is_local_development=is_local_development,
        )
        return {
            "success": True,
            "broadcast_enabled": self.broadcast_enabled,
            "receive_enabled": self.receive_enabled,
            "active_peer_count": len(active_peers),
            "eligible_broadcast_peer_count": len(eligible),
            "eligible_peers": [peer for peer in (safe_public_peer_url(peer) for peer in eligible) if peer],
            **self.event_log.status(),
        }

    def broadcast_transaction(
        self,
        transaction: Transaction,
        registry: NodeRegistry,
        *,
        local_node_url: str,
        is_local_development: bool,
    ) -> None:
        if not self.broadcast_enabled:
            return
        payload = {
            "transaction": transaction.to_dict(),
            "source_node_url": safe_text(local_node_url, 240),
        }
        for peer_url in self.eligible_peers(registry, local_node_url=local_node_url, is_local_development=is_local_development):
            self._post_peer_payload(peer_url, "/api/peer/transaction", payload, "transaction", tx_id=transaction.tx_id)

    def broadcast_block(
        self,
        block: dict[str, Any],
        registry: NodeRegistry,
        *,
        local_node_url: str,
        is_local_development: bool,
    ) -> None:
        if not self.broadcast_enabled:
            return
        payload = {
            "block": block,
            "source_node_url": safe_text(local_node_url, 240),
        }
        for peer_url in self.eligible_peers(registry, local_node_url=local_node_url, is_local_development=is_local_development):
            self._post_peer_payload(
                peer_url,
                "/api/peer/block",
                payload,
                "block",
                block_index=block.get("index"),
                block_hash=block.get("hash"),
            )

    def validate_peer_transaction(self, data: dict[str, Any], blockchain: Blockchain) -> tuple[Transaction | None, dict[str, Any], int]:
        if not self.receive_enabled:
            return None, {"success": False, "message": "Peer transaction receive is disabled.", "reason": "receive_disabled"}, 403
        try:
            transaction_data = self._extract_payload(data, "transaction", MAX_PEER_TRANSACTION_BYTES)
            self._reject_forbidden_payload(transaction_data)
            transaction = self._coerce_normal_peer_transaction(transaction_data)
            duplicate = self._transaction_is_duplicate(transaction, blockchain)
            if duplicate:
                return transaction, {"success": True, "duplicate": True, "tx_id": transaction.tx_id}, 200
            if not blockchain._pending_transaction_has_spendable_balance(transaction):
                raise ValueError("sender has insufficient confirmed spendable balance")
            return transaction, {"success": True, "duplicate": False, "tx_id": transaction.tx_id}, 201
        except ValueError as exc:
            return None, {"success": False, "message": self._safe_error(exc), "reason": self._reason_from_error(exc)}, 400

    def classify_peer_block(self, data: dict[str, Any], blockchain: Blockchain) -> tuple[Block | None, dict[str, Any], int]:
        if not self.receive_enabled:
            return None, {"success": False, "message": "Peer block receive is disabled.", "reason": "receive_disabled"}, 403
        try:
            block_data = self._extract_payload(data, "block", MAX_PEER_BLOCK_BYTES)
            self._reject_forbidden_payload(block_data)
            block = self._coerce_peer_block(block_data)
            latest_block = blockchain.get_latest_block()
            if block.hash == latest_block.hash:
                return block, {"success": True, "duplicate": True, "reason": "already_have_block"}, 200
            if block.index != latest_block.index + 1:
                self._validate_block_shape_and_proof(block, blockchain)
                self._validate_block_transactions(block, blockchain, enforce_balances=False)
                reason = "ahead_candidate" if block.index > latest_block.index + 1 else "possible_fork"
                return block, {"success": False, "quarantined": True, "reason": reason, "message": "Peer block is validly shaped but is not the direct next block."}, 202
            if block.previous_hash != latest_block.hash:
                self._validate_block_shape_and_proof(block, blockchain)
                self._validate_block_transactions(block, blockchain, enforce_balances=False)
                return block, {"success": False, "quarantined": True, "reason": "not_next_block", "message": "Peer block does not extend the local latest block."}, 202
            self._validate_block_shape_and_proof(block, blockchain)
            self._validate_block_transactions(block, blockchain, enforce_balances=True)
            return block, {"success": True, "duplicate": False, "reason": "direct_next_block"}, 201
        except ValueError as exc:
            return None, {"success": False, "message": self._safe_error(exc), "reason": self._reason_from_error(exc)}, 400

    def _post_peer_payload(
        self,
        peer_url: str,
        path: str,
        payload: dict[str, Any],
        event_type: str,
        *,
        tx_id: str | None = None,
        block_index: Any = None,
        block_hash: str | None = None,
    ) -> None:
        try:
            response = requests.post(f"{peer_url}{path}", json=payload, timeout=self.timeout_seconds)
            status = "accepted" if response.ok else "failed"
            reason = "delivered" if response.ok else f"http_{response.status_code}"
            self.event_log.append(
                {
                    "direction": "outbound",
                    "type": event_type,
                    "peer_url": peer_url,
                    "status": status,
                    "reason": reason,
                    "tx_id": tx_id,
                    "block_index": block_index,
                    "block_hash": block_hash,
                    "safe_message": "Peer propagation request completed." if response.ok else "Peer propagation request failed.",
                }
            )
        except requests.RequestException as exc:
            self.event_log.append(
                {
                    "direction": "outbound",
                    "type": event_type,
                    "peer_url": peer_url,
                    "status": "failed",
                    "reason": "request_failed",
                    "tx_id": tx_id,
                    "block_index": block_index,
                    "block_hash": block_hash,
                    "safe_message": self._safe_error(exc),
                }
            )

    def _extract_payload(self, data: dict[str, Any], key: str, max_bytes: int) -> dict[str, Any]:
        if not isinstance(data, dict):
            raise ValueError("payload must be a JSON object")
        if payload_size(data) > max_bytes:
            raise ValueError("payload is too large")
        payload = data.get(key, data)
        if not isinstance(payload, dict):
            raise ValueError(f"{key} must be a JSON object")
        if payload_size(payload) > max_bytes:
            raise ValueError("payload is too large")
        return payload

    def _reject_forbidden_payload(self, data: dict[str, Any]) -> None:
        if payload_has_forbidden_marker(data):
            raise ValueError("payload contains forbidden secret markers")

    def _coerce_normal_peer_transaction(self, data: dict[str, Any]) -> Transaction:
        sender = self._required_address(data.get("sender_address") or data.get("senderAddress") or data.get("sender"), "sender address")
        receiver = self._required_address(data.get("receiver_address") or data.get("receiverAddress") or data.get("receiver"), "receiver address")
        if sender in SYSTEM_ADDRESSES or sender == TREASURY_ADDRESS or sender == LENDING_POOL_ADDRESS or is_reserved_address(sender):
            raise ValueError("reserved sender is not accepted from peers")
        if receiver in SYSTEM_ADDRESSES or receiver == TREASURY_ADDRESS or receiver == LENDING_POOL_ADDRESS or is_reserved_address(receiver):
            raise ValueError("reserved receiver is not accepted from peers")
        if sender == receiver:
            raise ValueError("sender and receiver cannot be the same address")
        amount = self._required_amount(data.get("amount"))
        timestamp = self._required_timestamp(data.get("timestamp"))
        signature = self._required_text(data.get("signature"), "signature", 512)
        public_key = self._required_text(data.get("sender_public_key") or data.get("senderPublicKey"), "sender public key", 3000)
        if not all(character in "0123456789abcdefABCDEF" for character in signature):
            raise ValueError("signature must be hex encoded")
        try:
            derived_address = address_from_public_key_pem(public_key)
        except (TypeError, ValueError):
            raise ValueError("sender public key is malformed") from None
        if derived_address != sender:
            raise ValueError("sender public key does not match sender address")
        transaction = Transaction(
            sender_address=sender,
            receiver_address=receiver,
            amount=amount,
            timestamp=timestamp,
            signature=signature,
            sender_public_key=public_key,
            tx_id=None,
            transaction_type=data.get("type") or data.get("transaction_type") or data.get("category"),
            category=data.get("category"),
            metadata=data.get("metadata") if isinstance(data.get("metadata"), dict) else {},
        )
        if not transaction.verify_transaction():
            raise ValueError("transaction signature is invalid")
        return transaction

    def _coerce_peer_block(self, data: dict[str, Any]) -> Block:
        required = ["index", "timestamp", "transactions", "previous_hash", "nonce", "hash"]
        for field in required:
            if field not in data:
                raise ValueError(f"block {field} is required")
        if not isinstance(data.get("transactions"), list):
            raise ValueError("block transactions must be a list")
        if len(data["transactions"]) > MAX_PEER_BLOCK_TRANSACTIONS:
            raise ValueError("block contains too many transactions")
        return Block.from_dict(data)

    def _validate_block_shape_and_proof(self, block: Block, blockchain: Blockchain) -> None:
        if block.index < 0:
            raise ValueError("block index is invalid")
        if not isinstance(block.previous_hash, str) or len(block.previous_hash) > 80:
            raise ValueError("block previous hash is invalid")
        if not isinstance(block.hash, str) or len(block.hash) > 80:
            raise ValueError("block hash is invalid")
        if not math.isfinite(float(block.timestamp)):
            raise ValueError("block timestamp is invalid")
        if int(getattr(block, "difficulty", blockchain.difficulty)) != int(blockchain.difficulty):
            raise ValueError("block difficulty does not match local rules")
        if block.hash != block.calculate_hash():
            raise ValueError("block hash does not match recomputed hash")
        if not block.hash.startswith("0" * blockchain.difficulty):
            raise ValueError("block proof of work is invalid")
        if not block.has_valid_proof(blockchain.difficulty):
            raise ValueError("block proof of work is invalid")

    def _validate_block_transactions(self, block: Block, blockchain: Blockchain, *, enforce_balances: bool) -> None:
        seen_ids: set[str] = set()
        seen_payloads: set[str] = set()
        system_transactions: list[Transaction] = []
        for item in block.transactions:
            if not isinstance(item, dict):
                raise ValueError("block transaction must be an object")
            sender = item.get("sender_address") or item.get("senderAddress") or item.get("sender")
            if sender == SYSTEM_ADDRESS:
                transaction = Transaction.from_dict(item)
                system_transactions.append(transaction)
            elif sender in {TREASURY_ADDRESS, LENDING_POOL_ADDRESS}:
                transaction = Transaction.from_dict(item)
                if not self._matches_local_pending_reserved_transaction(transaction, blockchain):
                    raise ValueError("reserved transaction is not locally authorized")
            else:
                transaction = self._coerce_normal_peer_transaction(item)
            tx_id = transaction.tx_id or transaction.calculate_tx_id()
            payload_hash = safe_hash(transaction.to_dict())
            if tx_id in seen_ids or payload_hash in seen_payloads:
                raise ValueError("block contains duplicate transactions")
            seen_ids.add(tx_id)
            seen_payloads.add(payload_hash)
        self._validate_system_reward_transactions(system_transactions, blockchain)
        if enforce_balances and not blockchain._transactions_are_valid_for_next_block(block.transactions):
            raise ValueError("block transactions fail balance or signature validation")

    def _validate_system_reward_transactions(self, transactions: list[Transaction], blockchain: Blockchain) -> None:
        latest_block = blockchain.get_latest_block()
        previous_miner = getattr(latest_block, "miner_address", None)
        if not transactions:
            return
        if not previous_miner:
            raise ValueError("system reward is not allowed for genesis predecessor")
        mining_reward = blockchain.get_current_mining_reward()
        expected_miner_reward = round(mining_reward * (1 - blockchain.TREASURY_PERCENTAGE), 8)
        expected_treasury_reward = round(mining_reward * blockchain.TREASURY_PERCENTAGE, 8)
        expected = {
            (SYSTEM_ADDRESS, previous_miner, expected_miner_reward),
            (SYSTEM_ADDRESS, TREASURY_ADDRESS, expected_treasury_reward),
        }
        actual = {(tx.sender_address, tx.receiver_address, round(float(tx.amount), 8)) for tx in transactions}
        if actual != expected:
            raise ValueError("system reward transactions do not match local reward rules")
        for transaction in transactions:
            if transaction.signature is not None or not transaction.verify_transaction():
                raise ValueError("system reward transaction is invalid")

    def _matches_local_pending_reserved_transaction(self, transaction: Transaction, blockchain: Blockchain) -> bool:
        target = blockchain._transaction_identity(transaction)
        for pending in blockchain.pending_transactions:
            pending_tx = pending if isinstance(pending, Transaction) else Transaction.from_dict(pending)
            if pending_tx.sender_address in {TREASURY_ADDRESS, LENDING_POOL_ADDRESS} and blockchain._transaction_identity(pending_tx) == target:
                return True
        return False

    def _transaction_is_duplicate(self, transaction: Transaction, blockchain: Blockchain) -> bool:
        target_id = transaction.tx_id or transaction.calculate_tx_id()
        target_identity = blockchain._transaction_identity(transaction)
        for pending in blockchain.pending_transactions:
            pending_tx = pending if isinstance(pending, Transaction) else Transaction.from_dict(pending)
            if (pending_tx.tx_id or pending_tx.calculate_tx_id()) == target_id:
                return True
            if blockchain._transaction_identity(pending_tx) == target_identity:
                return True
        for block in blockchain.chain:
            for item in block.transactions:
                tx = item if isinstance(item, Transaction) else Transaction.from_dict(item)
                if (tx.tx_id or tx.calculate_tx_id()) == target_id:
                    return True
                if blockchain._transaction_identity(tx) == target_identity:
                    return True
        return False

    def _required_address(self, value: Any, label: str) -> str:
        text = self._required_text(value, label, 96)
        valid, errors, _warnings = validate_address(text, label=label, strict_length=True, allow_reserved=False)
        if not valid:
            raise ValueError(errors[0])
        return text

    def _required_amount(self, value: Any) -> float:
        try:
            amount = float(value)
        except (TypeError, ValueError):
            raise ValueError("amount must be a valid number") from None
        if amount <= 0:
            raise ValueError("amount must be greater than zero")
        if amount > MAX_PUBLIC_TRANSACTION_AMOUNT:
            raise ValueError("amount is too large")
        return amount

    def _required_timestamp(self, value: Any) -> float:
        try:
            timestamp = float(value)
        except (TypeError, ValueError):
            raise ValueError("timestamp must be a valid number") from None
        if not math.isfinite(timestamp) or timestamp <= 0:
            raise ValueError("timestamp is invalid")
        if timestamp > time.time() + 300:
            raise ValueError("timestamp is too far in the future")
        return timestamp

    def _required_text(self, value: Any, label: str, max_length: int) -> str:
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"{label} is required")
        text = value.replace("\x00", "").strip()
        if len(text) > max_length:
            raise ValueError(f"{label} is too large")
        return text

    def _safe_error(self, exc: Exception) -> str:
        return safe_text(str(exc) or "Peer payload was rejected.", 180)

    def _reason_from_error(self, exc: Exception) -> str:
        message = str(exc).lower()
        if "duplicate" in message:
            return "duplicate"
        if "signature" in message:
            return "invalid_signature"
        if "reserved" in message or "system" in message:
            return "reserved_address"
        if "proof" in message:
            return "invalid_proof"
        if "hash" in message:
            return "invalid_hash"
        if "too large" in message:
            return "payload_too_large"
        if "balance" in message or "spendable" in message:
            return "insufficient_balance"
        return "invalid_payload"
