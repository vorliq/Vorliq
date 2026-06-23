import hashlib
import hmac
import ipaddress
import os
import threading
import time
from urllib.parse import urlparse

from flask import Flask, g, jsonify, request

from achievements import Achievements
from block import Block
from blockchain import Blockchain, MiningCooldownError, StaleBlockError
from exchange import Exchange
from faucet import Faucet
from forum import Forum
from governance import Governance
from lending import LendingPool
from logger import vorliq_logger
from mining_flag import mining_enabled
from network import Network
from node import Node
import node_prober
from peer_propagation import PeerEventLog, PeerPropagation
from price import PriceDiscovery
from profiles import Profiles
from registry import NodeRegistry
from storage import Storage
from signed_authorization import AUTHORITY_ROUTES, SignedAuthorizationError, verify_signed_authorization
from storage_adapters.factory import (
    StorageAdapterConfigurationError,
    storage_adapter_runtime_metadata,
    validate_storage_backend_config,
)
from transaction import SYSTEM_ADDRESS, SYSTEM_ADDRESSES, TREASURY_ADDRESS, Transaction
from treasury import Treasury
from wallet import Wallet, address_from_public_key_pem, is_reserved_address, validate_address, verify_digest_signature

APP_START_TIME = time.time()
VORLIQ_HOST = os.environ.get("VORLIQ_HOST", "127.0.0.1")
VORLIQ_PORT = int(os.environ.get("VORLIQ_PORT", "5001"))
VORLIQ_ADVERTISED_HOST = "localhost" if VORLIQ_HOST in {"0.0.0.0", "::"} else VORLIQ_HOST
LOCAL_NODE_URL = os.environ.get("VORLIQ_NODE_URL", f"http://{VORLIQ_ADVERTISED_HOST}:{VORLIQ_PORT}")
IS_LOCAL_DEVELOPMENT = os.environ.get("NODE_ENV") != "production" and os.environ.get("FLASK_ENV") != "production"
ALLOWED_ORIGINS = {
    "https://vorliq.org",
    "https://www.vorliq.org",
    "https://node.vorliq.org",
    "https://status.vorliq.org",
    "https://vorliq.github.io",
    "https://vorliq.github.io/Vorliq",
}
MAX_PUBLIC_TRANSACTION_AMOUNT = 21_000_000.0
DEFAULT_PAGE_LIMIT = 50
MAX_PAGE_LIMIT = 200
MAX_TEXT_LENGTHS = {
    "forum_title": 140,
    "forum_body": 5000,
    "forum_reply": 3000,
    "proposal_title": 160,
    "proposal_description": 3000,
    "proposal_parameter": 500,
    "exchange_price": 160,
    "exchange_description": 1000,
    "loan_reason": 1000,
    "display_name": 80,
    "currency": 24,
}
app = Flask(__name__)


# --------------------------------------------------------------------------- #
# Request concurrency control
#
# The server runs threaded (see app.run at the bottom) so that independent read
# requests — balance, chain summary, recent blocks — no longer queue behind one
# another. Before this, the dev server handled one request at a time, so ten
# concurrent dashboard users serialised completely: measured read latency was
# ~2.0s p95 under 10 users for an in-memory lookup that costs ~0.2s on its own.
#
# Threading the server means the single shared in-memory blockchain can now be
# touched by several threads at once, so writes must stay mutually exclusive to
# avoid corrupting chain/pending state mid-mutation. A readers-writer lock gives
# us exactly that: any number of *verified read-only* endpoints run in parallel,
# while every state-mutating request (and, fail-safe, anything not on the
# read-only allowlist) takes the lock exclusively — i.e. it keeps the previous
# fully-serialised behaviour for writes, and only opens up parallelism for reads
# that have been confirmed not to mutate shared state.
class _ReadWriteLock:
    def __init__(self) -> None:
        self._cond = threading.Condition()
        self._readers = 0
        self._writer = False
        self._waiting_writers = 0

    def acquire_read(self) -> None:
        with self._cond:
            # Writer-preference: queued writers block new readers so a steady
            # stream of reads cannot starve a pending write (e.g. a mined block).
            while self._writer or self._waiting_writers:
                self._cond.wait()
            self._readers += 1

    def release_read(self) -> None:
        with self._cond:
            self._readers -= 1
            if self._readers == 0:
                self._cond.notify_all()

    def acquire_write(self) -> None:
        with self._cond:
            self._waiting_writers += 1
            try:
                while self._writer or self._readers:
                    self._cond.wait()
            finally:
                self._waiting_writers -= 1
            self._writer = True

    def release_write(self) -> None:
        with self._cond:
            self._writer = False
            self._cond.notify_all()


_chain_lock = _ReadWriteLock()

# View-function names that only read shared state (no chain mutation, no disk
# write). These run concurrently under the read lock. Anything not listed here
# — including the lazy-sync GET endpoints that may persist on the request thread
# — is treated as a writer and serialised, exactly as before threading.
PARALLEL_READ_ENDPOINTS = frozenset(
    {
        "health",
        "storage_health",
        "get_chain",
        "get_chain_blocks",
        "get_chain_summary",
        "get_chain_address",
        "get_chain_block_detail",
        "get_pending_transactions",
        "get_pending_transaction_records",
        "get_transaction_detail",
        "get_balance",
        "get_leaderboard",
        # Read-only product-usage aggregation: it only iterates the chain and the
        # community stores, so it runs under the shared read lock instead of
        # blocking every reader behind the write lock.
        "get_analytics_usage",
        # Diagnostics validates the whole chain on every call. It is hit constantly
        # by the network-status panel and the deployment readiness gate, and it is
        # strictly read-only, so it MUST run under the read lock — under the write
        # lock it serialised behind (and blocked) every other reader, which is what
        # made chain reads hang under load.
        "get_diagnostics",
        # The remaining endpoints below are all read-only data fetches (no chain
        # mutation, no lazy persist on the request thread). Lazy-sync GETs that may
        # write (faucet/mining/governance/treasury sync, index rebuilds) are
        # deliberately NOT here and stay serialised as writers.
        "get_community_stats",
        "get_audit_chain",
        "get_audit_treasury",
        "get_audit_lending",
        "get_audit_exchange",
        "get_audit_registry",
        "get_treasury_balance",
        "get_treasury_summary",
        "get_treasury_proposals",
        "get_all_treasury_proposals",
        "get_treasury_proposal",
        "get_treasury_ledger",
        "get_wallet_achievements",
        "get_profile",
        "get_profiles",
        "search_profiles",
        "get_registry_nodes",
        "get_registry_all_nodes",
        "get_registry_node",
        "get_registry_summary",
        "get_lending_loans",
        "get_lending_loan",
        "get_my_lending_loans",
        "get_exchange_offers",
        "get_exchange_offer",
        "get_exchange_all_offers",
        "get_exchange_my_offers",
        "get_forum_posts",
        "get_featured_forum_posts",
        "search_forum_posts",
        "get_governance_settings",
        "get_governance_rule_changes",
        "get_governance_settings_history",
    }
)

# Endpoints that manage the chain lock themselves rather than holding it for the
# whole request. Mining does this so the expensive proof of work runs WITHOUT the
# lock held — it takes the lock only briefly to read the tip and again briefly to
# append the finished block — instead of blocking every reader for the seconds a
# difficulty-5 proof of work can take.
SELF_MANAGED_LOCK_ENDPOINTS = frozenset({"mine_block"})


@app.before_request
def _acquire_concurrency_guard():
    # request.endpoint is the matched view function's name (None for a 404).
    if request.endpoint in SELF_MANAGED_LOCK_ENDPOINTS:
        g._chain_lock_mode = "self"
    elif request.endpoint in PARALLEL_READ_ENDPOINTS:
        _chain_lock.acquire_read()
        g._chain_lock_mode = "read"
    else:
        _chain_lock.acquire_write()
        g._chain_lock_mode = "write"
    return None


@app.teardown_request
def _release_concurrency_guard(_exc=None):
    mode = getattr(g, "_chain_lock_mode", None)
    if mode == "read":
        _chain_lock.release_read()
    elif mode == "write":
        _chain_lock.release_write()


@app.before_request
def require_signed_authority_write():
    if app.config.get("ALLOW_UNSIGNED_AUTHORITY_WRITES_FOR_VALIDATION_TESTS") is True:
        return None
    if request.method == "POST" and request.path in AUTHORITY_ROUTES:
        try:
            request.signed_authorization = verify_signed_authorization(
                request.get_json(silent=True) or {},
                request.path,
                storage=storage,
            )
        except SignedAuthorizationError as exc:
            return jsonify(
                {
                    "success": False,
                    "message": str(exc),
                    "error": {"code": exc.code, "message": str(exc), "details": {}},
                }
            ), exc.status
    return None


try:
    validate_storage_backend_config()
except StorageAdapterConfigurationError as exc:
    vorliq_logger.critical("Unsafe storage backend configuration refused at startup: %s", exc)
    raise
STORAGE_ADAPTER_METADATA = storage_adapter_runtime_metadata()
storage = Storage(os.environ.get("VORLIQ_DATA_DIR"))
peer_events = PeerEventLog(storage.data_dir / "peer_events.json")
peer_propagation = PeerPropagation(peer_events)
node = Node()
saved_blockchain = storage.load_chain()
if saved_blockchain:
    node.blockchain = saved_blockchain
    vorliq_logger.info("Flask startup restored saved blockchain with height %s", node.blockchain.get_block_height())
else:
    vorliq_logger.info("Flask startup created fresh blockchain with height %s", node.blockchain.get_block_height())


def _assert_startup_chain_valid() -> None:
    """Refuse to begin serving on a structurally invalid chain.

    A restart must never silently discard real history. load_chain() already
    grandfathers historical block spacing, so a chain that was mined faster than
    today's BLOCK_TIME_MINIMUM still reloads intact. This gate is the last line
    of defence: if the reloaded chain is structurally broken (bad hashes, broken
    links, invalid proof of work, or an invalid ledger) we raise before the app
    accepts requests rather than quietly starting fresh and losing transactions.
    """
    if not node.blockchain.is_chain_valid(enforce_block_spacing=False):
        message = (
            "Refusing to start: reloaded chain failed structural validation. "
            "Chain state is preserved on disk and was not overwritten; "
            "investigate chain.json before restarting."
        )
        vorliq_logger.critical(message)
        raise SystemExit(message)
    vorliq_logger.info(
        "Flask startup chain validation passed for %s blocks; ready to serve",
        len(node.blockchain.chain),
    )


_assert_startup_chain_valid()

node.blockchain.pending_transactions = [
    Transaction.from_dict(transaction) for transaction in storage.load_pending()
]
vorliq_logger.info("Flask startup restored %s pending transactions", len(node.blockchain.pending_transactions))

network = Network()
network.peers = storage.load_peers()
network.remove_peer(LOCAL_NODE_URL)
vorliq_logger.info("Flask startup restored %s peers", len(network.peers))

lending_pool = storage.load_lending_pool()
lending_pool.blockchain = node.blockchain
vorliq_logger.info("Flask startup restored %s lending records", len(lending_pool.loan_requests))
exchange = storage.load_exchange()
vorliq_logger.info("Flask startup restored %s community coordination requests", len(exchange.offers))
forum = storage.load_forum()
vorliq_logger.info("Flask startup restored %s forum posts", len(forum.posts))
governance = storage.load_governance()
if governance.governance_settings["mining_reward"]["changed"]:
    node.blockchain.mining_reward = float(governance.governance_settings["mining_reward"]["current"])
    node.blockchain.initial_mining_reward = float(governance.governance_settings["mining_reward"]["current"])
if governance.governance_settings["difficulty"]["changed"]:
    node.blockchain.difficulty = int(governance.governance_settings["difficulty"]["current"])
    node.blockchain.proof_target = "0" * node.blockchain.difficulty
vorliq_logger.info("Flask startup restored %s governance proposals", len(governance.proposals))
node_registry = storage.load_registry()
vorliq_logger.info("Flask startup restored %s registry records", len(node_registry.registered_nodes))
treasury = storage.load_treasury()
treasury.blockchain = node.blockchain
vorliq_logger.info("Flask startup restored %s treasury proposals", len(treasury.proposals))
faucet = storage.load_faucet()
vorliq_logger.info("Flask startup restored %s faucet claims", len(faucet.claims))
price_discovery = storage.load_price_discovery()
vorliq_logger.info("Flask startup restored %s price signals", len(price_discovery.signals))
profiles = storage.load_profiles()
vorliq_logger.info("Flask startup restored %s member profiles", len(profiles.profiles))
achievements = storage.load_achievements()
vorliq_logger.info("Flask startup restored achievements for %s wallets", len(achievements.earned))
notifications = storage.load_notifications()
_imports_ready = (
    Achievements,
    Block,
    Blockchain,
    MiningCooldownError,
    Transaction,
    Exchange,
    Forum,
    Governance,
    Treasury,
    Faucet,
    PriceDiscovery,
    Profiles,
)

if network.peers:
    network.announce_to_peers(LOCAL_NODE_URL, network.get_peers())


def _json_body() -> dict:
    data = request.get_json(force=True)
    if not isinstance(data, dict):
        raise ValueError("request body must be a JSON object")
    return data


def _require_admin_request():
    admin_token = os.environ.get("ADMIN_TOKEN", "")
    authorization = request.headers.get("Authorization", "")
    provided_token = authorization.removeprefix("Bearer ").strip() if authorization.startswith("Bearer ") else ""
    # Constant-time comparison so a network timing side-channel cannot be used to
    # recover the admin token byte by byte. The empty-value checks fail closed.
    if not admin_token or not provided_token or not hmac.compare_digest(provided_token, admin_token):
        return jsonify({"success": False, "message": "Unauthorized"}), 401
    return None


def _pick(data: dict, *names: str):
    for name in names:
        if data.get(name) is not None:
            return data.get(name)
    return None


def _require_text(value: object, field_name: str, max_length: int | None = None) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field_name} is required")
    normalized = value.replace("\x00", "").strip()
    if max_length and len(normalized) > max_length:
        raise ValueError(f"{field_name} must be {max_length} characters or fewer")
    return normalized


def _require_number(value: object, field_name: str, maximum: float | None = None) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{field_name} must be a valid number") from None
    if number <= 0:
        raise ValueError(f"{field_name} must be greater than zero")
    if maximum is not None and number > maximum:
        raise ValueError(f"{field_name} is too large")
    return number


def _require_public_wallet_address(value: object, field_name: str, *, allow_reserved: bool = False) -> str:
    normalized = _require_text(value, field_name, 96)
    valid, errors, _warnings = validate_address(
        normalized,
        label=field_name,
        strict_length=True,
        allow_reserved=allow_reserved,
    )
    if not valid:
        raise ValueError(errors[0])
    return normalized


def _require_enum(value: object, field_name: str, allowed: set[str]) -> str:
    normalized = _require_text(value, field_name, 80).lower()
    if normalized not in allowed:
        raise ValueError(f"{field_name} is not valid")
    return normalized


def _pagination(default_limit: int = DEFAULT_PAGE_LIMIT) -> tuple[int, int]:
    try:
        limit = int(request.args.get("limit", default_limit))
        offset = int(request.args.get("offset", 0))
    except (TypeError, ValueError):
        raise ValueError("limit and offset must be integers")
    if limit <= 0:
        raise ValueError("limit must be greater than zero")
    if offset < 0:
        raise ValueError("offset must be zero or greater")
    return min(limit, MAX_PAGE_LIMIT), offset


def _transaction_pagination(default_limit: int = 25) -> tuple[int, int]:
    limit, offset = _pagination(default_limit)
    return min(limit, 100), offset


def _peer_event_pagination(default_limit: int = 25) -> tuple[int, int]:
    limit, offset = _pagination(default_limit)
    return min(limit, 100), offset


def _page(items: list, limit: int, offset: int) -> tuple[list, int, bool]:
    total = len(items)
    page_items = items[offset : offset + limit]
    return page_items, total, offset + limit < total


def _profile_dependencies() -> dict:
    return {
        "blockchain": node.blockchain,
        "lending_pool": lending_pool,
        "exchange": exchange,
        "governance": governance,
        "treasury": treasury,
        "forum": forum,
        "achievements": achievements,
    }


INDEX_STARTUP_STATUS = {
    "loaded_from_disk": False,
    "rebuilt_on_startup": False,
    "last_rebuild_error": None,
}


def _rebuild_indexes(save: bool = True, force: bool = False) -> dict:
    # The index is now maintained incrementally as blocks are appended, so the
    # common path just fetches the already-current index (get_indexes does an
    # O(pending) overlay reconcile at most). Only the explicit admin rebuild
    # endpoint forces a full O(n) rebuild from the whole chain. This is what
    # removes the per-mined-block full rebuild that ran under the write lock.
    if force:
        indexes = node.blockchain.rebuild_indexes()
    else:
        indexes = node.blockchain.get_indexes()
    if save:
        storage.save_indexes(indexes)
    return indexes.health(node.blockchain, exists=storage.indexes_file.exists())


def _public_forum_post(post: dict, *, include_hidden_replies: bool = False) -> dict:
    public_post = dict(post)
    replies = list(public_post.get("replies", []))
    if not include_hidden_replies:
        replies = [
            reply if reply.get("moderation_status") != "hidden" else {
                "reply_id": reply.get("reply_id"),
                "author_address": reply.get("author_address", ""),
                "body": "This reply is hidden by community moderation review.",
                "image_data": None,
                "timestamp": reply.get("timestamp"),
                "vote_count": 0,
                "voters": [],
                "tips": [],
                "moderation_status": "hidden",
                "moderation_reason": reply.get("moderation_reason", ""),
                "moderated_at": reply.get("moderated_at"),
                "moderated_by_admin": bool(reply.get("moderated_by_admin", False)),
            }
            for reply in replies
        ]
    public_post["replies"] = replies
    return public_post


def _registry_profile_lookup(wallet_address: str) -> dict | None:
    return profiles.get_public_profile(wallet_address, _profile_dependencies())


def _sync_lending_pool(save: bool = True) -> bool:
    changed = lending_pool.sync_loan_statuses(node.blockchain)
    if changed and save:
        storage.save_lending_pool(lending_pool)
    return changed


_sync_lending_pool(save=True)


def _sync_exchange(save: bool = True) -> bool:
    changed = exchange.sync_trade_statuses(node.blockchain)
    if changed and save:
        storage.save_exchange(exchange)
    return changed


_sync_exchange(save=True)


def _sync_treasury(save: bool = True) -> bool:
    changed = treasury.sync_treasury_statuses(node.blockchain)
    if changed and save:
        storage.save_treasury(treasury)
        storage.save_pending(node.blockchain.pending_transactions)
        _rebuild_indexes(save=True)
    return changed


_sync_treasury(save=True)


def _sync_faucet(save: bool = True) -> bool:
    changed = faucet.sync_claim_statuses(node.blockchain)
    if changed and save:
        storage.save_faucet(faucet)
    return changed


_sync_faucet(save=True)


def _emit_notification(wallet_address: object, event: str, data: dict | None = None) -> None:
    """Best-effort opt-in email enqueue. Never raises into the caller — a
    notification must not be able to fail a transaction, loan, or vote."""
    try:
        address = str(wallet_address or "").strip()
        if not address or is_reserved_address(address):
            return
        result = notifications.enqueue(wallet_address=address, event=event, data=data or {})
        if result.get("queued"):
            storage.save_notifications(notifications)
            notifications.dispatch_async()
    except Exception as exc:  # noqa: BLE001 - notifications are strictly non-critical
        vorliq_logger.warning("Notification emit for %s failed: %s", event, exc)


def _emit_vlq_received(block: dict) -> None:
    """Notify the receiver of each genuine peer transfer confirmed in a block.
    System credits (mining rewards, treasury, lending pool, faucet) are skipped —
    'received VLQ' means a real transfer from another member."""
    try:
        for raw in (block or {}).get("transactions", []) or []:
            sender = str(raw.get("sender_address") or "")
            receiver = str(raw.get("receiver_address") or "")
            if not receiver or is_reserved_address(sender) or is_reserved_address(receiver):
                continue
            _emit_notification(receiver, "vlq_received", {"amount": raw.get("amount"), "from": sender})
    except Exception as exc:  # noqa: BLE001
        vorliq_logger.warning("vlq_received notification scan failed: %s", exc)


def _ensure_peer_reward_pending(mined_block: Block) -> None:
    miner_address = getattr(mined_block, "miner_address", None)
    if not miner_address:
        return
    mining_reward = node.blockchain.get_current_mining_reward()
    if mining_reward <= 0:
        return
    rewards = [
        Transaction(
            sender_address=SYSTEM_ADDRESS,
            receiver_address=miner_address,
            amount=round(mining_reward * (1 - node.blockchain.TREASURY_PERCENTAGE), 8),
        ),
        Transaction(
            sender_address=SYSTEM_ADDRESS,
            receiver_address=node.blockchain.TREASURY_ADDRESS,
            amount=round(mining_reward * node.blockchain.TREASURY_PERCENTAGE, 8),
        ),
    ]
    existing = {node.blockchain._transaction_identity(transaction) for transaction in node.blockchain.pending_transactions}
    for reward in rewards:
        if node.blockchain._transaction_identity(reward) not in existing:
            node.blockchain.pending_transactions.append(reward)


def _persist_after_peer_block(mined_block: Block) -> None:
    node.blockchain.prune_pending_transactions(drop_system_rewards=False)
    _ensure_peer_reward_pending(mined_block)
    _sync_lending_pool(save=False)
    _sync_exchange(save=False)
    _sync_treasury(save=False)
    _sync_faucet(save=False)
    # Append-only: append this block (O(1)); a full chain.json snapshot and the
    # index save are written only when one is due, not on every block.
    snapshotted = storage.persist_new_block(node.blockchain)
    storage.save_pending(node.blockchain.pending_transactions)
    _rebuild_indexes(save=snapshotted)
    storage.save_lending_pool(lending_pool)
    storage.save_exchange(exchange)
    storage.save_treasury(treasury)
    storage.save_faucet(faucet)


def _load_or_rebuild_indexes() -> None:
    try:
        loaded_indexes = storage.load_indexes(node.blockchain)
        if loaded_indexes is not None:
            node.blockchain.set_indexes(loaded_indexes)
            INDEX_STARTUP_STATUS["loaded_from_disk"] = True
            return
        INDEX_STARTUP_STATUS["rebuilt_on_startup"] = True
        _rebuild_indexes(save=True)
    except Exception as exc:
        INDEX_STARTUP_STATUS["last_rebuild_error"] = str(exc)
        vorliq_logger.warning("Index startup maintenance failed without blocking node startup: %s", exc)
        try:
            node.blockchain.rebuild_indexes()
        except Exception as rebuild_error:
            vorliq_logger.error("In-memory index rebuild failed: %s", rebuild_error)


_load_or_rebuild_indexes()


def _is_private_hostname(hostname: str) -> bool:
    host = hostname.lower()
    if host in {"localhost", "::1"} or host.endswith(".local"):
        return True
    try:
        parsed_ip = ipaddress.ip_address(host)
        return parsed_ip.is_private or parsed_ip.is_loopback or parsed_ip.is_link_local
    except ValueError:
        return False


def _require_public_url(value: object, field_name: str) -> str:
    url = _require_text(value, field_name, 240)
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError(f"{field_name} must be a valid http or https URL")
    if _is_private_hostname(parsed.hostname or "") and not IS_LOCAL_DEVELOPMENT:
        raise ValueError(f"{field_name} must be a public URL")
    return url.rstrip("/")


def _require_registry_url(value: object, field_name: str) -> str:
    url = _require_text(value, field_name, 240)
    return node_registry._normalize_node_url(url)


def _origin_is_allowed(origin: str) -> bool:
    if origin in ALLOWED_ORIGINS:
        return True
    parsed = urlparse(origin)
    return parsed.scheme in {"http", "https"} and parsed.hostname in {"localhost", "127.0.0.1"}


@app.after_request
def add_cors_headers(response):
    origin = request.headers.get("Origin")
    if origin and _origin_is_allowed(origin):
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Vary"] = "Origin"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return response


@app.get("/health")
def health():
    # Surface mempool staleness so a stalled chain is visible before users notice
    # their transactions are stuck. stuck_pending_count is the number of pending
    # transactions older than two mining cycles; a non-zero value means blocks are
    # not being produced (the exact condition behind the stuck-transaction
    # incident).
    now = time.time()
    threshold_seconds = 2 * node.blockchain.BLOCK_TIME_TARGET
    pending = node.blockchain.pending_transactions or []
    pending_count = 0
    stuck_pending_count = 0
    oldest_age = 0.0
    for raw in pending:
        record = raw if isinstance(raw, dict) else raw.to_dict()
        pending_count += 1
        timestamp = float(record.get("timestamp") or 0)
        age = now - timestamp if timestamp else 0.0
        oldest_age = max(oldest_age, age)
        if age > threshold_seconds:
            stuck_pending_count += 1

    # Dead-chain alert. The mempool check above can lag, so check the chain tip
    # directly: if the newest block is older than ten minutes AND there are
    # pending transactions waiting, chain health is "degraded". Ten minutes is
    # three full background-miner cycles (35s each) plus generous slack, so at
    # this threshold the chain genuinely is not producing blocks — it is not just
    # a quiet moment between blocks — and something is wrong.
    latest_block = node.blockchain.get_latest_block()
    last_block_age = now - float(getattr(latest_block, "timestamp", 0) or 0)
    dead_chain_threshold = 10 * 60
    chain_health = "ok"
    if pending_count > 0 and last_block_age > dead_chain_threshold:
        chain_health = "degraded"

    miner = background_miner_state
    return jsonify(
        {
            "status": "ok",
            "coin": "VLQ",
            "pending_count": pending_count,
            "stuck_pending_count": stuck_pending_count,
            "stuck_pending_threshold_seconds": threshold_seconds,
            "oldest_pending_age_seconds": int(oldest_age),
            # Chain-level liveness, distinct from the mempool staleness above.
            "chain_health": chain_health,
            "last_block_age_seconds": int(last_block_age),
            "dead_chain_threshold_seconds": dead_chain_threshold,
            # Background fallback miner visibility.
            "background_miner": {
                "configured": miner["configured"],
                "running": miner["running"],
                "wallet_configured": miner["wallet"] is not None,
                "last_mined_at": miner["last_mined_at"],
                "last_mined_index": miner["last_mined_index"],
            },
        }
    )


@app.get("/storage/health")
def storage_health():
    return jsonify({**storage.storage_health(), **STORAGE_ADAPTER_METADATA})


@app.get("/indexes/health")
def indexes_health():
    try:
        exists = storage.indexes_file.exists()
        indexes = node.blockchain.get_indexes()
        health = indexes.health(node.blockchain, exists=exists)
        health["loaded_from_disk"] = INDEX_STARTUP_STATUS["loaded_from_disk"]
        health["rebuilt_on_startup"] = INDEX_STARTUP_STATUS["rebuilt_on_startup"]
        if INDEX_STARTUP_STATUS["last_rebuild_error"]:
            health["status"] = "warning"
            health["message"] = "Indexes are available in memory but the last startup rebuild reported a warning."
        return jsonify(health)
    except Exception as exc:
        vorliq_logger.error("Index health endpoint failed: %s", exc)
        return jsonify(
            {
                "success": False,
                "exists": storage.indexes_file.exists(),
                "valid": False,
                "schema_version": None,
                "chain_height": node.blockchain.get_block_height(),
                "latest_block_hash": node.blockchain.get_latest_block().hash,
                "built_at": None,
                "status": "error",
                "rebuild_needed": True,
                "index_chain_match": False,
                "message": "Index health is unavailable.",
            }
        ), 200


@app.post("/indexes/rebuild")
def rebuild_indexes_endpoint():
    try:
        return jsonify(_rebuild_indexes(save=True, force=True))
    except Exception as exc:
        vorliq_logger.error("Index rebuild endpoint failed: %s", exc)
        return jsonify({"success": False, "status": "error", "message": "Index rebuild failed."}), 500


@app.get("/chain")
def get_chain():
    return jsonify(node.get_full_chain())


@app.get("/chain/blocks")
def get_chain_blocks():
    try:
        limit, offset = _pagination()
        blocks, total, has_more = node.blockchain.get_blocks_page(limit, offset)
        return jsonify(
            {
                "success": True,
                "blocks": blocks,
                "total_blocks": total,
                "limit": limit,
                "offset": offset,
                "has_more": has_more,
            }
        )
    except ValueError as exc:
        return jsonify({"success": False, "message": str(exc)}), 400


@app.get("/chain/summary")
def get_chain_summary():
    return jsonify({"success": True, "summary": node.blockchain.get_chain_summary()})


@app.get("/chain/address")
def get_chain_address():
    try:
        address = _require_text(request.args.get("address"), "address", 160)
        limit, offset = _transaction_pagination()
        history = node.blockchain.get_address_history(address, limit, offset)
        return jsonify(
            {
                "success": True,
                "address": address,
                **history,
                "limit": limit,
                "offset": offset,
            }
        )
    except ValueError as exc:
        return jsonify({"success": False, "message": str(exc)}), 400


@app.get("/chain/block/<path:index_or_hash>")
def get_chain_block_detail(index_or_hash):
    try:
        block = node.blockchain.get_block_detail(index_or_hash)
        if not block:
            return jsonify({"success": False, "message": "Block not found"}), 404
        return jsonify({"success": True, "block": block})
    except ValueError as exc:
        return jsonify({"success": False, "message": str(exc)}), 400


@app.get("/pending")
def get_pending_transactions():
    return jsonify({"pending_transactions": node.get_pending_transactions()})


@app.get("/transactions/pending")
def get_pending_transaction_records():
    try:
        limit, offset = _transaction_pagination()
        address = request.args.get("address")
        if address:
            address = _require_text(address, "address", 160)
        transactions, total, has_more = node.blockchain.get_pending_transaction_records(limit, offset, address)
        return jsonify(
            {
                "success": True,
                "transactions": transactions,
                "total": total,
                "limit": limit,
                "offset": offset,
                "has_more": has_more,
            }
        )
    except ValueError as exc:
        return jsonify({"success": False, "message": str(exc)}), 400


@app.get("/transactions/<tx_id>")
def get_transaction_detail(tx_id):
    try:
        transaction = node.blockchain.get_transaction_detail(_require_text(tx_id, "transaction ID", 128))
        if not transaction:
            return jsonify({"success": False, "message": "Transaction not found"}), 404
        return jsonify({"success": True, "transaction": transaction})
    except ValueError as exc:
        return jsonify({"success": False, "message": str(exc)}), 400


@app.get("/transactions")
def get_transactions():
    try:
        limit, offset = _transaction_pagination()
        address = request.args.get("address")
        tx_type = request.args.get("type")
        status = (request.args.get("status") or "all").lower()
        if address:
            address = _require_text(address, "address", 160)
        if tx_type:
            tx_type = _require_text(tx_type, "type", 80).lower()
        transactions, total, has_more = node.blockchain.get_transaction_records(
            limit,
            offset,
            address=address,
            tx_type=tx_type,
            status=status,
        )
        return jsonify(
            {
                "success": True,
                "transactions": transactions,
                "total": total,
                "limit": limit,
                "offset": offset,
                "has_more": has_more,
            }
        )
    except ValueError as exc:
        return jsonify({"success": False, "message": str(exc)}), 400


@app.post("/transaction")
def create_transaction():
    try:
        data = _json_body()
        sender_address = _require_public_wallet_address(
            _pick(data, "sender_address", "senderAddress", "sender"),
            "sender address",
            allow_reserved=True,
        )
        receiver_address = _require_public_wallet_address(
            _pick(data, "receiver_address", "receiverAddress", "receiver"),
            "receiver address",
            allow_reserved=True,
        )
        _require_number(data.get("amount"), "amount", MAX_PUBLIC_TRANSACTION_AMOUNT)
        _require_text(data.get("signature"), "signature", 512)
        _require_text(_pick(data, "sender_public_key", "senderPublicKey"), "sender public key", 3000)
        if sender_address in SYSTEM_ADDRESSES or sender_address == TREASURY_ADDRESS or is_reserved_address(sender_address):
            raise ValueError("system-controlled addresses cannot submit public transactions")
        if is_reserved_address(receiver_address):
            raise ValueError("reserved system addresses cannot receive public user transactions")
        if sender_address == receiver_address:
            raise ValueError("sender and receiver cannot be the same address")
        transaction = Transaction.from_dict(data)
        node.submit_transaction(transaction)
        achievements.check_and_award(transaction.sender_address, "first_transaction", node.blockchain)
        storage.save_pending(node.blockchain.pending_transactions)
        _rebuild_indexes(save=True)
        storage.save_achievements(achievements)
        peer_propagation.broadcast_transaction(
            transaction,
            node_registry,
            local_node_url=LOCAL_NODE_URL,
            is_local_development=IS_LOCAL_DEVELOPMENT,
        )
        return jsonify(
            {
                "success": True,
                "message": "Transaction added to pending pool",
                "transaction": node.blockchain.safe_transaction_record(transaction, status="pending"),
                "tx_id": transaction.tx_id,
            }
        ), 201
    except Exception as exc:
        vorliq_logger.error("Transaction endpoint failed: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 400


def _persist_after_mine(raw_block, miner_address):
    """Everything that must happen after a block is mined, shared by the /mine
    endpoint and the in-process background miner so they can never drift: persist
    the chain and pending pool, rebuild indexes, sync the sub-ledgers, award
    achievements, broadcast to peers, and emit received-VLQ notifications."""
    block = node.blockchain.get_block_detail(str(raw_block["index"])) or raw_block
    _sync_lending_pool(save=False)
    _sync_exchange(save=False)
    _sync_treasury(save=False)
    _sync_faucet(save=False)
    # Append-only: append this block (O(1)); a full chain.json snapshot and the
    # index save are written only when one is due, not on every block.
    snapshotted = storage.persist_new_block(node.blockchain)
    storage.save_pending(node.blockchain.pending_transactions)
    _rebuild_indexes(save=snapshotted)
    storage.save_lending_pool(lending_pool)
    storage.save_exchange(exchange)
    storage.save_treasury(treasury)
    storage.save_faucet(faucet)
    achievements.check_and_award(miner_address, "first_mine", node.blockchain)
    achievements.check_and_award(miner_address, "ten_blocks", node.blockchain)
    storage.save_achievements(achievements)
    peer_propagation.broadcast_block(
        raw_block,
        node_registry,
        local_node_url=LOCAL_NODE_URL,
        is_local_development=IS_LOCAL_DEVELOPMENT,
    )
    # Opt-in: notify receivers of genuine peer transfers now confirmed.
    _emit_vlq_received(block if isinstance(block, dict) else raw_block)
    return block


def _mine_one_block(miner_address):
    """Mine one block with the proof of work computed OUTSIDE the chain lock, so a
    several-second proof of work no longer blocks every reader for its duration.

      Phase 1 (brief read lock): build the candidate block on the current tip.
      Phase 2 (no lock held):    compute the proof of work — the slow part.
      Phase 3 (brief write lock): re-check the tip and append, or raise
                                  StaleBlockError if another block landed first.

    Shared by the /mine endpoint and the background miner so they behave
    identically. Returns the appended block detail dict."""
    _chain_lock.acquire_read()
    try:
        block, expected_previous_hash = node.blockchain.build_candidate_block(miner_address)
    finally:
        _chain_lock.release_read()

    # The expensive part runs with no lock held — reads are served normally.
    block.proof_of_work(block.difficulty)

    _chain_lock.acquire_write()
    try:
        node.blockchain.finalize_mined_block(block, expected_previous_hash)
        return _persist_after_mine(block.to_dict(), miner_address)
    finally:
        _chain_lock.release_write()


@app.post("/mine")
def mine_block():
    if not mining_enabled():
        vorliq_logger.warning("Mine endpoint refused a request because mining is disabled on this node")
        return (
            jsonify(
                {
                    "success": False,
                    "code": "MINING_DISABLED",
                    "message": "Mining is disabled on this node.",
                }
            ),
            503,
        )
    try:
        data = _json_body()
        miner_address = _require_public_wallet_address(
            data.get("miner_address") or data.get("minerAddress"),
            "miner address",
        )
        block = _mine_one_block(miner_address)
        return jsonify({"success": True, "block": block}), 201
    except StaleBlockError as exc:
        # Another miner appended a block while this one was being solved. Not an
        # error the caller did anything wrong — just retry on the new tip.
        vorliq_logger.info("Mine endpoint: %s", exc)
        return jsonify({"success": False, "code": "STALE_BLOCK", "message": str(exc)}), 409
    except MiningCooldownError as exc:
        vorliq_logger.warning("Mine endpoint rejected request during cooldown: %s", exc)
        return (
            jsonify({"success": False, "message": str(exc), "wait_seconds": exc.wait_seconds}),
            429,
        )
    except ValueError as exc:
        if "same address cannot mine two consecutive blocks" in str(exc):
            vorliq_logger.warning("Mine endpoint rejected consecutive miner: %s", exc)
            return jsonify({"success": False, "message": str(exc)}), 429
        vorliq_logger.error("Mine endpoint failed: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 400
    except Exception as exc:
        vorliq_logger.error("Mine endpoint failed: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 400


@app.get("/mining/status")
def get_mining_status():
    try:
        status = node.blockchain.get_mining_status()
        if not mining_enabled():
            status["enabled"] = False
            status["can_mine_now"] = False
            status["reason_if_not"] = "Mining is disabled on this node."
        return jsonify({"success": True, **status, "status": status})
    except Exception as exc:
        vorliq_logger.error("Mining status endpoint failed: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 400


# --------------------------------------------------------------------------- #
# In-process background fallback miner
#
# A small community network cannot rely on a member being online and mining to
# keep the chain alive. This daemon thread, part of the Flask service itself,
# wakes every 35 seconds and mines exactly one block IF there is pending work and
# the spacing rule allows it — using the server's own wallet. It is a fallback,
# not a competitor: it only mines when there are pending transactions and the
# tip is old enough, so if members are mining it simply finds nothing to do and
# goes back to sleep. It holds the same write lock as request handlers so it can
# never corrupt shared chain state, and it runs as a daemon so it never blocks a
# clean shutdown. With no server wallet configured it logs a warning and idles.
BACKGROUND_MINER_INTERVAL_SECONDS = int(os.environ.get("VORLIQ_BACKGROUND_MINER_INTERVAL", "35"))

background_miner_state = {
    "configured": False,   # a server wallet was resolved
    "running": False,      # the loop thread is alive
    "wallet": None,
    "last_mined_at": None,     # epoch seconds of the last block this miner produced
    "last_mined_index": None,
    "last_error": None,
}


def _resolve_server_wallet():
    """The wallet the fallback miner mines to. A dedicated variable first, then
    the node operator's wallet, so an existing operator-configured node gets a
    working fallback miner without extra setup. Never hardcoded."""
    for key in ("VORLIQ_SERVER_WALLET_ADDRESS", "VORLIQ_NODE_OPERATOR_WALLET", "VORLIQ_OPERATOR_WALLET"):
        value = (os.environ.get(key) or "").strip()
        if value:
            return value
    return None


def _background_miner_should_mine(wallet):
    """True only when there is real, mineable work right now. Cheap checks done
    outside the lock; re-verified inside the lock before mining."""
    if not mining_enabled():
        return False
    if not (node.blockchain.pending_transactions or []):
        return False
    status = node.blockchain.get_mining_status()
    if not status.get("chain_valid"):
        return False
    if status.get("seconds_until_next_allowed_block", 0) > 0:
        return False
    # Respect the same-miner anti-monopoly cooldown so we do not spin on a
    # rejection every cycle when we were the last miner (single-node case).
    if (
        status.get("last_miner_address") == wallet
        and status.get("seconds_since_last_block", 0) < node.blockchain.SAME_MINER_MIN_GAP
    ):
        return False
    return True


def _background_miner_loop(wallet):
    background_miner_state["running"] = True
    vorliq_logger.info(
        "Background fallback miner active; mining to %s every %ss when the chain needs it",
        wallet,
        BACKGROUND_MINER_INTERVAL_SECONDS,
    )
    while True:
        time.sleep(BACKGROUND_MINER_INTERVAL_SECONDS)
        try:
            if not _background_miner_should_mine(wallet):
                continue
            # Same three-phase path as /mine: proof of work runs outside the lock,
            # and finalize_mined_block raises StaleBlockError if a member (or a peer
            # block) landed first, in which case we just try again next cycle.
            raw_block = _mine_one_block(wallet)
            background_miner_state["last_mined_at"] = time.time()
            background_miner_state["last_mined_index"] = raw_block.get("index")
            background_miner_state["last_error"] = None
            vorliq_logger.info("Background fallback miner produced block %s", raw_block.get("index"))
        except StaleBlockError as exc:
            vorliq_logger.debug("Background miner lost a mining race; retrying next cycle: %s", exc)
        except MiningCooldownError as exc:
            vorliq_logger.debug("Background miner waiting on cooldown: %s", exc)
        except ValueError as exc:
            # Same-miner cooldown or a transient validation issue — fallback only.
            if "same address cannot mine two consecutive blocks" in str(exc):
                vorliq_logger.debug("Background miner waiting on same-miner cooldown: %s", exc)
            else:
                vorliq_logger.warning("Background miner skipped a cycle: %s", exc)
                background_miner_state["last_error"] = str(exc)
        except Exception as exc:  # never let the miner thread die on one bad cycle
            vorliq_logger.error("Background miner cycle error: %s", exc)
            background_miner_state["last_error"] = str(exc)


def start_background_miner():
    """Start the fallback miner in a daemon thread. Safe to call once at startup.
    Logs a warning and does nothing if no server wallet is configured."""
    wallet = _resolve_server_wallet()
    if not wallet:
        vorliq_logger.warning(
            "Background fallback miner disabled: no server wallet configured "
            "(set VORLIQ_SERVER_WALLET_ADDRESS). The chain will only advance when "
            "a member mines."
        )
        return
    background_miner_state["configured"] = True
    background_miner_state["wallet"] = wallet
    thread = threading.Thread(target=_background_miner_loop, args=(wallet,), name="vorliq-background-miner", daemon=True)
    thread.start()


# --------------------------------------------------------------------------- #
# Automatic network join + periodic chain sync
#
# A new node "points at the network" through VORLIQ_BOOTSTRAP_PEERS (a comma-
# separated list of peer URLs). On startup it registers those seed peers,
# discovers the rest of the network from them, downloads the longest valid chain
# and adopts it after full integrity validation, then announces itself so the
# existing nodes peer back. It re-syncs on an interval so a node that falls
# behind catches up on its own. Everything runs in a daemon thread, so a slow or
# unreachable peer never blocks startup or a clean shutdown.
NETWORK_SYNC_INTERVAL_SECONDS = int(os.environ.get("VORLIQ_NETWORK_SYNC_INTERVAL", "300"))


def _bootstrap_peers():
    raw = os.environ.get("VORLIQ_BOOTSTRAP_PEERS", "") or ""
    return [peer.strip() for peer in raw.split(",") if peer.strip()]


def _join_network_once(seed_peers):
    # 1. Discover: register the seed peers and pull their peer lists.
    try:
        network.discover_peers(seed_peers)
        network.remove_peer(LOCAL_NODE_URL)
    except Exception as exc:
        vorliq_logger.warning("Network join: peer discovery failed: %s", exc)
    # 2. Download, fully validate, and adopt the longest valid chain. This can
    #    replace node.blockchain.chain, so hold the write lock (same as the
    #    /peers/sync endpoint) to stay consistent with request handlers.
    try:
        _chain_lock.acquire_write()
        try:
            adopted = network.sync_chain(node.blockchain)
            if adopted:
                storage.save_chain(node.blockchain)
                storage.save_pending(node.blockchain.pending_transactions)
                _rebuild_indexes(save=True)
        finally:
            _chain_lock.release_write()
        if adopted:
            vorliq_logger.info(
                "Network join: adopted a longer canonical chain; height is now %s",
                node.blockchain.get_block_height(),
            )
    except Exception as exc:
        vorliq_logger.warning("Network join: chain sync failed: %s", exc)
    # 3. Announce self so existing nodes add us as a peer (and will sync from us).
    try:
        network.announce_to_peers(LOCAL_NODE_URL, network.get_peers())
    except Exception as exc:
        vorliq_logger.warning("Network join: announce failed: %s", exc)
    # 4. Persist the discovered peer set.
    try:
        storage.save_peers(network.peers)
    except Exception as exc:
        vorliq_logger.warning("Network join: saving peers failed: %s", exc)


def _network_join_loop(bootstrap):
    _join_network_once(bootstrap)  # immediate join on boot
    while True:
        time.sleep(NETWORK_SYNC_INTERVAL_SECONDS)
        try:
            _join_network_once(network.get_peers() or bootstrap)
        except Exception as exc:
            vorliq_logger.error("Network sync cycle error: %s", exc)


def start_network_join():
    """Join the network and keep in sync, in a daemon thread. Does nothing if no
    bootstrap peers are configured and none are already known (standalone node)."""
    bootstrap = _bootstrap_peers()
    if not bootstrap and not network.get_peers():
        vorliq_logger.info(
            "No bootstrap peers configured (VORLIQ_BOOTSTRAP_PEERS); running as a standalone node"
        )
        return
    thread = threading.Thread(target=_network_join_loop, args=(bootstrap,), name="vorliq-network-join", daemon=True)
    thread.start()
    vorliq_logger.info("Network join thread started (bootstrap: %s)", bootstrap or "saved peers")


@app.get("/mining/history")
def get_mining_history():
    try:
        limit, offset = _pagination(25)
        return jsonify({"success": True, **node.blockchain.get_mining_history(limit, offset)})
    except Exception as exc:
        vorliq_logger.error("Mining history endpoint failed: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 400


@app.post("/wallet")
def create_wallet():
    wallet = Wallet()
    achievements.check_and_award(wallet.address, "first_wallet", node.blockchain)
    storage.save_achievements(achievements)
    vorliq_logger.info("Wallet created through Flask API for address %s", wallet.address)
    return jsonify(
        {
            "address": wallet.address,
            "public_key": wallet.public_key_pem(),
            "private_key": wallet.private_key_pem(),
            "private_key_warning": "Save this private key securely. It can control this wallet and cannot be recovered by Vorliq.",
        }
    ), 201


@app.get("/balance")
def get_balance():
    address = request.args.get("address", "")
    try:
        address = _require_text(address, "address", 160)
        return jsonify(node.get_balance(address))
    except Exception as exc:
        vorliq_logger.error("Balance endpoint failed: %s", exc)
        return jsonify({"error": str(exc)}), 400


@app.get("/economics")
def get_economics():
    return jsonify(node.get_token_economics())


def _expire_governance_if_needed():
    if governance.expire_proposals(time.time()):
        storage.save_governance(governance)


def _current_governance_settings():
    governance.governance_settings["mining_reward"]["current"] = float(
        getattr(node.blockchain, "mining_reward", node.blockchain.initial_mining_reward)
    )
    governance.governance_settings["mining_reward"]["changed"] = (
        governance.governance_settings["mining_reward"]["current"]
        != governance.governance_settings["mining_reward"]["default"]
    )
    governance.governance_settings["difficulty"]["current"] = int(node.blockchain.difficulty)
    governance.governance_settings["difficulty"]["changed"] = (
        governance.governance_settings["difficulty"]["current"]
        != governance.governance_settings["difficulty"]["default"]
    )
    return governance.get_governance_settings()


@app.get("/diagnostics")
def get_diagnostics():
    latest_block = node.blockchain.get_latest_block()
    economics = node.blockchain.get_token_economics()
    return jsonify(
        {
            "success": True,
            "node_url": LOCAL_NODE_URL,
            "block_height": node.blockchain.get_block_height(),
            "chain_valid": node.blockchain.chain_valid_fast(),
            "pending_transactions": len(node.blockchain.pending_transactions),
            "known_peers": len(network.peers),
            "active_registry_nodes": len(node_registry.get_active_nodes()),
            "uptime_seconds": round(time.time() - APP_START_TIME, 2),
            "total_vlq_in_circulation": economics["total_issued"],
            "current_mining_reward": economics["current_mining_reward"],
            "current_difficulty": node.blockchain.difficulty,
            "block_time_target": node.blockchain.BLOCK_TIME_TARGET,
            "block_time_minimum": node.blockchain.BLOCK_TIME_MINIMUM,
            "last_block_hash": latest_block.hash,
            "last_block_timestamp": latest_block.timestamp,
            # The node self-advertises which wallet operates it, set locally by the
            # operator on their own server. The registry's independent prober reads
            # this and compares it against the wallet that signed the operator claim
            # -- a match is what binds the signed claim to the running node. It is
            # self-reported (untrusted on its own), never a credential.
            "operator_wallet_address": os.environ.get("VORLIQ_NODE_OPERATOR_WALLET")
            or os.environ.get("VORLIQ_OPERATOR_WALLET")
            or "",
        }
    )


def _weekly_report_stats():
    cutoff = time.time() - 7 * 24 * 60 * 60
    chain = node.blockchain.chain
    transactions = []
    for block in chain:
        for transaction in block.transactions:
            transaction_data = transaction.to_dict() if hasattr(transaction, "to_dict") else dict(transaction)
            transaction_data["block_timestamp"] = block.timestamp
            transactions.append(transaction_data)

    recent_transactions = [
        transaction
        for transaction in transactions
        if float(transaction.get("timestamp") or transaction.get("block_timestamp") or 0) >= cutoff
    ]

    return {
        "generated_at": time.time(),
        "new_blocks_mined": len([block for block in chain if block.timestamp >= cutoff]),
        "new_transactions": len(recent_transactions),
        "new_vlq_issued": sum(
            float(transaction.get("amount", 0))
            for transaction in recent_transactions
            if transaction.get("sender_address") == "SYSTEM"
        ),
        "new_loan_requests": len([loan for loan in lending_pool.loan_requests.values() if float(loan.get("timestamp", 0)) >= cutoff]),
        "new_loans_approved": len(
            [
                loan
                for loan in lending_pool.loan_requests.values()
                if loan.get("status") in {"approved_pending_issue", "active", "repayment_pending", "overdue", "repaid"}
                and float(loan.get("approved_at") or loan.get("timestamp") or 0) >= cutoff
            ]
        ),
        "new_exchange_offers": len([offer for offer in exchange.offers.values() if float(offer.get("timestamp", 0)) >= cutoff]),
        "new_exchange_trades_completed": len(
            [
                offer
                for offer in exchange.offers.values()
                if offer.get("status") == "completed"
                and float(offer.get("completed_at") or offer.get("accepted_timestamp") or offer.get("timestamp", 0)) >= cutoff
            ]
        ),
        "new_governance_proposals": len([proposal for proposal in governance.proposals.values() if float(proposal.get("timestamp", 0)) >= cutoff]),
        "new_treasury_proposals": len([proposal for proposal in treasury.proposals.values() if float(proposal.get("timestamp", 0)) >= cutoff]),
        "current_treasury_balance": treasury.get_treasury_balance(node.blockchain),
    }


@app.get("/api/reports/weekly")
@app.get("/reports/weekly")
def get_weekly_report_preview():
    latest_block = node.blockchain.get_latest_block()
    return jsonify(
        {
            "success": True,
            "subject": f"Vorliq Weekly Network Report {time.strftime('%Y-%m-%d')}",
            "stats": {
                **_weekly_report_stats(),
                "block_height": node.blockchain.get_block_height(),
                "chain_valid": node.blockchain.is_chain_valid(enforce_block_spacing=False),
                "current_mining_reward": node.blockchain.get_current_mining_reward(),
                "last_block_hash": latest_block.hash,
            },
        }
    )


def _audit_timestamp() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _audit_base(export_type: str) -> dict:
    return {
        "success": True,
        "audit_schema_version": 1,
        "export_type": export_type,
        "network_name": "Vorliq",
        "export_timestamp": _audit_timestamp(),
    }


@app.get("/audit/chain")
def get_audit_chain():
    blocks = node.blockchain.get_chain_data()
    latest_block = node.blockchain.get_latest_block()
    genesis_hash = blocks[0].get("hash") if blocks else None
    return jsonify(
        {
            **_audit_base("chain"),
            "block_count": len(blocks),
            "chain_valid": node.blockchain.is_chain_valid(enforce_block_spacing=False),
            "difficulty": node.blockchain.difficulty,
            "current_reward": node.blockchain.get_current_mining_reward(),
            "genesis_hash": genesis_hash,
            "latest_block_hash": latest_block.hash,
            "blocks": blocks,
        }
    )


@app.get("/audit/treasury")
def get_audit_treasury():
    _sync_treasury(save=False)
    proposals = treasury.get_proposals()
    ledger = treasury.get_treasury_ledger(node.blockchain, limit=1_000_000, offset=0)
    payout_statuses = [
        {
            "proposal_id": proposal.get("proposal_id"),
            "status": proposal.get("status"),
            "requested_amount": proposal.get("requested_amount"),
            "recipient_address": proposal.get("recipient_address"),
            "payout_tx_id": proposal.get("payout_tx_id"),
            "paid_at": proposal.get("paid_at"),
        }
        for proposal in proposals
        if proposal.get("status") in {"passed_pending_payout", "payout_pending", "paid"}
    ]
    return jsonify(
        {
            **_audit_base("treasury"),
            "treasury_address": node.blockchain.TREASURY_ADDRESS,
            "treasury_balance": treasury.get_treasury_balance(node.blockchain),
            "treasury_percentage": node.blockchain.TREASURY_PERCENTAGE,
            "treasury_ledger": ledger.get("entries", []),
            "treasury_proposals": proposals,
            "payout_statuses": payout_statuses,
        }
    )


@app.get("/audit/governance")
def get_audit_governance():
    _expire_governance_if_needed()
    settings = _current_governance_settings()
    proposals = governance.get_proposals()
    vote_weights = [
        {
            "proposal_id": proposal.get("proposal_id"),
            "yes_vote_weight": proposal.get("yes_vote_weight", 0),
            "no_vote_weight": proposal.get("no_vote_weight", 0),
            "vote_count": len(proposal.get("votes", {})),
            "status": proposal.get("status"),
        }
        for proposal in proposals
    ]
    return jsonify(
        {
            **_audit_base("governance"),
            "governance_proposals": proposals,
            "rule_change_history": governance.get_rule_changes(),
            "current_governance_settings": settings,
            "public_vote_weights": vote_weights,
        }
    )


@app.get("/audit/lending")
def get_audit_lending():
    _sync_lending_pool(save=False)
    return jsonify(
        {
            **_audit_base("lending"),
            "summary": lending_pool.get_summary(),
            "loans": lending_pool.get_all_loans(),
        }
    )


@app.get("/audit/exchange")
def get_audit_exchange():
    _sync_exchange(save=False)
    return jsonify(
        {
            **_audit_base("exchange"),
            "summary": exchange.get_summary(),
            "offers": exchange.get_all_offers(),
        }
    )


@app.get("/audit/registry")
def get_audit_registry():
    return jsonify(
        {
            **_audit_base("registry"),
            "summary": node_registry.get_summary(node.blockchain.get_block_height()),
            "nodes": node_registry.get_all_nodes(include_archived=True, profile_lookup=_registry_profile_lookup),
        }
    )


@app.get("/treasury/balance")
def get_treasury_balance():
    _sync_treasury(save=True)
    return jsonify(
        {
            "success": True,
            "address": node.blockchain.TREASURY_ADDRESS,
            "balance": treasury.get_treasury_balance(node.blockchain),
            "treasury_percentage": node.blockchain.TREASURY_PERCENTAGE,
        }
    )


@app.get("/treasury/summary")
def get_treasury_summary():
    _sync_treasury(save=True)
    return jsonify({"success": True, "summary": treasury.get_treasury_summary(node.blockchain)})


@app.get("/treasury/proposals")
def get_treasury_proposals():
    _sync_treasury(save=True)
    try:
        limit, offset = _pagination()
        status = request.args.get("status")
        category = request.args.get("category")
        address = request.args.get("address")
        if status or category or address:
            proposal_records = treasury.get_proposals(status=status, category=category, address=address)
        else:
            proposal_records = treasury.get_active_proposals()
        proposals, total, has_more = _page(proposal_records, limit, offset)
        return jsonify({"success": True, "proposals": proposals, "total": total, "limit": limit, "offset": offset, "has_more": has_more})
    except ValueError as exc:
        return jsonify({"success": False, "message": str(exc)}), 400


@app.get("/treasury/all")
def get_all_treasury_proposals():
    _sync_treasury(save=True)
    try:
        limit, offset = _pagination()
        proposals, total, has_more = _page(treasury.get_proposals(
            status=request.args.get("status"),
            category=request.args.get("category"),
            address=request.args.get("address"),
        ), limit, offset)
        return jsonify({"success": True, "proposals": proposals, "total": total, "limit": limit, "offset": offset, "has_more": has_more})
    except ValueError as exc:
        return jsonify({"success": False, "message": str(exc)}), 400


@app.get("/treasury/proposal")
def get_treasury_proposal():
    _sync_treasury(save=True)
    proposal = treasury.get_proposal(request.args.get("proposal_id") or request.args.get("proposalId") or "")
    if not proposal:
        return jsonify({"success": False, "error": "treasury proposal does not exist"}), 404
    return jsonify({"success": True, "proposal": proposal})


@app.get("/treasury/my")
def get_my_treasury():
    _sync_treasury(save=True)
    try:
        address = _require_text(request.args.get("address"), "address", 160)
        return jsonify({"success": True, **treasury.get_my_treasury(address)})
    except ValueError as exc:
        return jsonify({"success": False, "message": str(exc)}), 400


@app.post("/treasury/propose")
def create_treasury_proposal():
    try:
        data = _json_body()
        proposer_address = _require_public_wallet_address(
            data.get("proposer_address") or data.get("proposerAddress"),
            "proposer address",
        )
        proposer_wallet_address = data.get("proposer_wallet_address") or data.get("proposerWalletAddress") or proposer_address
        proposer_wallet_address = _require_public_wallet_address(proposer_wallet_address, "proposer wallet address")
        if proposer_wallet_address != proposer_address:
            raise ValueError("proposer wallet address must match proposer address")
        recipient_address = _require_public_wallet_address(
            data.get("recipient_address") or data.get("recipientAddress"),
            "recipient address",
        )
        if (
            data.get("treasury_balance") is not None
            or data.get("treasuryBalance") is not None
            or data.get("current_treasury_balance") is not None
            or data.get("currentTreasuryBalance") is not None
            or data.get("source_balance") is not None
            or data.get("sourceBalance") is not None
            or data.get("balance") is not None
        ):
            raise ValueError("treasury balance is derived by the server")
        proposal_id = treasury.create_proposal(
            proposer_address=proposer_address,
            title=_require_text(data.get("title"), "title", MAX_TEXT_LENGTHS["proposal_title"]),
            description=_require_text(data.get("description"), "description", MAX_TEXT_LENGTHS["proposal_description"]),
            category=_require_enum(data.get("category"), "category", Treasury.VALID_CATEGORIES),
            requested_amount=_require_number(data.get("requested_amount") or data.get("requestedAmount"), "requested amount", 1_000_000),
            recipient_address=recipient_address,
            current_blockchain=node.blockchain,
        )
        storage.save_treasury(treasury)
        return jsonify({"success": True, "proposal_id": proposal_id, "proposal": treasury.get_proposal(proposal_id)}), 201
    except Exception as exc:
        vorliq_logger.error("Treasury propose endpoint failed: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 400


@app.post("/treasury/vote")
def vote_on_treasury_proposal():
    try:
        data = _json_body()
        voter_address = _require_public_wallet_address(
            data.get("voter_address") or data.get("voterAddress"),
            "voter address",
        )
        voter_wallet_address = (
            data.get("voter_wallet_address") or data.get("voterWalletAddress") or voter_address
        )
        voter_wallet_address = _require_public_wallet_address(voter_wallet_address, "voter wallet address")
        if voter_wallet_address != voter_address:
            raise ValueError("voter wallet address must match voter address")
        if (
            data.get("voter_balance") is not None
            or data.get("voterBalance") is not None
            or data.get("vote_weight") is not None
            or data.get("voteWeight") is not None
            or data.get("voting_balance") is not None
            or data.get("votingBalance") is not None
            or data.get("balance") is not None
            or data.get("source_balance") is not None
            or data.get("sourceBalance") is not None
        ):
            raise ValueError("voter balance is derived by the server")
        voter_balance = node.blockchain.get_balance(voter_address)
        proposal = treasury.vote_on_proposal(
            proposal_id=data.get("proposal_id") or data.get("proposalId"),
            voter_address=voter_address,
            vote=data["vote"],
            voter_balance=voter_balance,
            current_blockchain=node.blockchain,
        )
        achievements.check_and_award(voter_address, "treasury_voter", node.blockchain)
        storage.save_treasury(treasury)
        storage.save_pending(node.blockchain.pending_transactions)
        _rebuild_indexes(save=True)
        storage.save_achievements(achievements)
        return jsonify({"success": True, "proposal": proposal})
    except Exception as exc:
        vorliq_logger.error("Treasury vote endpoint failed: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 400


@app.post("/treasury/cancel")
def cancel_treasury_proposal():
    try:
        data = _json_body()
        proposer_address = _require_public_wallet_address(
            data.get("proposer_address") or data.get("proposerAddress"),
            "proposer address",
        )
        proposer_wallet_address = data.get("proposer_wallet_address") or data.get("proposerWalletAddress") or proposer_address
        proposer_wallet_address = _require_public_wallet_address(proposer_wallet_address, "proposer wallet address")
        if proposer_wallet_address != proposer_address:
            raise ValueError("proposer wallet address must match proposer address")
        proposal = treasury.cancel_proposal(
            proposal_id=data.get("proposal_id") or data.get("proposalId"),
            proposer_address=proposer_address,
        )
        storage.save_treasury(treasury)
        return jsonify({"success": True, "proposal": proposal})
    except Exception as exc:
        vorliq_logger.error("Treasury cancel endpoint failed: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 400


@app.get("/treasury/ledger")
def get_treasury_ledger():
    _sync_treasury(save=True)
    try:
        limit, offset = _pagination(default_limit=25)
        ledger = treasury.get_treasury_ledger(node.blockchain, limit, offset)
        return jsonify({"success": True, **ledger})
    except ValueError as exc:
        return jsonify({"success": False, "message": str(exc)}), 400


@app.get("/faucet/summary")
def get_faucet_summary():
    try:
        _sync_faucet(save=True)
        return jsonify({"success": True, "summary": faucet.get_faucet_summary(node.blockchain)})
    except Exception as exc:
        vorliq_logger.error("Faucet summary endpoint failed: %s", exc)
        return jsonify({"success": False, "message": str(exc)}), 400


@app.post("/faucet/claim")
def claim_faucet():
    try:
        data = _json_body()
        wallet_address = _require_public_wallet_address(
            data.get("wallet_address") or data.get("walletAddress"),
            "wallet address",
        )
        fingerprint_hash = data.get("fingerprint_hash") or data.get("fingerprintHash")
        claim = faucet.request_claim(
            wallet_address=wallet_address,
            treasury_balance=treasury.get_treasury_balance(node.blockchain),
            blockchain=node.blockchain,
            fingerprint_hash=fingerprint_hash,
        )
        storage.save_faucet(faucet)
        storage.save_pending(node.blockchain.pending_transactions)
        _rebuild_indexes(save=True)
        status = claim.get("status")
        if status == "rate_limited":
            return jsonify({"success": False, "claim": claim, "message": claim.get("reason")}), 429
        if status in {"rejected", "treasury_empty"}:
            return jsonify({"success": False, "claim": claim, "message": claim.get("reason")}), 400
        return jsonify({"success": True, "claim": claim, "message": "Starter VLQ claim submitted as a pending treasury transaction."}), 201
    except ValueError as exc:
        vorliq_logger.warning("Faucet claim rejected: %s", exc)
        return jsonify({"success": False, "message": str(exc)}), 400
    except Exception as exc:
        vorliq_logger.error("Faucet claim endpoint failed: %s", exc)
        return jsonify({"success": False, "message": str(exc)}), 400


@app.get("/faucet/claims")
def get_faucet_claims():
    try:
        _sync_faucet(save=True)
        address = _require_public_wallet_address(request.args.get("address"), "wallet address")
        return jsonify({"success": True, "claims": faucet.get_claims_for_address(address)})
    except Exception as exc:
        vorliq_logger.error("Faucet claims endpoint failed: %s", exc)
        return jsonify({"success": False, "message": str(exc)}), 400


@app.get("/faucet/recent")
def get_recent_faucet_claims():
    try:
        _sync_faucet(save=True)
        limit, offset = _pagination(default_limit=25)
        return jsonify({"success": True, **faucet.get_recent_claims(limit, offset)})
    except Exception as exc:
        vorliq_logger.error("Faucet recent endpoint failed: %s", exc)
        return jsonify({"success": False, "message": str(exc)}), 400


@app.post("/price/signal")
def submit_price_signal():
    try:
        data = _json_body()
        signal_id = price_discovery.submit_signal(
            submitter_address=_require_text(data.get("submitter_address") or data.get("submitterAddress"), "submitter address", 160),
            currency=_require_text(data.get("currency"), "currency", MAX_TEXT_LENGTHS["currency"]),
            price_value=_require_number(data.get("price_value") or data.get("priceValue") or data.get("price"), "price", 1_000_000_000),
        )
        storage.save_price_discovery(price_discovery)
        return jsonify({"success": True, "signal_id": signal_id, "signal": price_discovery.signals[signal_id]}), 201
    except Exception as exc:
        vorliq_logger.error("Price signal endpoint failed: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 400


@app.get("/price/signals")
def get_price_signals():
    expired = price_discovery.expire_old_signals()
    if expired:
        storage.save_price_discovery(price_discovery)
    try:
        limit, offset = _pagination()
        signals, total, has_more = _page(price_discovery.get_active_signals(), limit, offset)
        return jsonify({"success": True, "signals": signals, "total": total, "limit": limit, "offset": offset, "has_more": has_more})
    except ValueError as exc:
        return jsonify({"success": False, "message": str(exc)}), 400


@app.get("/price/median")
def get_price_median():
    try:
        currency = request.args.get("currency", "")
        median = price_discovery.get_median_price(currency)
        storage.save_price_discovery(price_discovery)
        return jsonify({"success": True, **median})
    except Exception as exc:
        vorliq_logger.error("Price median endpoint failed: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 400


@app.get("/achievements")
def get_wallet_achievements():
    try:
        address = request.args.get("address", "")
        return jsonify({"success": True, "achievements": achievements.get_achievements(address)})
    except Exception as exc:
        vorliq_logger.error("Achievements endpoint failed: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 400


@app.get("/achievements/all")
def get_all_achievements():
    return jsonify({"success": True, "achievements": achievements.get_all_achievements()})


@app.post("/profiles/profile")
def create_or_update_profile():
    try:
        data = _json_body()
        wallet_address = _require_text(data.get("wallet_address") or data.get("walletAddress"), "wallet address", 160)
        profile = profiles.create_or_update_profile(wallet_address, data)
        reputation = profiles.calculate_reputation(wallet_address, **_profile_dependencies())
        storage.save_profiles(profiles)
        public_profile = profiles.get_public_profile(wallet_address, _profile_dependencies())
        return jsonify(
            {
                "success": True,
                "profile": public_profile or profile,
                "reputation_score": reputation["reputation_score"],
            }
        )
    except ValueError as exc:
        return jsonify({"success": False, "message": str(exc)}), 400


@app.get("/profiles/profile")
def get_profile():
    try:
        address = _require_text(request.args.get("address"), "address", 160)
        profile = profiles.get_public_profile(address, _profile_dependencies())
        if not profile:
            return jsonify({"success": False, "message": "profile not found"}), 404
        return jsonify({"success": True, "profile": profile})
    except ValueError as exc:
        return jsonify({"success": False, "message": str(exc)}), 400


@app.get("/profiles")
def get_profiles():
    try:
        limit, offset = _pagination()
        profile_rows = [
            profiles.get_public_profile(profile["wallet_address"], _profile_dependencies()) or profile
            for profile in profiles.get_profiles(limit, offset)
        ]
        total = len(profiles.profiles)
        return jsonify(
            {
                "success": True,
                "profiles": profile_rows,
                "total": total,
                "limit": limit,
                "offset": offset,
                "has_more": offset + limit < total,
            }
        )
    except ValueError as exc:
        return jsonify({"success": False, "message": str(exc)}), 400


@app.get("/profiles/search")
def search_profiles():
    try:
        query = _require_text(request.args.get("q"), "query", 80)
        limit, offset = _pagination()
        matches = [
            profiles.get_public_profile(profile["wallet_address"], _profile_dependencies()) or profile
            for profile in profiles.search_profiles(query, limit, offset)
        ]
        return jsonify(
            {
                "success": True,
                "profiles": matches,
                "limit": limit,
                "offset": offset,
                "has_more": len(matches) == limit,
            }
        )
    except ValueError as exc:
        return jsonify({"success": False, "message": str(exc)}), 400


@app.get("/profiles/top")
def get_top_profiles():
    try:
        raw_limit = int(request.args.get("limit", 20))
        limit = max(1, min(raw_limit, 100))
        return jsonify({"success": True, "profiles": profiles.get_top_profiles(limit, _profile_dependencies())})
    except (TypeError, ValueError) as exc:
        return jsonify({"success": False, "message": str(exc)}), 400


@app.post("/profiles/verify/challenge")
def create_profile_verification_challenge():
    try:
        data = _json_body()
        address = _require_text(data.get("address") or data.get("wallet_address") or data.get("walletAddress"), "wallet address", 160)
        valid, errors, _warnings = validate_address(address, label="wallet address")
        if not valid:
            raise ValueError(errors[0])
        challenge = profiles.create_verification_challenge(address)
        return jsonify({
            "success": True,
            "address": address,
            "message": challenge["message"],
            "timestamp": challenge["timestamp"],
            "expires_at": challenge["expires_at"],
            "note": "This proves control of a Vorliq wallet only. It is not KYC or legal identity verification.",
        })
    except ValueError as exc:
        return jsonify({"success": False, "message": str(exc)}), 400


@app.post("/profiles/verify/submit")
def submit_profile_verification():
    try:
        data = _json_body()
        address = _require_text(data.get("address") or data.get("wallet_address") or data.get("walletAddress"), "wallet address", 160)
        public_key = _require_text(data.get("public_key") or data.get("publicKey"), "public key", 3000)
        signature = _require_text(data.get("signature"), "signature", 512)
        message = _require_text(data.get("message"), "verification message", 220)
        challenge = profiles.get_active_challenge(address)
        if not challenge or challenge.get("message") != message:
            raise ValueError("verification challenge is missing or expired")
        derived_address = address_from_public_key_pem(public_key)
        if derived_address != address:
            raise ValueError("public key does not match wallet address")
        digest_hex = hashlib.sha256(message.encode("utf-8")).hexdigest()
        if not verify_digest_signature(digest_hex, signature, public_key):
            raise ValueError("signature could not be verified")
        profile = profiles.mark_wallet_verified(address, message)
        storage.save_profiles(profiles)
        public_profile = profiles.get_public_profile(address, _profile_dependencies()) or profile
        return jsonify({
            "success": True,
            "verified_wallet": True,
            "profile": public_profile,
            "note": "Wallet verification proves control of this wallet only. It is not real-world identity verification.",
        })
    except Exception as exc:
        vorliq_logger.error("Profile verification submit endpoint failed: %s", exc)
        return jsonify({"success": False, "message": str(exc)}), 400


@app.post("/peers/register")
def register_peer():
    try:
        data = _json_body()
        peer = _require_public_url(data.get("peer"), "peer URL")
        network.register_peer(peer)
        network.discover_peers(network.get_peers())
        network.remove_peer(LOCAL_NODE_URL)
        storage.save_peers(network.peers)
        if not data.get("_announced"):
            network.announce_to_peers(LOCAL_NODE_URL, [peer])
        return jsonify({"success": True, "peers": network.get_peers()}), 201
    except Exception as exc:
        vorliq_logger.error("Peer register endpoint failed: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 400


@app.get("/peers")
def get_peers():
    return jsonify({"peers": network.get_peers()})


@app.post("/peers/announce")
def announce_peer():
    try:
        data = _json_body()
        node_url = _require_public_url(data.get("node_url") or data.get("nodeUrl"), "node URL")
        network.register_peer(node_url)
        network.remove_peer(LOCAL_NODE_URL)
        storage.save_peers(network.peers)
        return jsonify({"success": True, "message": "Peer announced", "peers": network.get_peers()}), 201
    except Exception as exc:
        vorliq_logger.error("Peer announce endpoint failed: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 400


def _peer_source_url(data: dict) -> str:
    value = data.get("source_node_url") or data.get("sourceNodeUrl") or data.get("peer_url") or data.get("peerUrl")
    if not value:
        return ""
    try:
        return node_registry._normalize_node_url(str(value))
    except Exception:
        return ""


@app.post("/peer/transaction")
def receive_peer_transaction():
    data = {}
    peer_url = ""
    tx_id = ""
    try:
        data = _json_body()
        peer_url = _peer_source_url(data)
        transaction, result, status_code = peer_propagation.validate_peer_transaction(data, node.blockchain)
        if transaction is not None:
            tx_id = transaction.tx_id
        if result.get("success") and not result.get("duplicate") and transaction is not None:
            node.submit_transaction(transaction)
            storage.save_pending(node.blockchain.pending_transactions)
            _rebuild_indexes(save=True)
            peer_events.append(
                {
                    "direction": "inbound",
                    "type": "transaction",
                    "peer_url": peer_url,
                    "status": "accepted",
                    "reason": "valid_transaction",
                    "tx_id": transaction.tx_id,
                    "safe_message": "Peer transaction passed signature, address, duplicate, and spend validation.",
                }
            )
        elif result.get("duplicate"):
            peer_events.append(
                {
                    "direction": "inbound",
                    "type": "transaction",
                    "peer_url": peer_url,
                    "status": "duplicate",
                    "reason": "duplicate_transaction",
                    "tx_id": tx_id or result.get("tx_id"),
                    "safe_message": "Peer transaction was already known locally.",
                }
            )
        else:
            peer_events.append(
                {
                    "direction": "inbound",
                    "type": "transaction",
                    "peer_url": peer_url,
                    "status": "rejected",
                    "reason": result.get("reason"),
                    "tx_id": tx_id,
                    "safe_message": result.get("message") or "Peer transaction was rejected.",
                }
            )
        return jsonify(result), status_code
    except Exception as exc:
        peer_events.append(
            {
                "direction": "inbound",
                "type": "transaction",
                "peer_url": peer_url,
                "status": "rejected",
                "reason": "invalid_payload",
                "tx_id": tx_id,
                "safe_message": str(exc),
            }
        )
        vorliq_logger.warning("Peer transaction endpoint rejected payload: %s", exc)
        return jsonify({"success": False, "message": "Peer transaction was rejected.", "reason": "invalid_payload"}), 400


@app.post("/peer/block")
def receive_peer_block():
    data = {}
    peer_url = ""
    try:
        data = _json_body()
        peer_url = _peer_source_url(data)
        block, result, status_code = peer_propagation.classify_peer_block(data, node.blockchain)
        block_index = getattr(block, "index", None)
        block_hash = getattr(block, "hash", "")
        if result.get("success") and result.get("duplicate"):
            peer_events.append(
                {
                    "direction": "inbound",
                    "type": "block",
                    "peer_url": peer_url,
                    "status": "duplicate",
                    "reason": result.get("reason") or "duplicate_block",
                    "block_index": block_index,
                    "block_hash": block_hash,
                    "safe_message": "Peer block was already the local latest block.",
                }
            )
            return jsonify(result), status_code
        if result.get("success") and block is not None:
            if not node.blockchain.add_block(block):
                result = {"success": False, "message": "Peer block failed the local add_block validation path.", "reason": "add_block_rejected"}
                peer_events.append(
                    {
                        "direction": "inbound",
                        "type": "block",
                        "peer_url": peer_url,
                        "status": "rejected",
                        "reason": "add_block_rejected",
                        "block_index": block_index,
                        "block_hash": block_hash,
                        "safe_message": result["message"],
                    }
                )
                return jsonify(result), 409
            _persist_after_peer_block(block)
            peer_events.append(
                {
                    "direction": "inbound",
                    "type": "block",
                    "peer_url": peer_url,
                    "status": "accepted",
                    "reason": "direct_next_block",
                    "block_index": block_index,
                    "block_hash": block_hash,
                    "safe_message": "Peer block extended the local latest block and passed local validation.",
                }
            )
            return jsonify({**result, "block_index": block_index, "block_hash": block_hash}), status_code
        if result.get("quarantined"):
            peer_events.append(
                {
                    "direction": "inbound",
                    "type": "block",
                    "peer_url": peer_url,
                    "status": "quarantined",
                    "reason": result.get("reason"),
                    "block_index": block_index,
                    "block_hash": block_hash,
                    "safe_message": result.get("message") or "Peer block was quarantined.",
                }
            )
            return jsonify({**result, "block_index": block_index, "block_hash": block_hash}), status_code
        peer_events.append(
            {
                "direction": "inbound",
                "type": "block",
                "peer_url": peer_url,
                "status": "rejected",
                "reason": result.get("reason"),
                "block_index": block_index,
                "block_hash": block_hash,
                "safe_message": result.get("message") or "Peer block was rejected.",
            }
        )
        return jsonify(result), status_code
    except Exception as exc:
        peer_events.append(
            {
                "direction": "inbound",
                "type": "block",
                "peer_url": peer_url,
                "status": "rejected",
                "reason": "invalid_payload",
                "safe_message": str(exc),
            }
        )
        vorliq_logger.warning("Peer block endpoint rejected payload: %s", exc)
        return jsonify({"success": False, "message": "Peer block was rejected.", "reason": "invalid_payload"}), 400


@app.get("/peers/propagation/status")
def peer_propagation_status():
    return jsonify(
        peer_propagation.propagation_status(
            node_registry,
            local_node_url=LOCAL_NODE_URL,
            is_local_development=IS_LOCAL_DEVELOPMENT,
        )
    )


@app.get("/peers/propagation/events")
def peer_propagation_events():
    try:
        limit, offset = _peer_event_pagination()
        status = str(request.args.get("status") or "").lower()
        event_type = str(request.args.get("type") or "").lower()
        if status and status not in {"accepted", "duplicate", "rejected", "quarantined", "failed"}:
            raise ValueError("status filter is not valid")
        if event_type and event_type not in {"transaction", "block"}:
            raise ValueError("type filter is not valid")
        return jsonify({"success": True, **peer_events.query(limit=limit, offset=offset, status=status, event_type=event_type)})
    except ValueError as exc:
        return jsonify({"success": False, "message": str(exc)}), 400


@app.get("/admin/peers/propagation")
def admin_peer_propagation_status():
    status = peer_propagation.propagation_status(
        node_registry,
        local_node_url=LOCAL_NODE_URL,
        is_local_development=IS_LOCAL_DEVELOPMENT,
    )
    return jsonify(
        {
            **status,
            "diagnostics": {
                "retention_limit": peer_events.retention_limit,
                "event_log_configured": True,
                "broadcast_timeout_ms": int(peer_propagation.timeout_seconds * 1000),
                "broadcast_max_peers": peer_propagation.max_peers,
                "note": "Peer payloads are validated before local mutation; non-next blocks are quarantined.",
            },
        }
    )


@app.post("/receive_block")
def receive_block():
    return (
        jsonify(
            {
                "success": False,
                "error": {
                    "code": "LEGACY_PEER_BLOCK_RETIRED",
                    "message": "Legacy block receive has been retired. Use /peer/block so peer blocks are validated and quarantined safely.",
                },
                "message": "Legacy block receive has been retired. Use /peer/block so peer blocks are validated and quarantined safely.",
            }
        ),
        410,
    )


@app.get("/peers/sync")
def sync_peers():
    updated = network.sync_chain(node.blockchain)
    if updated:
        _sync_lending_pool(save=False)
        _sync_exchange(save=False)
        _sync_treasury(save=False)
        _sync_faucet(save=False)
        storage.save_chain(node.blockchain)
        _rebuild_indexes(save=True)
        storage.save_lending_pool(lending_pool)
        storage.save_exchange(exchange)
        storage.save_treasury(treasury)
        storage.save_faucet(faucet)
    peer_statuses = network.check_peer_statuses()
    return jsonify(
        {
            "success": True,
            "updated": updated,
            "message": "Chain updated to a longer network chain"
            if updated
            else "Your chain is already the longest",
            "chain_height": node.blockchain.get_block_height(),
            "peer_statuses": peer_statuses,
        }
    )


@app.post("/registry/register")
def register_public_node():
    try:
        data = _json_body()
        registered_node = node_registry.register_node(
            node_url=_require_public_url(data.get("node_url") or data.get("nodeUrl"), "node URL"),
            display_name=_require_text(data.get("display_name") or data.get("displayName"), "display name", MAX_TEXT_LENGTHS["display_name"]),
            description=data.get("description", ""),
            region=data.get("region", ""),
            country=data.get("country", ""),
            operator_wallet_address=data.get("operator_wallet_address") or data.get("operatorWalletAddress") or "",
            software_version=data.get("software_version") or data.get("softwareVersion") or "",
            is_public=bool(data.get("is_public", data.get("isPublic", True))),
        )
        storage.save_registry(node_registry)
        return jsonify(
            {
                "success": True,
                "node": registered_node,
                "nodes": node_registry.get_active_nodes(_registry_profile_lookup),
            }
        ), 201
    except Exception as exc:
        vorliq_logger.error("Registry register endpoint failed: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 400


@app.get("/registry/nodes")
def get_registry_nodes():
    return jsonify({"success": True, "nodes": node_registry.get_active_nodes(_registry_profile_lookup)})


@app.get("/registry/all")
def get_registry_all_nodes():
    status = request.args.get("status")
    country = request.args.get("country")
    sync_status = request.args.get("sync_status") or request.args.get("syncStatus")
    lifecycle_status = request.args.get("lifecycle_status") or request.args.get("lifecycleStatus")
    include_archived = str(request.args.get("include_archived") or request.args.get("includeArchived") or "").lower() in {"true", "1", "yes"}
    return jsonify(
        {
            "success": True,
            "nodes": node_registry.get_all_nodes(
                status=status,
                country=country,
                sync_status=sync_status,
                lifecycle_status=lifecycle_status,
                include_archived=include_archived,
                profile_lookup=_registry_profile_lookup,
            ),
        }
    )


@app.get("/registry/node")
def get_registry_node():
    try:
        node_url = _require_public_url(request.args.get("node_url") or request.args.get("nodeUrl"), "node URL")
        registry_node = node_registry.get_node(node_url, _registry_profile_lookup)
        if not registry_node:
            return jsonify({"success": False, "message": "Node not found"}), 404
        return jsonify({"success": True, "node": registry_node})
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 400


@app.get("/registry/summary")
def get_registry_summary():
    return jsonify(
        {
            "success": True,
            "summary": node_registry.get_summary(node.blockchain.get_block_height()),
        }
    )


@app.get("/registry/lifecycle")
def get_registry_lifecycle():
    lifecycle_status = request.args.get("lifecycle_status") or request.args.get("lifecycleStatus")
    include_archived = str(request.args.get("include_archived") or request.args.get("includeArchived") or "").lower() in {"true", "1", "yes"}
    nodes = node_registry.get_lifecycle_nodes(
        lifecycle_status=lifecycle_status,
        include_archived=include_archived,
        profile_lookup=_registry_profile_lookup,
    )
    return jsonify(
        {
            "success": True,
            "summary": node_registry.summarize_node_lifecycle(),
            "nodes": nodes,
            "note": "Archived and retired nodes are preserved in registry history but hidden from default live network views.",
        }
    )


@app.post("/registry/admin/archive")
def admin_archive_registry_node():
    unauthorized = _require_admin_request()
    if unauthorized:
        return unauthorized
    try:
        data = _json_body()
        archived_node = node_registry.archive_node(
            node_url=_require_registry_url(data.get("node_url") or data.get("nodeUrl"), "node URL"),
            reason=data.get("reason") or "Archived by administrator.",
            changed_by="admin",
            trusted_public_node_url=os.environ.get("VORLIQ_NODE_URL", "https://node.vorliq.org"),
            force=bool(data.get("force", False)),
        )
        storage.save_registry(node_registry)
        return jsonify({"success": True, "node": archived_node})
    except Exception as exc:
        vorliq_logger.error("Registry archive endpoint failed: %s", exc)
        return jsonify({"success": False, "message": str(exc)}), 400


@app.post("/registry/admin/restore")
def admin_restore_registry_node():
    unauthorized = _require_admin_request()
    if unauthorized:
        return unauthorized
    try:
        data = _json_body()
        restored_node = node_registry.restore_node(
            node_url=_require_registry_url(data.get("node_url") or data.get("nodeUrl"), "node URL"),
            reason=data.get("reason") or "Restored by administrator.",
            changed_by="admin",
        )
        storage.save_registry(node_registry)
        return jsonify({"success": True, "node": restored_node})
    except Exception as exc:
        vorliq_logger.error("Registry restore endpoint failed: %s", exc)
        return jsonify({"success": False, "message": str(exc)}), 400


@app.post("/registry/admin/retire")
def admin_retire_registry_node():
    unauthorized = _require_admin_request()
    if unauthorized:
        return unauthorized
    try:
        data = _json_body()
        retired_node = node_registry.retire_node(
            node_url=_require_registry_url(data.get("node_url") or data.get("nodeUrl"), "node URL"),
            reason=data.get("reason") or "Retired by administrator.",
            changed_by="admin",
        )
        storage.save_registry(node_registry)
        return jsonify({"success": True, "node": retired_node})
    except Exception as exc:
        vorliq_logger.error("Registry retire endpoint failed: %s", exc)
        return jsonify({"success": False, "message": str(exc)}), 400


@app.post("/registry/verify-operator")
def registry_verify_operator():
    # Signature already verified by the before_request signed-authority gate
    # (this route is in AUTHORITY_ROUTES), so the operator wallet here is proven
    # to control its key. No admin token: this is an operator self-service action,
    # not an administrator action.
    try:
        data = _json_body()
        node_url = _require_registry_url(data.get("node_url") or data.get("nodeUrl"), "node URL")
        operator_wallet = data.get("operator_wallet_address") or data.get("operatorWalletAddress")
        release = bool(data.get("release", False))
        node_entry = node_registry.verify_operator_claim(
            node_url=node_url,
            operator_wallet_address=operator_wallet,
            release=release,
        )
        storage.save_registry(node_registry)
        return jsonify({"success": True, "node": node_entry})
    except ValueError as exc:
        return jsonify({"success": False, "message": str(exc)}), 400
    except Exception as exc:
        vorliq_logger.error("Registry verify-operator endpoint failed: %s", exc)
        return jsonify({"success": False, "message": str(exc)}), 400


@app.post("/registry/admin/probe-sweep")
def admin_probe_sweep_registry():
    unauthorized = _require_admin_request()
    if unauthorized:
        return unauthorized
    try:
        reference_height = node.blockchain.get_block_height()
        summary = {
            "probed": 0,
            "verified": 0,
            "claim_mismatch": 0,
            "unreachable": 0,
            "blocked": 0,
            "inconclusive": 0,
            "operator_mismatch": 0,
        }
        mismatches = []
        for entry in node_registry.get_all_nodes(include_archived=False):
            node_url = entry.get("node_url")
            if not node_url:
                continue
            probe = node_prober.probe_node(node_url)
            status, reason = node_prober.compare_probe_to_claim(
                probe,
                claimed_height=entry.get("last_chain_height"),
                claimed_hash=entry.get("last_block_hash"),
                reference_height=reference_height,
            )
            # Only verified nodes carry a signed operator claim worth confirming.
            operator_match, operator_reason = (None, "")
            if entry.get("is_verified_operator"):
                operator_match, operator_reason = node_prober.compare_operator_claim(
                    probe,
                    claimed_operator=entry.get("operator_wallet_address"),
                )
            node_registry.apply_probe_result(
                node_url, probe, status, reason, operator_match=operator_match, operator_reason=operator_reason
            )
            summary["probed"] += 1
            if status in summary:
                summary[status] += 1
            if status == "claim_mismatch":
                mismatches.append({"node_url": node_url, "reason": reason})
            if operator_match is False:
                summary["operator_mismatch"] += 1
                mismatches.append({"node_url": node_url, "reason": operator_reason})
        storage.save_registry(node_registry)
        return jsonify({"success": True, "summary": summary, "mismatches": mismatches, "checked_at": time.time()})
    except Exception as exc:
        vorliq_logger.error("Registry probe-sweep endpoint failed: %s", exc)
        return jsonify({"success": False, "message": str(exc)}), 400


@app.post("/registry/heartbeat")
def registry_heartbeat():
    try:
        data = _json_body()
        node_url = _require_public_url(data.get("node_url") or data.get("nodeUrl"), "node URL")
        chain_height = data.get("chain_height") if data.get("chain_height") is not None else data.get("chainHeight")
        chain_valid = data.get("chain_valid") if data.get("chain_valid") is not None else data.get("chainValid")
        if isinstance(chain_valid, str):
            chain_valid = chain_valid.lower() in {"true", "1", "yes", "valid"}
        snapshot_signature_verified = (
            data.get("snapshot_signature_verified")
            if data.get("snapshot_signature_verified") is not None
            else data.get("snapshotSignatureVerified")
        )
        if isinstance(snapshot_signature_verified, str):
            snapshot_signature_verified = snapshot_signature_verified.lower() in {"true", "1", "yes", "verified"}
        registry_node = node_registry.heartbeat(
            node_url=node_url,
            public_chain_height=node.blockchain.get_block_height(),
            display_name=data.get("display_name") or data.get("displayName"),
            chain_height=chain_height,
            last_block_hash=data.get("latest_block_hash") or data.get("latestBlockHash") or data.get("last_block_hash") or data.get("lastBlockHash"),
            chain_valid=chain_valid if isinstance(chain_valid, bool) else None,
            software_version=data.get("software_version") or data.get("softwareVersion"),
            operator_wallet_address=data.get("operator_wallet_address") or data.get("operatorWalletAddress"),
            response_time_ms=data.get("response_time_ms") or data.get("responseTimeMs"),
            snapshot_hash=data.get("snapshot_hash") or data.get("snapshotHash"),
            snapshot_signature_verified=snapshot_signature_verified
            if isinstance(snapshot_signature_verified, bool)
            else None,
            region=data.get("region"),
            country=data.get("country"),
        )
        storage.save_registry(node_registry)
        return jsonify({"success": True, "node": registry_node})
    except Exception as exc:
        vorliq_logger.error("Registry heartbeat endpoint failed: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 400


@app.post("/test/seed-lending-pool")
def seed_lending_pool():
    # Test-only: credit the community lending pool so a test loan can be funded
    # from a positive pool balance. Gated behind an env flag set only by the e2e
    # harness; it 404s in production. The credit is a SYSTEM-sender coinbase-style
    # transaction (the same mechanism mining rewards use), mined on the next block.
    if os.environ.get("VORLIQ_ENABLE_TEST_SEED") != "true":
        return jsonify({"success": False, "message": "Not found"}), 404
    try:
        from transaction import LENDING_POOL_ADDRESS

        data = _json_body()
        amount = _require_number(data.get("amount", 100), "seed amount", 1_000_000)
        seed_transaction = Transaction(
            sender_address=SYSTEM_ADDRESS,
            receiver_address=LENDING_POOL_ADDRESS,
            amount=amount,
            transaction_type="test_pool_seed",
            category="lending",
        )
        node.blockchain.add_pending_transaction(seed_transaction)
        storage.save_pending(node.blockchain.pending_transactions)
        return jsonify({"success": True, "tx_id": seed_transaction.tx_id, "amount": amount}), 201
    except Exception as exc:
        vorliq_logger.error("Seed lending pool endpoint failed: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 400


@app.post("/lending/request")
def create_lending_request():
    try:
        data = _json_body()
        requester_address = _require_text(data.get("requester_address") or data.get("requesterAddress"), "requester address", 160)
        loan_id = lending_pool.create_loan_request(
            requester_address=requester_address,
            amount=_require_number(data.get("amount"), "loan amount", lending_pool.maximum_loan_amount),
            reason=_require_text(data.get("reason"), "reason", MAX_TEXT_LENGTHS["loan_reason"]),
        )
        storage.save_lending_pool(lending_pool)
        return jsonify({"success": True, "loan_id": loan_id, "loan": lending_pool.get_loan(loan_id)}), 201
    except Exception as exc:
        vorliq_logger.error("Lending request endpoint failed: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 400


@app.get("/lending/loans")
def get_lending_loans():
    try:
        limit, offset = _pagination()
        status = request.args.get("status")
        address = request.args.get("address")
        _sync_lending_pool(save=True)
        filtered_loans = lending_pool.get_all_loans(status=status, address=address)
        loans, total, has_more = _page(filtered_loans, limit, offset)
        return jsonify({"success": True, "loans": loans, "total": total, "limit": limit, "offset": offset, "has_more": has_more})
    except ValueError as exc:
        return jsonify({"success": False, "message": str(exc)}), 400


@app.get("/lending/loan")
def get_lending_loan():
    try:
        loan_id = _require_text(request.args.get("loan_id") or request.args.get("loanId"), "loan ID", 128)
        _sync_lending_pool(save=True)
        loan = lending_pool.get_loan(loan_id)
        if not loan:
            return jsonify({"success": False, "error": "loan does not exist"}), 404
        return jsonify({"success": True, "loan": loan})
    except ValueError as exc:
        return jsonify({"success": False, "message": str(exc)}), 400


@app.get("/lending/my")
def get_my_lending_loans():
    try:
        address = _require_text(request.args.get("address"), "address", 160)
        _sync_lending_pool(save=True)
        loans = lending_pool.get_my_loans(address)
        return jsonify({"success": True, **loans})
    except ValueError as exc:
        return jsonify({"success": False, "message": str(exc)}), 400


@app.get("/lending/summary")
def get_lending_summary():
    _sync_lending_pool(save=True)
    return jsonify({"success": True, "summary": lending_pool.get_summary()})


@app.post("/lending/vote")
def vote_on_lending_loan():
    try:
        data = request.get_json(force=True)
        loan_id = data.get("loan_id") or data.get("loanId")
        voter_address = _require_public_wallet_address(
            data.get("voter_address") or data.get("voterAddress"),
            "voter address",
        )
        voter_wallet_address = (
            data.get("voter_wallet_address") or data.get("voterWalletAddress") or voter_address
        )
        voter_wallet_address = _require_public_wallet_address(voter_wallet_address, "voter wallet address")
        if voter_wallet_address != voter_address:
            raise ValueError("voter wallet address must match voter address")
        if (
            data.get("voter_balance") is not None
            or data.get("voterBalance") is not None
            or data.get("vote_weight") is not None
            or data.get("voteWeight") is not None
            or data.get("voting_balance") is not None
            or data.get("votingBalance") is not None
            or data.get("balance") is not None
        ):
            raise ValueError("voter balance is derived by the server")
        voter_balance = node.blockchain.get_balance(voter_address)
        loan = lending_pool.vote_on_loan(
            loan_id=loan_id,
            voter_address=voter_address,
            vote=data["vote"],
            voter_vlq_balance=voter_balance,
        )
        achievements.check_and_award(voter_address, "first_loan", node.blockchain)
        storage.save_lending_pool(lending_pool)
        storage.save_pending(node.blockchain.pending_transactions)
        _rebuild_indexes(save=True)
        storage.save_achievements(achievements)
        # Opt-in: when this vote approves the loan, tell the requester it's funded.
        # Approval happens once, so this fires a single time per loan.
        if loan.get("status") == "approved_pending_issue":
            _emit_notification(loan.get("requester_address"), "loan_funded", {"amount": loan.get("amount")})
        return jsonify({
            "success": True,
            "loan": loan,
            "issuance_tx_id": loan.get("issuance_tx_id"),
            "message": "Vote recorded. If approved, issuance remains pending until mined.",
        })
    except Exception as exc:
        vorliq_logger.error("Lending vote endpoint failed: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 400


@app.post("/lending/repay")
def repay_lending_loan():
    try:
        data = request.get_json(force=True)
        loan_id = data.get("loan_id") or data.get("loanId")
        repayer_address = data.get("repayer_address") or data.get("repayerAddress")
        loan = lending_pool.repay_loan(loan_id, repayer_address, node.blockchain)
        achievements.check_and_award(repayer_address, "first_repayment", node.blockchain)
        storage.save_lending_pool(lending_pool)
        storage.save_pending(node.blockchain.pending_transactions)
        _rebuild_indexes(save=True)
        storage.save_achievements(achievements)
        # Opt-in: tell the members who funded this loan (the yes-voters) it's being
        # repaid. The repayer initiated this, so they aren't notified.
        funders = [addr for addr, choice in (loan.get("votes") or {}).items() if choice == "yes"]
        for funder in funders:
            if funder != repayer_address:
                _emit_notification(funder, "loan_repaid", {"amount": loan.get("repayment_amount")})
        return jsonify(
            {
                "success": True,
                "message": "Repayment transaction submitted and waiting for mining confirmation.",
                "repayment_amount": loan["repayment_amount"],
                "repayment_tx_id": loan.get("repayment_tx_id"),
                "loan": loan,
            }
        )
    except Exception as exc:
        vorliq_logger.error("Lending repay endpoint failed: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 400


@app.post("/exchange/offer")
def create_exchange_offer():
    try:
        data = _json_body()
        offer_id = exchange.create_offer(
            creator_address=_require_text(data.get("creator_address") or data.get("creatorAddress"), "creator address", 160),
            offer_type=_require_enum(data.get("offer_type") or data.get("offerType"), "offer type", {"buy", "sell"}),
            amount=_require_number(data.get("amount"), "offer amount", 100_000),
            price_description=_require_text(data.get("price") or data.get("price_description") or data.get("priceDescription"), "price", MAX_TEXT_LENGTHS["exchange_price"]),
            detail_description=_require_text(data.get("description") or data.get("detail_description") or data.get("detailDescription"), "description", MAX_TEXT_LENGTHS["exchange_description"]),
        )
        storage.save_exchange(exchange)
        return jsonify({"success": True, "offer_id": offer_id, "offer": exchange.get_offer(offer_id)}), 201
    except Exception as exc:
        vorliq_logger.error("Exchange offer endpoint failed: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 400


@app.get("/exchange/offers")
def get_exchange_offers():
    try:
        limit, offset = _pagination()
        _sync_exchange(save=True)
        status = request.args.get("status") or None
        offer_type = request.args.get("type") or request.args.get("offer_type") or None
        address = request.args.get("address") or None
        offers, total, has_more = _page(exchange.get_offers(status=status, offer_type=offer_type, address=address), limit, offset)
        return jsonify({"success": True, "offers": offers, "total": total, "limit": limit, "offset": offset, "has_more": has_more})
    except ValueError as exc:
        return jsonify({"success": False, "message": str(exc)}), 400


@app.get("/exchange/offer")
def get_exchange_offer():
    try:
        offer_id = _require_text(request.args.get("offer_id") or request.args.get("offerId"), "offer ID", 128)
        _sync_exchange(save=True)
        offer = exchange.get_offer(offer_id)
        if not offer:
            return jsonify({"success": False, "error": "offer does not exist"}), 404
        return jsonify({"success": True, "offer": offer})
    except ValueError as exc:
        return jsonify({"success": False, "message": str(exc)}), 400


@app.get("/exchange/all")
def get_exchange_all_offers():
    try:
        limit, offset = _pagination()
        _sync_exchange(save=True)
        offers, total, has_more = _page(exchange.get_all_offers(), limit, offset)
        return jsonify({"success": True, "offers": offers, "total": total, "limit": limit, "offset": offset, "has_more": has_more})
    except ValueError as exc:
        return jsonify({"success": False, "message": str(exc)}), 400


@app.get("/exchange/my")
def get_exchange_my_offers():
    try:
        address = _require_text(request.args.get("address"), "address", 160)
        _sync_exchange(save=True)
        trades = exchange.get_my_trades(address)
        return jsonify({"success": True, **trades})
    except Exception as exc:
        vorliq_logger.error("Exchange my offers endpoint failed: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 400


@app.get("/exchange/summary")
def get_exchange_summary():
    _sync_exchange(save=True)
    return jsonify({"success": True, "summary": exchange.get_summary()})


@app.post("/exchange/accept")
def accept_exchange_offer():
    try:
        data = request.get_json(force=True)
        offer = exchange.accept_offer(
            offer_id=data.get("offer_id") or data.get("offerId"),
            acceptor_address=data.get("acceptor_address") or data.get("acceptorAddress"),
        )
        storage.save_exchange(exchange)
        return jsonify({"success": True, "offer": offer, "message": "Offer accepted. The VLQ side still needs a recorded transaction."})
    except Exception as exc:
        vorliq_logger.error("Exchange accept endpoint failed: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 400


@app.post("/exchange/complete")
def complete_exchange_offer():
    try:
        data = request.get_json(force=True)
        offer = exchange.confirm_trade_complete(
            offer_id=data.get("offer_id") or data.get("offerId"),
            caller_address=data.get("caller_address") or data.get("callerAddress"),
        )
        if offer["status"] == "completed":
            achievements.check_and_award(offer["creator_address"], "first_trade", node.blockchain)
            if offer.get("acceptor_address"):
                achievements.check_and_award(offer["acceptor_address"], "first_trade", node.blockchain)
            storage.save_achievements(achievements)
        storage.save_exchange(exchange)
        return jsonify({"success": True, "offer": offer})
    except Exception as exc:
        vorliq_logger.error("Exchange complete endpoint failed: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 400


@app.post("/exchange/record-vlq-tx")
def record_exchange_vlq_tx():
    try:
        data = request.get_json(force=True)
        offer = exchange.record_vlq_tx(
            offer_id=data.get("offer_id") or data.get("offerId"),
            tx_id=data.get("tx_id") or data.get("txId"),
            caller_address=data.get("caller_address") or data.get("callerAddress"),
            blockchain=node.blockchain,
        )
        storage.save_exchange(exchange)
        return jsonify({"success": True, "offer": offer, "vlq_tx_id": offer.get("vlq_tx_id")})
    except Exception as exc:
        vorliq_logger.error("Exchange record VLQ tx endpoint failed: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 400


@app.post("/exchange/confirm-complete")
def confirm_exchange_complete():
    try:
        data = request.get_json(force=True)
        offer = exchange.confirm_trade_complete(
            offer_id=data.get("offer_id") or data.get("offerId"),
            caller_address=data.get("caller_address") or data.get("callerAddress"),
        )
        if offer["status"] == "completed":
            achievements.check_and_award(offer["creator_address"], "first_trade", node.blockchain)
            if offer.get("acceptor_address"):
                achievements.check_and_award(offer["acceptor_address"], "first_trade", node.blockchain)
            storage.save_achievements(achievements)
        storage.save_exchange(exchange)
        return jsonify({"success": True, "offer": offer})
    except Exception as exc:
        vorliq_logger.error("Exchange confirm complete endpoint failed: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 400


@app.post("/exchange/dispute")
def dispute_exchange_offer():
    try:
        data = request.get_json(force=True)
        offer = exchange.open_dispute(
            offer_id=data.get("offer_id") or data.get("offerId"),
            caller_address=data.get("caller_address") or data.get("callerAddress"),
            reason=_require_text(data.get("reason"), "dispute reason", 1000),
        )
        storage.save_exchange(exchange)
        return jsonify({"success": True, "offer": offer})
    except Exception as exc:
        vorliq_logger.error("Exchange dispute endpoint failed: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 400


@app.post("/exchange/cancel")
def cancel_exchange_offer():
    try:
        data = request.get_json(force=True)
        offer = exchange.cancel_offer(
            offer_id=data.get("offer_id") or data.get("offerId"),
            caller_address=data.get("caller_address") or data.get("callerAddress"),
        )
        storage.save_exchange(exchange)
        return jsonify({"success": True, "offer": offer})
    except Exception as exc:
        vorliq_logger.error("Exchange cancel endpoint failed: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 400


@app.post("/forum/post")
def create_forum_post():
    try:
        data = _json_body()
        post_id = forum.create_post(
            author_address=_require_text(data.get("author_address") or data.get("authorAddress"), "author address", 160),
            title=_require_text(data.get("title"), "title", MAX_TEXT_LENGTHS["forum_title"]),
            body=_require_text(data.get("body"), "body", MAX_TEXT_LENGTHS["forum_body"]),
            category=_require_enum(data.get("category", "general"), "category", Forum.VALID_CATEGORIES),
            image_data=data.get("image_data") or data.get("imageData"),
        )
        storage.save_forum(forum)
        return jsonify({"success": True, "post_id": post_id, "post": forum.get_post(post_id)}), 201
    except Exception as exc:
        vorliq_logger.error("Forum post endpoint failed: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 400


@app.get("/forum/posts")
def get_forum_posts():
    try:
        limit, offset = _pagination()
        posts, total, has_more = _page([_public_forum_post(post) for post in forum.get_all_posts()], limit, offset)
        return jsonify({"success": True, "posts": posts, "total": total, "limit": limit, "offset": offset, "has_more": has_more})
    except ValueError as exc:
        return jsonify({"success": False, "message": str(exc)}), 400


@app.get("/forum/featured")
def get_featured_forum_posts():
    try:
        limit, offset = _pagination()
        posts, total, has_more = _page([_public_forum_post(post) for post in forum.get_featured_posts()], limit, offset)
        return jsonify({"success": True, "posts": posts, "total": total, "limit": limit, "offset": offset, "has_more": has_more})
    except ValueError as exc:
        return jsonify({"success": False, "message": str(exc)}), 400


@app.get("/forum/search")
def search_forum_posts():
    try:
        query = request.args.get("q", "")
        limit, offset = _pagination()
        posts, total, has_more = _page([_public_forum_post(post) for post in forum.search_posts(query)], limit, offset)
        return jsonify({"success": True, "posts": posts, "total": total, "limit": limit, "offset": offset, "has_more": has_more})
    except Exception as exc:
        vorliq_logger.error("Forum search endpoint failed: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 400


@app.get("/forum/post")
def get_forum_post():
    post_id = request.args.get("post_id", "")
    post = forum.get_post(post_id)
    if not post:
        return jsonify({"success": False, "error": "post does not exist"}), 404
    return jsonify({"success": True, "post": _public_forum_post(post)})


@app.post("/forum/reply")
def reply_to_forum_post():
    try:
        data = _json_body()
        reply = forum.add_reply(
            post_id=_require_text(data.get("post_id") or data.get("postId"), "post ID", 128),
            author_address=_require_text(data.get("author_address") or data.get("authorAddress"), "author address", 160),
            body=_require_text(data.get("body"), "reply", MAX_TEXT_LENGTHS["forum_reply"]),
            image_data=data.get("image_data") or data.get("imageData"),
        )
        storage.save_forum(forum)
        return jsonify({"success": True, "reply": reply}), 201
    except Exception as exc:
        vorliq_logger.error("Forum reply endpoint failed: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 400


@app.post("/forum/upvote")
def upvote_forum_post():
    try:
        data = _json_body()
        post = forum.upvote_post(
            post_id=_require_text(data.get("post_id") or data.get("postId"), "post ID", 128),
            address=_require_text(data.get("address"), "wallet address", 160),
        )
        storage.save_forum(forum)
        return jsonify({"success": True, "post": post})
    except Exception as exc:
        vorliq_logger.error("Forum upvote endpoint failed: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 400


@app.post("/forum/feature")
def feature_forum_post():
    try:
        data = _json_body()
        post = forum.feature_post(
            post_id=_require_text(data.get("post_id") or data.get("postId"), "post ID", 128),
            voter_address=_require_text(data.get("voter_address") or data.get("voterAddress"), "voter address", 160),
        )
        storage.save_forum(forum)
        return jsonify({"success": True, "post": post})
    except Exception as exc:
        vorliq_logger.error("Forum feature endpoint failed: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 400


def _admin_bool(value: object, field_name: str) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str) and value.lower() in {"true", "false"}:
        return value.lower() == "true"
    raise ValueError(f"{field_name} must be a boolean")


@app.post("/forum/admin/pin")
def admin_pin_forum_post():
    unauthorized = _require_admin_request()
    if unauthorized:
        return unauthorized
    try:
        data = _json_body()
        post = forum.set_pinned(
            post_id=_require_text(data.get("post_id") or data.get("postId"), "post ID", 128),
            pinned=_admin_bool(data.get("pinned"), "pinned"),
        )
        storage.save_forum(forum)
        return jsonify({"success": True, "post": post})
    except Exception as exc:
        vorliq_logger.error("Forum admin pin endpoint failed: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 400


@app.post("/forum/admin/feature")
def admin_feature_forum_post():
    unauthorized = _require_admin_request()
    if unauthorized:
        return unauthorized
    try:
        data = _json_body()
        post = forum.set_featured(
            post_id=_require_text(data.get("post_id") or data.get("postId"), "post ID", 128),
            featured=_admin_bool(data.get("featured"), "featured"),
        )
        storage.save_forum(forum)
        return jsonify({"success": True, "post": post})
    except Exception as exc:
        vorliq_logger.error("Forum admin feature endpoint failed: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 400


@app.get("/forum/admin/posts")
def admin_get_forum_posts():
    unauthorized = _require_admin_request()
    if unauthorized:
        return unauthorized
    try:
        limit, offset = _pagination()
        posts, total, has_more = _page([_public_forum_post(post, include_hidden_replies=True) for post in forum.get_all_posts(include_hidden=True)], limit, offset)
        return jsonify({"success": True, "posts": posts, "total": total, "limit": limit, "offset": offset, "has_more": has_more})
    except ValueError as exc:
        return jsonify({"success": False, "message": str(exc)}), 400


@app.post("/forum/admin/moderate")
def admin_moderate_forum_content():
    unauthorized = _require_admin_request()
    if unauthorized:
        return unauthorized
    try:
        data = _json_body()
        target_type = _require_enum(data.get("target_type") or data.get("targetType") or "post", "target type", {"post", "reply"})
        status = _require_enum(data.get("status"), "moderation status", {"visible", "hidden", "locked"})
        reason = data.get("reason") or ""
        if target_type == "post":
            item = forum.set_post_moderation(
                post_id=_require_text(data.get("post_id") or data.get("postId"), "post ID", 128),
                status=status,
                reason=reason,
            )
        else:
            item = forum.set_reply_moderation(
                post_id=_require_text(data.get("post_id") or data.get("postId"), "post ID", 128),
                reply_id=_require_text(data.get("reply_id") or data.get("replyId"), "reply ID", 128),
                status=status,
                reason=reason,
            )
        storage.save_forum(forum)
        return jsonify({"success": True, "item": item})
    except Exception as exc:
        vorliq_logger.error("Forum admin moderation endpoint failed: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 400


def _retired_forum_tip_response():
    return jsonify({
        "success": False,
        "message": "Forum tipping by private key has been retired. Use saved-wallet local signing flows only.",
        "error": {"code": "FORUM_TIPPING_RETIRED"},
    }), 410


@app.post("/forum/tip/post")
def tip_forum_post():
    return _retired_forum_tip_response()


@app.post("/forum/tip/reply")
def tip_forum_reply():
    return _retired_forum_tip_response()


@app.post("/governance/propose")
def create_governance_proposal():
    try:
        data = _json_body()
        category = _require_enum(data.get("category"), "category", governance.valid_categories)
        if category == "general":
            parameter_value = _require_text(data.get("parameter"), "parameter value", MAX_TEXT_LENGTHS["proposal_parameter"])
        else:
            parameter_value = data.get("parameter")
        proposal_id = governance.create_proposal(
            proposer_address=_require_text(data.get("proposer_address") or data.get("proposerAddress"), "proposer address", 160),
            title=_require_text(data.get("title"), "title", MAX_TEXT_LENGTHS["proposal_title"]),
            description=_require_text(data.get("description"), "description", MAX_TEXT_LENGTHS["proposal_description"]),
            category=category,
            parameter_value=parameter_value,
            current_blockchain=node.blockchain,
        )
        storage.save_governance(governance)
        return jsonify({"success": True, "proposal_id": proposal_id, "proposal": governance.get_proposal(proposal_id)}), 201
    except Exception as exc:
        vorliq_logger.error("Governance propose endpoint failed: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 400


@app.get("/governance/proposals")
def get_active_governance_proposals():
    _expire_governance_if_needed()
    try:
        limit, offset = _pagination()
        status = request.args.get("status")
        category = request.args.get("category")
        address = request.args.get("address")
        if status or category or address:
            proposal_records = governance.get_proposals(status=status, category=category, address=address)
        else:
            proposal_records = governance.get_active_proposals()
        proposals, total, has_more = _page(proposal_records, limit, offset)
        return jsonify({"success": True, "proposals": proposals, "total": total, "limit": limit, "offset": offset, "has_more": has_more})
    except ValueError as exc:
        return jsonify({"success": False, "message": str(exc)}), 400


@app.get("/governance/all")
def get_all_governance_proposals():
    _expire_governance_if_needed()
    try:
        limit, offset = _pagination()
        status = request.args.get("status")
        category = request.args.get("category")
        address = request.args.get("address")
        proposal_records = governance.get_proposals(status=status, category=category, address=address)
        proposals, total, has_more = _page(proposal_records, limit, offset)
        return jsonify({"success": True, "proposals": proposals, "total": total, "limit": limit, "offset": offset, "has_more": has_more})
    except ValueError as exc:
        return jsonify({"success": False, "message": str(exc)}), 400


@app.get("/governance/proposal")
def get_governance_proposal():
    _expire_governance_if_needed()
    proposal_id = request.args.get("proposal_id", "")
    proposal = governance.get_proposal(proposal_id)
    if not proposal:
        return jsonify({"success": False, "error": "proposal does not exist"}), 404
    return jsonify({"success": True, "proposal": proposal})


@app.get("/governance/my")
def get_my_governance():
    _expire_governance_if_needed()
    try:
        address = _require_text(request.args.get("address"), "address", 160)
        return jsonify({"success": True, **governance.get_my_governance(address)})
    except ValueError as exc:
        return jsonify({"success": False, "message": str(exc)}), 400


@app.get("/governance/summary")
def get_governance_summary():
    _expire_governance_if_needed()
    _current_governance_settings()
    return jsonify({"success": True, "summary": governance.get_summary()})


@app.post("/governance/vote")
def vote_on_governance_proposal():
    try:
        data = request.get_json(force=True)
        proposal_id = data.get("proposal_id") or data.get("proposalId")
        voter_address = _require_public_wallet_address(
            data.get("voter_address") or data.get("voterAddress"),
            "voter address",
        )
        voter_wallet_address = (
            data.get("voter_wallet_address") or data.get("voterWalletAddress") or voter_address
        )
        voter_wallet_address = _require_public_wallet_address(voter_wallet_address, "voter wallet address")
        if voter_wallet_address != voter_address:
            raise ValueError("voter wallet address must match voter address")
        if data.get("voter_balance") is not None or data.get("voterBalance") is not None:
            raise ValueError("voter balance is derived by the server")
        voter_balance = node.blockchain.get_balance(voter_address)
        proposal = governance.vote_on_proposal(
            proposal_id=proposal_id,
            voter_address=voter_address,
            vote=data["vote"],
            voter_vlq_balance=voter_balance,
            current_blockchain=node.blockchain,
        )
        achievements.check_and_award(voter_address, "first_vote", node.blockchain)
        storage.save_governance(governance)
        storage.save_chain(node.blockchain)
        _rebuild_indexes(save=True)
        storage.save_achievements(achievements)
        # Opt-in: if this vote concluded the proposal, tell everyone who voted.
        # A concluded proposal accepts no further votes, so this fires once.
        terminal = {"passed_pending_execution": "passed", "executed": "passed", "rejected": "been rejected"}
        outcome = terminal.get(proposal.get("status"))
        if outcome:
            for voter in (proposal.get("votes") or {}).keys():
                _emit_notification(voter, "governance_concluded", {"title": proposal.get("title"), "outcome": outcome})
        return jsonify({"success": True, "proposal": proposal})
    except Exception as exc:
        vorliq_logger.error("Governance vote endpoint failed: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 400


@app.post("/governance/cancel")
def cancel_governance_proposal():
    try:
        data = _json_body()
        proposal = governance.cancel_proposal(
            proposal_id=data.get("proposal_id") or data.get("proposalId"),
            proposer_address=data.get("proposer_address") or data.get("proposerAddress"),
        )
        storage.save_governance(governance)
        return jsonify({"success": True, "proposal": proposal})
    except Exception as exc:
        vorliq_logger.error("Governance cancel endpoint failed: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 400


@app.get("/notifications/preferences")
def get_notification_preferences():
    try:
        address = _require_public_wallet_address(
            request.args.get("address") or request.args.get("walletAddress"), "wallet address"
        )
        # Returns the masked email and event toggles only — never the raw address,
        # so an unauthenticated read can't harvest members' emails.
        return jsonify({"success": True, "preferences": notifications.get_preferences(address)})
    except ValueError as exc:
        return jsonify({"success": False, "message": str(exc)}), 400


@app.post("/notifications/preferences")
def set_notification_preferences():
    try:
        data = _json_body()
        # This route is in AUTHORITY_ROUTES: the before_request gate already proved
        # control of the wallet, so use the proven wallet as the storage key rather
        # than trusting a body field.
        proven = (getattr(request, "signed_authorization", None) or {}).get("wallet")
        wallet = _require_public_wallet_address(
            proven or data.get("wallet_address") or data.get("walletAddress"), "wallet address"
        )
        events = data.get("events") or {}
        # A present email (including an empty string, which clears) updates the
        # address; an absent email key keeps the saved one and only edits toggles.
        if data.get("email") is not None:
            preferences = notifications.set_preferences(wallet, email=data.get("email"), events=events)
        else:
            preferences = notifications.update_events(wallet, events=events)
        storage.save_notifications(notifications)
        return jsonify({"success": True, "preferences": preferences})
    except ValueError as exc:
        return jsonify({"success": False, "message": str(exc)}), 400
    except Exception as exc:  # noqa: BLE001
        vorliq_logger.error("Notification preferences endpoint failed: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 400


@app.get("/governance/settings")
def get_governance_settings():
    return jsonify({"success": True, "settings": _current_governance_settings()})


@app.get("/governance/rule-changes")
def get_governance_rule_changes():
    try:
        limit, offset = _pagination(default_limit=25)
        records = governance.get_rule_changes()
        rule_changes, total, has_more = _page(records, limit, offset)
        return jsonify({"success": True, "rule_changes": rule_changes, "total": total, "limit": limit, "offset": offset, "has_more": has_more})
    except ValueError as exc:
        return jsonify({"success": False, "message": str(exc)}), 400


@app.get("/governance/settings/history")
def get_governance_settings_history():
    try:
        limit, offset = _pagination(default_limit=25)
        records = governance.get_settings_history()
        history, total, has_more = _page(records, limit, offset)
        return jsonify({"success": True, "history": history, "rule_changes": history, "total": total, "limit": limit, "offset": offset, "has_more": has_more})
    except ValueError as exc:
        return jsonify({"success": False, "message": str(exc)}), 400


@app.get("/analytics/usage")
def get_analytics_usage():
    """Windowed product-usage counts for the admin Usage tab, computed from the
    chain and the community stores (governance, lending, forum, faucet). Returns
    the same metrics for the last 7 and 30 days. Read-only and derived from data
    the node already holds; the Node admin layer guards it behind the admin token
    and adds the analytics-derived top pages."""
    now = time.time()
    excluded = set(SYSTEM_ADDRESSES) | {TREASURY_ADDRESS}
    windows = {"7d": now - 7 * 86400, "30d": now - 30 * 86400}

    # One pass over the chain per metric group, reused for both windows.
    chain_txs = []  # (timestamp, sender, receiver)
    for block in node.blockchain.chain:
        block_ts = float(getattr(block, "timestamp", 0) or 0)
        for raw_tx in (block.transactions or []):
            tx = raw_tx if isinstance(raw_tx, dict) else raw_tx.to_dict()
            ts = float(tx.get("timestamp") or block_ts)
            sender = tx.get("sender_address") or tx.get("sender")
            receiver = tx.get("receiver_address") or tx.get("recipient")
            chain_txs.append((ts, sender, receiver))

    def window_stats(cutoff: float) -> dict:
        active: set[str] = set()
        submitted = 0
        for ts, sender, receiver in chain_txs:
            if ts < cutoff:
                continue
            # "Transactions submitted" = user-originated transfers, excluding
            # system-minted mining/treasury rewards.
            if sender and sender not in excluded:
                submitted += 1
            for addr in (sender, receiver):
                if addr and addr not in excluded:
                    active.add(addr)
        faucet_claims = sum(
            1
            for claim in faucet.claims.values()
            if claim.get("tx_id") and float(claim.get("requested_at") or 0) >= cutoff
        )
        governance_proposals = sum(
            1
            for proposal in governance.proposals.values()
            if float(proposal.get("created_at") or proposal.get("timestamp") or 0) >= cutoff
        )
        lending_requests = sum(
            1
            for loan in lending_pool.get_all_loans()
            if float(loan.get("created_at") or loan.get("timestamp") or 0) >= cutoff
        )
        forum_posts = sum(
            1
            for post in forum.get_all_posts(include_hidden=True)
            if float(post.get("timestamp") or 0) >= cutoff
        )
        return {
            "unique_active_wallets": len(active),
            "total_transactions": submitted,
            "faucet_claims": faucet_claims,
            "governance_proposals": governance_proposals,
            "lending_requests": lending_requests,
            "forum_posts": forum_posts,
        }

    return jsonify(
        {
            "success": True,
            "generated_at": now,
            "7d": window_stats(windows["7d"]),
            "30d": window_stats(windows["30d"]),
        }
    )


@app.get("/community/stats")
def get_community_stats():
    """Public, no-auth community statistics: the live network summary plus the top
    miners and top lenders. Everything here is already derivable from the public
    chain; this endpoint just assembles it in one pass so the community page can
    poll a single URL."""
    try:
        now = time.time()
        thirty_days_ago = now - 30 * 86400
        excluded = set(SYSTEM_ADDRESSES) | {TREASURY_ADDRESS}
        chain_summary = node.blockchain.get_chain_summary()

        miner_blocks: dict[str, int] = {}
        miner_rewards: dict[str, float] = {}
        active_wallets: set[str] = set()
        total_transactions = 0

        for block in node.blockchain.chain:
            miner = getattr(block, "miner_address", None)
            if miner and miner not in excluded:
                miner_blocks[miner] = miner_blocks.get(miner, 0) + 1
            block_ts = float(getattr(block, "timestamp", 0) or 0)
            for raw_tx in (block.transactions or []):
                tx = raw_tx if isinstance(raw_tx, dict) else raw_tx.to_dict()
                total_transactions += 1
                category = tx.get("category") or tx.get("type")
                sender = tx.get("sender_address") or tx.get("sender")
                receiver = tx.get("receiver_address") or tx.get("recipient")
                amount = float(tx.get("amount") or 0)
                ts = float(tx.get("timestamp") or block_ts)
                if category == "mining_reward" and receiver and receiver not in excluded:
                    miner_rewards[receiver] = miner_rewards.get(receiver, 0.0) + amount
                if ts >= thirty_days_ago:
                    for addr in (sender, receiver):
                        if addr and addr not in excluded:
                            active_wallets.add(addr)

        top_miners = sorted(
            (
                {"address": a, "blocks": c, "rewards": round(miner_rewards.get(a, 0.0), 8)}
                for a, c in miner_blocks.items()
            ),
            key=lambda r: (r["blocks"], r["rewards"]),
            reverse=True,
        )[:10]

        # Top lenders: members who voted to fund loans that were actually funded.
        # Vorliq lending is community-funded — members vote "yes" to approve a loan
        # from the shared pool — so the funders are the yes-voters on funded loans.
        funded_statuses = {"approved_pending_issue", "active", "repaid", "overdue", "repayment_pending"}
        lender_counts: dict[str, int] = {}
        for loan in lending_pool.get_all_loans():
            if loan.get("status") in funded_statuses:
                for voter, vote in (loan.get("votes") or {}).items():
                    if vote == "yes" and voter and voter not in excluded:
                        lender_counts[voter] = lender_counts.get(voter, 0) + 1
        top_lenders = sorted(
            ({"address": a, "loans_funded": c} for a, c in lender_counts.items()),
            key=lambda r: r["loans_funded"],
            reverse=True,
        )[:10]

        gov = governance.get_summary()
        # Concluded = reached a terminal outcome (not still open or awaiting execution).
        concluded = (
            int(gov.get("executed_count", 0))
            + int(gov.get("rejected_count", 0))
            + int(gov.get("cancelled_count", 0))
            + int(gov.get("expired_count", 0))
        )

        lending_summary = lending_pool.get_summary()
        total_value_locked = float(lending_summary.get("total_vlq_active", 0) or 0)

        return jsonify(
            {
                "success": True,
                "summary": {
                    "total_blocks": chain_summary.get("total_blocks"),
                    "total_transactions": total_transactions,
                    "total_vlq_in_circulation": chain_summary.get("total_issued"),
                    "active_wallets_30d": len(active_wallets),
                    "registered_nodes": len(node_registry.registered_nodes),
                    "total_value_locked": total_value_locked,
                    "governance_proposals_concluded": concluded,
                },
                "top_miners": top_miners,
                "top_lenders": top_lenders,
            }
        )
    except Exception as exc:
        vorliq_logger.error("Community stats endpoint failed: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 500


@app.get("/leaderboard")
def get_leaderboard():
    try:
        limit, offset = _pagination(default_limit=20)
        excluded_addresses = set(SYSTEM_ADDRESSES) | {TREASURY_ADDRESS}
        index_payload = node.blockchain.get_indexes().indexes
        balances = {
            address: float(value)
            for address, value in index_payload.get("confirmed_balances_by_address", {}).items()
        }
        miners = {
            address: int(stats.get("blocks_mined", 0))
            for address, stats in index_payload.get("miner_stats", {}).items()
        }
        lenders: dict[str, int] = {}

        for loan in lending_pool.get_all_loans():
            if loan.get("status") == "repaid" and loan.get("requester_address"):
                address = loan["requester_address"]
                lenders[address] = lenders.get(address, 0) + 1

        def ranked(mapping: dict[str, float | int], positive_only: bool = False) -> tuple[list[dict], int, bool]:
            rows = [
                {"address": address, "value": value}
                for address, value in mapping.items()
                if address and address not in excluded_addresses and (not positive_only or float(value) > 0)
            ]
            rows.sort(key=lambda row: float(row["value"]), reverse=True)
            page_rows, total_rows, has_more_rows = _page(rows, limit, offset)
            return page_rows, total_rows, has_more_rows

        holders, holders_total, holders_more = ranked(balances, positive_only=True)
        top_miners, miners_total, miners_more = ranked(miners)
        top_lenders, lenders_total, lenders_more = ranked(lenders)

        return jsonify(
            {
                "success": True,
                "limit": limit,
                "offset": offset,
                "holders": holders,
                "miners": top_miners,
                "lenders": top_lenders,
                "totals": {
                    "holders": holders_total,
                    "miners": miners_total,
                    "lenders": lenders_total,
                },
                "has_more": {
                    "holders": holders_more,
                    "miners": miners_more,
                    "lenders": lenders_more,
                },
            }
        )
    except ValueError as exc:
        return jsonify({"success": False, "message": str(exc)}), 400


if __name__ == "__main__":
    vorliq_logger.info("Starting Vorliq Flask blockchain API on %s:%s", VORLIQ_HOST, VORLIQ_PORT)
    # Join the network (discover peers + adopt the canonical chain) before we
    # start mining, so a fresh node builds on the network's chain rather than its
    # own genesis. Both run in daemon threads; only started for the running
    # service, never on import (so tests are unaffected).
    start_network_join()
    # Keep the chain alive even when no member is mining.
    if mining_enabled():
        start_background_miner()
    else:
        vorliq_logger.info("Background miner not started: mining is disabled on this node")
    # threaded=True lets independent read requests be served in parallel instead
    # of queuing behind a single request thread; the readers-writer lock above
    # keeps state-mutating requests mutually exclusive so shared chain state is
    # never updated by two requests at once. Configurable only so the concurrency
    # behaviour can be A/B measured; production should always run threaded.
    threaded = os.environ.get("VORLIQ_THREADED", "1") != "0"
    app.run(host=VORLIQ_HOST, port=VORLIQ_PORT, debug=False, threaded=threaded)
