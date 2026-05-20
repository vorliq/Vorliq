import ipaddress
import os
import time
from urllib.parse import urlparse

from flask import Flask, jsonify, request

from achievements import Achievements
from block import Block
from blockchain import Blockchain, MiningCooldownError
from exchange import Exchange
from faucet import Faucet
from forum import Forum
from governance import Governance
from lending import LendingPool
from logger import vorliq_logger
from network import Network
from node import Node
from price import PriceDiscovery
from profiles import Profiles
from registry import NodeRegistry
from storage import Storage
from transaction import SYSTEM_ADDRESSES, TREASURY_ADDRESS, Transaction
from treasury import Treasury
from wallet import Wallet, is_reserved_address, validate_address

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
storage = Storage(os.environ.get("VORLIQ_DATA_DIR"))
node = Node()
saved_blockchain = storage.load_chain()
if saved_blockchain:
    node.blockchain = saved_blockchain
    vorliq_logger.info("Flask startup restored saved blockchain with height %s", node.blockchain.get_block_height())
else:
    vorliq_logger.info("Flask startup created fresh blockchain with height %s", node.blockchain.get_block_height())

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
vorliq_logger.info("Flask startup restored %s exchange offers", len(exchange.offers))
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
    return changed


_sync_treasury(save=True)


def _sync_faucet(save: bool = True) -> bool:
    changed = faucet.sync_claim_statuses(node.blockchain)
    if changed and save:
        storage.save_faucet(faucet)
    return changed


_sync_faucet(save=True)


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
    return jsonify({"status": "ok", "coin": "VLQ"})


@app.get("/storage/health")
def storage_health():
    return jsonify(storage.storage_health())


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
        storage.save_achievements(achievements)
        if not data.get("_broadcasted"):
            network.broadcast_transaction({**transaction.to_dict(), "_broadcasted": True})
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


@app.post("/mine")
def mine_block():
    try:
        data = _json_body()
        miner_address = _require_text(data.get("miner_address") or data.get("minerAddress"), "miner address", 160)
        raw_block = node.mine_new_block(miner_address)
        block = node.blockchain.get_block_detail(str(raw_block["index"])) or raw_block
        _sync_lending_pool(save=False)
        _sync_exchange(save=False)
        _sync_treasury(save=False)
        _sync_faucet(save=False)
        storage.save_chain(node.blockchain)
        storage.save_pending(node.blockchain.pending_transactions)
        storage.save_lending_pool(lending_pool)
        storage.save_exchange(exchange)
        storage.save_treasury(treasury)
        storage.save_faucet(faucet)
        achievements.check_and_award(miner_address, "first_mine", node.blockchain)
        achievements.check_and_award(miner_address, "ten_blocks", node.blockchain)
        storage.save_achievements(achievements)
        network.broadcast_block(raw_block)
        return jsonify({"success": True, "block": block}), 201
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
        return jsonify({"success": True, **status, "status": status})
    except Exception as exc:
        vorliq_logger.error("Mining status endpoint failed: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 400


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
            "chain_valid": node.blockchain.is_chain_valid(),
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
                "chain_valid": node.blockchain.is_chain_valid(),
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
            "chain_valid": node.blockchain.is_chain_valid(),
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
            "nodes": node_registry.get_all_nodes(profile_lookup=_registry_profile_lookup),
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
        proposal_id = treasury.create_proposal(
            proposer_address=_require_text(data.get("proposer_address") or data.get("proposerAddress"), "proposer address", 160),
            title=_require_text(data.get("title"), "title", MAX_TEXT_LENGTHS["proposal_title"]),
            description=_require_text(data.get("description"), "description", MAX_TEXT_LENGTHS["proposal_description"]),
            category=_require_enum(data.get("category"), "category", Treasury.VALID_CATEGORIES),
            requested_amount=_require_number(data.get("requested_amount") or data.get("requestedAmount"), "requested amount", 1_000_000),
            recipient_address=_require_text(data.get("recipient_address") or data.get("recipientAddress"), "recipient address", 160),
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
        data = request.get_json(force=True)
        voter_address = data.get("voter_address") or data.get("voterAddress")
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
        storage.save_achievements(achievements)
        return jsonify({"success": True, "proposal": proposal})
    except Exception as exc:
        vorliq_logger.error("Treasury vote endpoint failed: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 400


@app.post("/treasury/cancel")
def cancel_treasury_proposal():
    try:
        data = _json_body()
        proposal = treasury.cancel_proposal(
            proposal_id=data.get("proposal_id") or data.get("proposalId"),
            proposer_address=data.get("proposer_address") or data.get("proposerAddress"),
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
        wallet_address = _require_text(data.get("wallet_address") or data.get("walletAddress"), "wallet address", 160)
        fingerprint_hash = data.get("fingerprint_hash") or data.get("fingerprintHash")
        claim = faucet.request_claim(
            wallet_address=wallet_address,
            treasury_balance=treasury.get_treasury_balance(node.blockchain),
            blockchain=node.blockchain,
            fingerprint_hash=fingerprint_hash,
        )
        storage.save_faucet(faucet)
        storage.save_pending(node.blockchain.pending_transactions)
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
        address = _require_text(request.args.get("address"), "wallet address", 160)
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


@app.post("/receive_block")
def receive_block():
    try:
        data = request.get_json(force=True)
        received_block = Block.from_dict(data)
        latest_block = node.blockchain.get_latest_block()

        if received_block.hash == latest_block.hash:
            return jsonify({"success": True, "message": "Block already exists"}), 200

        valid_previous_hash = received_block.previous_hash == latest_block.hash
        valid_proof = received_block.hash.startswith("0" * node.blockchain.difficulty)

        if valid_previous_hash and valid_proof and node.blockchain.add_block(received_block):
            node.blockchain.prune_pending_transactions(drop_system_rewards=False)
            _sync_lending_pool(save=False)
            _sync_exchange(save=False)
            _sync_treasury(save=False)
            _sync_faucet(save=False)
            storage.save_chain(node.blockchain)
            storage.save_pending(node.blockchain.pending_transactions)
            storage.save_lending_pool(lending_pool)
            storage.save_exchange(exchange)
            storage.save_treasury(treasury)
            storage.save_faucet(faucet)
            return jsonify({"success": True, "message": "Block accepted"}), 201

        updated = network.sync_chain(node.blockchain)
        if updated:
            _sync_lending_pool(save=False)
            _sync_exchange(save=False)
            _sync_treasury(save=False)
            _sync_faucet(save=False)
            storage.save_chain(node.blockchain)
            storage.save_lending_pool(lending_pool)
            storage.save_exchange(exchange)
            storage.save_treasury(treasury)
            storage.save_faucet(faucet)
        return jsonify(
            {
                "success": False,
                "message": "Received block was not valid for the local chain",
                "chain_updated": updated,
            }
        ), 409
    except Exception as exc:
        updated = network.sync_chain(node.blockchain)
        if updated:
            _sync_lending_pool(save=False)
            _sync_exchange(save=False)
            _sync_treasury(save=False)
            _sync_faucet(save=False)
            storage.save_chain(node.blockchain)
            storage.save_lending_pool(lending_pool)
            storage.save_exchange(exchange)
            storage.save_treasury(treasury)
            storage.save_faucet(faucet)
        vorliq_logger.error("Receive block endpoint failed: %s", exc)
        return jsonify({"success": False, "error": str(exc), "chain_updated": updated}), 400


@app.get("/peers/sync")
def sync_peers():
    updated = network.sync_chain(node.blockchain)
    if updated:
        _sync_lending_pool(save=False)
        _sync_exchange(save=False)
        _sync_treasury(save=False)
        _sync_faucet(save=False)
        storage.save_chain(node.blockchain)
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
    return jsonify(
        {
            "success": True,
            "nodes": node_registry.get_all_nodes(
                status=status,
                country=country,
                sync_status=sync_status,
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


@app.post("/registry/heartbeat")
def registry_heartbeat():
    try:
        data = _json_body()
        node_url = _require_public_url(data.get("node_url") or data.get("nodeUrl"), "node URL")
        chain_height = data.get("chain_height") if data.get("chain_height") is not None else data.get("chainHeight")
        chain_valid = data.get("chain_valid") if data.get("chain_valid") is not None else data.get("chainValid")
        if isinstance(chain_valid, str):
            chain_valid = chain_valid.lower() in {"true", "1", "yes", "valid"}
        registry_node = node_registry.heartbeat(
            node_url=node_url,
            public_chain_height=node.blockchain.get_block_height(),
            display_name=data.get("display_name") or data.get("displayName"),
            chain_height=chain_height,
            last_block_hash=data.get("last_block_hash") or data.get("lastBlockHash"),
            chain_valid=chain_valid if isinstance(chain_valid, bool) else None,
            software_version=data.get("software_version") or data.get("softwareVersion"),
            operator_wallet_address=data.get("operator_wallet_address") or data.get("operatorWalletAddress"),
            response_time_ms=data.get("response_time_ms") or data.get("responseTimeMs"),
            region=data.get("region"),
            country=data.get("country"),
        )
        storage.save_registry(node_registry)
        return jsonify({"success": True, "node": registry_node})
    except Exception as exc:
        vorliq_logger.error("Registry heartbeat endpoint failed: %s", exc)
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
        voter_address = data.get("voter_address") or data.get("voterAddress")
        voter_wallet_address = (
            data.get("voter_wallet_address") or data.get("voterWalletAddress") or voter_address
        )

        voter_balance = (
            float(data["voter_balance"])
            if data.get("voter_balance") is not None
            else node.blockchain.get_balance(voter_wallet_address)
        )
        loan = lending_pool.vote_on_loan(
            loan_id=loan_id,
            voter_address=voter_address,
            vote=data["vote"],
            voter_vlq_balance=voter_balance,
        )
        achievements.check_and_award(voter_address, "first_loan", node.blockchain)
        storage.save_lending_pool(lending_pool)
        storage.save_pending(node.blockchain.pending_transactions)
        storage.save_achievements(achievements)
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
        storage.save_achievements(achievements)
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
        posts, total, has_more = _page(forum.get_all_posts(), limit, offset)
        return jsonify({"success": True, "posts": posts, "total": total, "limit": limit, "offset": offset, "has_more": has_more})
    except ValueError as exc:
        return jsonify({"success": False, "message": str(exc)}), 400


@app.get("/forum/featured")
def get_featured_forum_posts():
    try:
        limit, offset = _pagination()
        posts, total, has_more = _page(forum.get_featured_posts(), limit, offset)
        return jsonify({"success": True, "posts": posts, "total": total, "limit": limit, "offset": offset, "has_more": has_more})
    except ValueError as exc:
        return jsonify({"success": False, "message": str(exc)}), 400


@app.get("/forum/search")
def search_forum_posts():
    try:
        query = request.args.get("q", "")
        limit, offset = _pagination()
        posts, total, has_more = _page(forum.search_posts(query), limit, offset)
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
    return jsonify({"success": True, "post": post})


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


@app.post("/forum/tip/post")
def tip_forum_post():
    try:
        data = request.get_json(force=True)
        sender_address = data.get("sender_address") or data.get("senderAddress")
        sender_private_key = data.get("sender_private_key") or data.get("senderPrivateKey")
        receiver_address = data.get("receiver_address") or data.get("receiverAddress")
        amount = float(data["amount"])
        wallet = Wallet.from_private_key_pem(sender_private_key)
        transaction = Transaction(sender_address, receiver_address, amount)
        transaction.sign_transaction(wallet)
        tip = forum.tip_post(
            post_id=data.get("post_id") or data.get("postId"),
            sender_address=sender_address,
            receiver_address=receiver_address,
            amount=amount,
            blockchain=node.blockchain,
            transaction=transaction,
        )
        achievements.check_and_award(sender_address, "first_tip", node.blockchain)
        storage.save_forum(forum)
        storage.save_pending(node.blockchain.pending_transactions)
        storage.save_achievements(achievements)
        return jsonify({"success": True, "tip": tip}), 201
    except Exception as exc:
        vorliq_logger.error("Forum post tip endpoint failed: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 400


@app.post("/forum/tip/reply")
def tip_forum_reply():
    try:
        data = request.get_json(force=True)
        sender_address = data.get("sender_address") or data.get("senderAddress")
        sender_private_key = data.get("sender_private_key") or data.get("senderPrivateKey")
        receiver_address = data.get("receiver_address") or data.get("receiverAddress")
        amount = float(data["amount"])
        wallet = Wallet.from_private_key_pem(sender_private_key)
        transaction = Transaction(sender_address, receiver_address, amount)
        transaction.sign_transaction(wallet)
        tip = forum.tip_reply(
            post_id=data.get("post_id") or data.get("postId"),
            reply_id=data.get("reply_id") or data.get("replyId"),
            sender_address=sender_address,
            receiver_address=receiver_address,
            amount=amount,
            blockchain=node.blockchain,
            transaction=transaction,
        )
        achievements.check_and_award(sender_address, "first_tip", node.blockchain)
        storage.save_forum(forum)
        storage.save_pending(node.blockchain.pending_transactions)
        storage.save_achievements(achievements)
        return jsonify({"success": True, "tip": tip}), 201
    except Exception as exc:
        vorliq_logger.error("Forum reply tip endpoint failed: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 400


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
        voter_address = data.get("voter_address") or data.get("voterAddress")
        voter_wallet_address = (
            data.get("voter_wallet_address") or data.get("voterWalletAddress") or voter_address
        )
        voter_balance = (
            float(data["voter_balance"])
            if data.get("voter_balance") is not None
            else node.blockchain.get_balance(voter_wallet_address)
        )
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
        storage.save_achievements(achievements)
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


@app.get("/leaderboard")
def get_leaderboard():
    try:
        limit, offset = _pagination(default_limit=20)
        excluded_addresses = set(SYSTEM_ADDRESSES) | {TREASURY_ADDRESS}
        balances: dict[str, float] = {}
        miners: dict[str, int] = {}
        lenders: dict[str, int] = {}

        for block in node.blockchain.chain:
            miner_address = getattr(block, "miner_address", None)
            if miner_address and miner_address not in excluded_addresses:
                miners[miner_address] = miners.get(miner_address, 0) + 1

            for transaction in block.transactions or []:
                if isinstance(transaction, dict):
                    transaction = Transaction.from_dict(transaction)
                sender = transaction.sender_address
                receiver = transaction.receiver_address
                amount = float(transaction.amount)
                balances[sender] = balances.get(sender, 0.0) - amount
                balances[receiver] = balances.get(receiver, 0.0) + amount

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
    app.run(host=VORLIQ_HOST, port=VORLIQ_PORT, debug=False)
