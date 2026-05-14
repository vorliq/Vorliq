from flask import Flask, jsonify, request

from block import Block
from blockchain import Blockchain
from lending import LendingPool
from logger import vorliq_logger
from network import Network
from node import Node
from registry import NodeRegistry
from storage import Storage
from transaction import Transaction
from wallet import Wallet

app = Flask(__name__)
storage = Storage()
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
vorliq_logger.info("Flask startup restored %s peers", len(network.peers))

lending_pool = storage.load_lending_pool()
lending_pool.blockchain = node.blockchain
vorliq_logger.info("Flask startup restored %s lending records", len(lending_pool.loan_requests))
node_registry = storage.load_registry()
vorliq_logger.info("Flask startup restored %s registry records", len(node_registry.registered_nodes))
_imports_ready = (Block, Blockchain, Transaction)
LOCAL_NODE_URL = "http://localhost:5001"

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


@app.post("/peers/register")
def register_peer():
    try:
        data = request.get_json(force=True)
        peer = data["peer"]
        network.register_peer(peer)
        network.discover_peers(network.get_peers())
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
            storage.save_chain(node.blockchain)
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


if __name__ == "__main__":
    vorliq_logger.info("Starting Vorliq Flask blockchain API on 127.0.0.1:5001")
    app.run(host="127.0.0.1", port=5001, debug=False)
