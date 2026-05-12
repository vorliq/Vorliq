from flask import Flask, jsonify, request

from vorliq_chain import Blockchain, Transaction, Wallet

app = Flask(__name__)
chain = Blockchain()


@app.get("/health")
def health():
    return jsonify({"status": "ok", "coin": "VLQ"})


@app.get("/chain")
def get_chain():
    return jsonify(chain.to_dict())


@app.post("/transactions")
def create_transaction():
    data = request.get_json(force=True)
    transaction = Transaction(
        sender=data["sender"],
        recipient=data["recipient"],
        amount=float(data["amount"]),
        memo=data.get("memo", ""),
    )
    transaction_id = chain.add_transaction(transaction)
    return jsonify({"transaction_id": transaction_id}), 201


@app.post("/mine")
def mine_block():
    block = chain.mine_pending_transactions()
    return jsonify(block.to_dict() | {"hash": block.hash()})


@app.post("/wallets")
def create_wallet():
    wallet = Wallet.create()
    return jsonify({"address": wallet.address, "public_key": wallet.public_key_pem}), 201


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
