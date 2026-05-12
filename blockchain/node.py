from __future__ import annotations

from typing import Any

from blockchain import Blockchain
from transaction import Transaction


class Node:
    def __init__(self) -> None:
        self.blockchain = Blockchain()

    def get_full_chain(self) -> dict[str, Any]:
        return self.blockchain.to_dict()

    def get_pending_transactions(self) -> list[dict[str, Any]]:
        return self.blockchain.get_pending_transactions()

    def submit_transaction(self, transaction: Transaction | dict[str, Any]) -> bool:
        if isinstance(transaction, dict):
            transaction = Transaction.from_dict(transaction)
        return self.blockchain.add_pending_transaction(transaction)

    def mine_new_block(self, miner_address: str) -> dict[str, Any]:
        block = self.blockchain.mine_pending_transactions(miner_address)
        return block.to_dict()

    def get_balance(self, address: str) -> dict[str, Any]:
        return {
            "address": address,
            "coin": "VLQ",
            "balance": self.blockchain.get_balance(address),
        }
