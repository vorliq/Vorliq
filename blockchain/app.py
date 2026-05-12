from flask import Flask, jsonify, request

from block import Block
from blockchain import Blockchain
from node import Node
from transaction import Transaction
from wallet import Wallet

app = Flask(__name__)
node = Node()
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
        return jsonify({"success": True, "message": "Transaction added to pending pool"}), 201
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 400


@app.post("/mine")
def mine_block():
    try:
        data = request.get_json(force=True)
        miner_address = data.get("miner_address") or data.get("minerAddress")
        block = node.mine_new_block(miner_address)
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


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5001, debug=False)
