from flask import Flask, jsonify, request

from block import Block
from blockchain import Blockchain
from network import Network
from node import Node
from transaction import Transaction
from wallet import Wallet

app = Flask(__name__)
node = Node()
network = Network()
_imports_ready = (Block, Blockchain, Transaction)


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
        if not data.get("_broadcasted"):
            network.broadcast_transaction({**transaction.to_dict(), "_broadcasted": True})
        return jsonify({"success": True, "message": "Transaction added to pending pool"}), 201
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 400


@app.post("/mine")
def mine_block():
    try:
        data = request.get_json(force=True)
        miner_address = data.get("miner_address") or data.get("minerAddress")
        block = node.mine_new_block(miner_address)
        network.broadcast_block(block)
        return jsonify({"success": True, "block": block}), 201
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 400


@app.post("/wallet")
def create_wallet():
    wallet = Wallet()
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
        return jsonify({"error": str(exc)}), 400


@app.get("/economics")
def get_economics():
    return jsonify(node.get_token_economics())


@app.post("/peers/register")
def register_peer():
    try:
        data = request.get_json(force=True)
        network.register_peer(data["peer"])
        network.discover_peers(network.get_peers())
        return jsonify({"success": True, "peers": network.get_peers()}), 201
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 400


@app.get("/peers")
def get_peers():
    return jsonify({"peers": network.get_peers()})


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
            return jsonify({"success": True, "message": "Block accepted"}), 201

        updated = network.sync_chain(node.blockchain)
        return jsonify(
            {
                "success": False,
                "message": "Received block was not valid for the local chain",
                "chain_updated": updated,
            }
        ), 409
    except Exception as exc:
        updated = network.sync_chain(node.blockchain)
        return jsonify({"success": False, "error": str(exc), "chain_updated": updated}), 400


@app.get("/peers/sync")
def sync_peers():
    updated = network.sync_chain(node.blockchain)
    return jsonify(
        {
            "success": True,
            "updated": updated,
            "message": "Chain updated to a longer network chain"
            if updated
            else "Your chain is already the longest",
            "chain_height": node.blockchain.get_block_height(),
        }
    )


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5001, debug=False)
