import os
import time

from flask import Flask, jsonify, request

from block import Block
from blockchain import Blockchain, MiningCooldownError
from exchange import Exchange
from forum import Forum
from governance import Governance
from lending import LendingPool
from logger import vorliq_logger
from network import Network
from node import Node
from price import PriceDiscovery
from registry import NodeRegistry
from storage import Storage
from transaction import SYSTEM_ADDRESSES, Transaction
from treasury import Treasury
from wallet import Wallet

APP_START_TIME = time.time()
VORLIQ_HOST = os.environ.get("VORLIQ_HOST", "127.0.0.1")
VORLIQ_PORT = int(os.environ.get("VORLIQ_PORT", "5001"))
VORLIQ_ADVERTISED_HOST = "localhost" if VORLIQ_HOST in {"0.0.0.0", "::"} else VORLIQ_HOST
LOCAL_NODE_URL = os.environ.get("VORLIQ_NODE_URL", f"http://{VORLIQ_ADVERTISED_HOST}:{VORLIQ_PORT}")

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
price_discovery = storage.load_price_discovery()
vorliq_logger.info("Flask startup restored %s price signals", len(price_discovery.signals))
_imports_ready = (
    Block,
    Blockchain,
    MiningCooldownError,
    Transaction,
    Exchange,
    Forum,
    Governance,
    Treasury,
    PriceDiscovery,
)

if network.peers:
    network.announce_to_peers(LOCAL_NODE_URL, network.get_peers())


@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return response


@app.get("/health")
def health():
    return jsonify({"status": "ok", "coin": "VLQ"})


@app.get("/chain")
def get_chain():
    return jsonify(node.get_full_chain())


@app.get("/pending")
def get_pending_transactions():
    return jsonify({"pending_transactions": node.get_pending_transactions()})


@app.post("/transaction")
def create_transaction():
    try:
        data = request.get_json(force=True)
        transaction = Transaction.from_dict(data)
        if transaction.sender_address in SYSTEM_ADDRESSES:
            raise ValueError("system-controlled addresses cannot submit public transactions")
        node.submit_transaction(transaction)
        storage.save_pending(node.blockchain.pending_transactions)
        if not data.get("_broadcasted"):
            network.broadcast_transaction({**transaction.to_dict(), "_broadcasted": True})
        return jsonify({"success": True, "message": "Transaction added to pending pool"}), 201
    except Exception as exc:
        vorliq_logger.error("Transaction endpoint failed: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 400


@app.post("/mine")
def mine_block():
    try:
        data = request.get_json(force=True)
        miner_address = data.get("miner_address") or data.get("minerAddress")
        block = node.mine_new_block(miner_address)
        storage.save_chain(node.blockchain)
        storage.save_pending(node.blockchain.pending_transactions)
        storage.save_lending_pool(lending_pool)
        network.broadcast_block(block)
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


@app.post("/wallet")
def create_wallet():
    wallet = Wallet()
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


@app.get("/treasury/balance")
def get_treasury_balance():
    return jsonify(
        {
            "success": True,
            "address": node.blockchain.TREASURY_ADDRESS,
            "balance": treasury.get_treasury_balance(node.blockchain),
            "treasury_percentage": node.blockchain.TREASURY_PERCENTAGE,
        }
    )


@app.get("/treasury/proposals")
def get_treasury_proposals():
    if treasury.expire_proposals():
        storage.save_treasury(treasury)
    return jsonify({"success": True, "proposals": treasury.get_active_proposals()})


@app.get("/treasury/all")
def get_all_treasury_proposals():
    if treasury.expire_proposals():
        storage.save_treasury(treasury)
    return jsonify({"success": True, "proposals": treasury.get_all_proposals()})


@app.post("/treasury/propose")
def create_treasury_proposal():
    try:
        data = request.get_json(force=True)
        proposal_id = treasury.create_proposal(
            proposer_address=data.get("proposer_address") or data.get("proposerAddress"),
            title=data["title"],
            description=data["description"],
            category=data["category"],
            requested_amount=float(data.get("requested_amount") or data.get("requestedAmount")),
            recipient_address=data.get("recipient_address") or data.get("recipientAddress"),
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
        storage.save_treasury(treasury)
        storage.save_pending(node.blockchain.pending_transactions)
        return jsonify({"success": True, "proposal": proposal})
    except Exception as exc:
        vorliq_logger.error("Treasury vote endpoint failed: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 400


@app.post("/price/signal")
def submit_price_signal():
    try:
        data = request.get_json(force=True)
        signal_id = price_discovery.submit_signal(
            submitter_address=data.get("submitter_address") or data.get("submitterAddress"),
            currency=data["currency"],
            price_value=float(data.get("price_value") or data.get("priceValue")),
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
    return jsonify({"success": True, "signals": price_discovery.get_active_signals()})


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


@app.post("/peers/register")
def register_peer():
    try:
        data = request.get_json(force=True)
        peer = data["peer"]
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
        data = request.get_json(force=True)
        node_url = data["node_url"]
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
            storage.save_chain(node.blockchain)
            storage.save_pending(node.blockchain.pending_transactions)
            return jsonify({"success": True, "message": "Block accepted"}), 201

        updated = network.sync_chain(node.blockchain)
        if updated:
            storage.save_chain(node.blockchain)
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
            storage.save_chain(node.blockchain)
        vorliq_logger.error("Receive block endpoint failed: %s", exc)
        return jsonify({"success": False, "error": str(exc), "chain_updated": updated}), 400


@app.get("/peers/sync")
def sync_peers():
    updated = network.sync_chain(node.blockchain)
    if updated:
        storage.save_chain(node.blockchain)
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
        data = request.get_json(force=True)
        node_registry.register_node(
            node_url=data.get("node_url") or data.get("nodeUrl"),
            display_name=data.get("display_name") or data.get("displayName"),
        )
        storage.save_registry(node_registry)
        return jsonify({"success": True, "nodes": node_registry.get_active_nodes()}), 201
    except Exception as exc:
        vorliq_logger.error("Registry register endpoint failed: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 400


@app.get("/registry/nodes")
def get_registry_nodes():
    return jsonify({"success": True, "nodes": node_registry.get_active_nodes()})


@app.post("/registry/heartbeat")
def registry_heartbeat():
    try:
        data = request.get_json(force=True)
        node = node_registry.heartbeat(data.get("node_url") or data.get("nodeUrl"))
        storage.save_registry(node_registry)
        return jsonify({"success": True, "node": node})
    except Exception as exc:
        vorliq_logger.error("Registry heartbeat endpoint failed: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 400


@app.post("/lending/request")
def create_lending_request():
    try:
        data = request.get_json(force=True)
        requester_address = data.get("requester_address") or data.get("requesterAddress")
        loan_id = lending_pool.create_loan_request(
            requester_address=requester_address,
            amount=float(data["amount"]),
            reason=data["reason"],
        )
        storage.save_lending_pool(lending_pool)
        return jsonify({"success": True, "loan_id": loan_id, "loan": lending_pool.get_loan(loan_id)}), 201
    except Exception as exc:
        vorliq_logger.error("Lending request endpoint failed: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 400


@app.get("/lending/loans")
def get_lending_loans():
    return jsonify({"loans": lending_pool.get_all_loans()})


@app.get("/lending/loan")
def get_lending_loan():
    loan_id = request.args.get("loan_id", "")
    loan = lending_pool.get_loan(loan_id)
    if not loan:
        return jsonify({"success": False, "error": "loan does not exist"}), 404
    return jsonify({"success": True, "loan": loan})


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
        storage.save_lending_pool(lending_pool)
        storage.save_pending(node.blockchain.pending_transactions)
        return jsonify({"success": True, "loan": loan})
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
        storage.save_lending_pool(lending_pool)
        storage.save_pending(node.blockchain.pending_transactions)
        return jsonify(
            {
                "success": True,
                "repayment_amount": loan["repayment_amount"],
                "loan": loan,
            }
        )
    except Exception as exc:
        vorliq_logger.error("Lending repay endpoint failed: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 400


@app.post("/exchange/offer")
def create_exchange_offer():
    try:
        data = request.get_json(force=True)
        offer_id = exchange.create_offer(
            creator_address=data.get("creator_address") or data.get("creatorAddress"),
            offer_type=data.get("offer_type") or data.get("offerType"),
            amount=float(data["amount"]),
            price_description=data.get("price") or data.get("price_description") or data.get("priceDescription"),
            detail_description=data.get("description") or data.get("detail_description") or data.get("detailDescription"),
        )
        storage.save_exchange(exchange)
        return jsonify({"success": True, "offer_id": offer_id, "offer": exchange.get_offer(offer_id)}), 201
    except Exception as exc:
        vorliq_logger.error("Exchange offer endpoint failed: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 400


@app.get("/exchange/offers")
def get_exchange_open_offers():
    return jsonify({"success": True, "offers": exchange.get_open_offers()})


@app.get("/exchange/all")
def get_exchange_all_offers():
    return jsonify({"success": True, "offers": exchange.get_all_offers()})


@app.get("/exchange/my")
def get_exchange_my_offers():
    try:
        address = request.args.get("address", "")
        return jsonify({"success": True, "offers": exchange.get_offers_by_address(address)})
    except Exception as exc:
        vorliq_logger.error("Exchange my offers endpoint failed: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 400


@app.post("/exchange/accept")
def accept_exchange_offer():
    try:
        data = request.get_json(force=True)
        offer = exchange.accept_offer(
            offer_id=data.get("offer_id") or data.get("offerId"),
            acceptor_address=data.get("acceptor_address") or data.get("acceptorAddress"),
        )
        storage.save_exchange(exchange)
        return jsonify({"success": True, "offer": offer})
    except Exception as exc:
        vorliq_logger.error("Exchange accept endpoint failed: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 400


@app.post("/exchange/complete")
def complete_exchange_offer():
    try:
        data = request.get_json(force=True)
        offer = exchange.complete_offer(
            offer_id=data.get("offer_id") or data.get("offerId"),
            caller_address=data.get("caller_address") or data.get("callerAddress"),
        )
        storage.save_exchange(exchange)
        return jsonify({"success": True, "offer": offer})
    except Exception as exc:
        vorliq_logger.error("Exchange complete endpoint failed: %s", exc)
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
        data = request.get_json(force=True)
        post_id = forum.create_post(
            author_address=data.get("author_address") or data.get("authorAddress"),
            title=data["title"],
            body=data["body"],
            category=data.get("category", "general"),
        )
        storage.save_forum(forum)
        return jsonify({"success": True, "post_id": post_id, "post": forum.get_post(post_id)}), 201
    except Exception as exc:
        vorliq_logger.error("Forum post endpoint failed: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 400


@app.get("/forum/posts")
def get_forum_posts():
    return jsonify({"success": True, "posts": forum.get_all_posts()})


@app.get("/forum/search")
def search_forum_posts():
    try:
        query = request.args.get("q", "")
        return jsonify({"success": True, "posts": forum.search_posts(query)})
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
        data = request.get_json(force=True)
        reply = forum.add_reply(
            post_id=data.get("post_id") or data.get("postId"),
            author_address=data.get("author_address") or data.get("authorAddress"),
            body=data["body"],
        )
        storage.save_forum(forum)
        return jsonify({"success": True, "reply": reply}), 201
    except Exception as exc:
        vorliq_logger.error("Forum reply endpoint failed: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 400


@app.post("/forum/upvote")
def upvote_forum_post():
    try:
        data = request.get_json(force=True)
        post = forum.upvote_post(
            post_id=data.get("post_id") or data.get("postId"),
            address=data["address"],
        )
        storage.save_forum(forum)
        return jsonify({"success": True, "post": post})
    except Exception as exc:
        vorliq_logger.error("Forum upvote endpoint failed: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 400


@app.post("/governance/propose")
def create_governance_proposal():
    try:
        data = request.get_json(force=True)
        proposal_id = governance.create_proposal(
            proposer_address=data.get("proposer_address") or data.get("proposerAddress"),
            title=data["title"],
            description=data["description"],
            category=data["category"],
            parameter_value=data.get("parameter"),
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
    return jsonify({"success": True, "proposals": governance.get_active_proposals()})


@app.get("/governance/all")
def get_all_governance_proposals():
    _expire_governance_if_needed()
    return jsonify({"success": True, "proposals": governance.get_all_proposals()})


@app.get("/governance/proposal")
def get_governance_proposal():
    _expire_governance_if_needed()
    proposal_id = request.args.get("proposal_id", "")
    proposal = governance.get_proposal(proposal_id)
    if not proposal:
        return jsonify({"success": False, "error": "proposal does not exist"}), 404
    return jsonify({"success": True, "proposal": proposal})


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
        storage.save_governance(governance)
        storage.save_chain(node.blockchain)
        return jsonify({"success": True, "proposal": proposal})
    except Exception as exc:
        vorliq_logger.error("Governance vote endpoint failed: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 400


@app.get("/governance/settings")
def get_governance_settings():
    return jsonify({"success": True, "settings": _current_governance_settings()})


if __name__ == "__main__":
    vorliq_logger.info("Starting Vorliq Flask blockchain API on %s:%s", VORLIQ_HOST, VORLIQ_PORT)
    app.run(host=VORLIQ_HOST, port=VORLIQ_PORT, debug=False)
