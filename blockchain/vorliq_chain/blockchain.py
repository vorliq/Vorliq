from __future__ import annotations

from .block import Block
from .consensus import ProofOfWorkConsensus
from .transaction import Transaction


class Blockchain:
    def __init__(self) -> None:
        self.consensus = ProofOfWorkConsensus()
        self.pending_transactions: list[dict] = []
        self.chain: list[Block] = [self._create_genesis_block()]

    def _create_genesis_block(self) -> Block:
        block = Block(
            index=0,
            transactions=[],
            previous_hash="0",
        )
        return self.consensus.mine(block)

    @property
    def latest_block(self) -> Block:
        return self.chain[-1]

    def add_transaction(self, transaction: Transaction) -> str:
        self.pending_transactions.append(transaction.to_dict())
        return transaction.id()

    def mine_pending_transactions(self) -> Block:
        block = Block(
            index=len(self.chain),
            transactions=self.pending_transactions,
            previous_hash=self.latest_block.hash(),
        )
        mined_block = self.consensus.mine(block)
        self.chain.append(mined_block)
        self.pending_transactions = []
        return mined_block

    def is_valid(self) -> bool:
        for index in range(1, len(self.chain)):
            current = self.chain[index]
            previous = self.chain[index - 1]

            if current.previous_hash != previous.hash():
                return False

            if not self.consensus.is_valid_block(current):
                return False

        return True

    def to_dict(self) -> dict:
        return {
            "coin": "VLQ",
            "valid": self.is_valid(),
            "pending_transactions": self.pending_transactions,
            "chain": [block.to_dict() | {"hash": block.hash()} for block in self.chain],
        }
