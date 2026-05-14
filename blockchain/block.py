from __future__ import annotations

import hashlib
import json
import time
from typing import Any

from logger import vorliq_logger


class Block:
    difficulty = 4

    def __init__(
        self,
        index: int,
        transactions: list[Any],
        previous_hash: str,
        timestamp: float | None = None,
        nonce: int = 0,
        block_hash: str | None = None,
        difficulty: int | None = None,
    ) -> None:
        self.index = index
        self.timestamp = time.time() if timestamp is None else timestamp
        self.transactions = transactions
        self.previous_hash = previous_hash
        self.nonce = nonce
        self.difficulty = self.__class__.difficulty if difficulty is None else int(difficulty)
        self.hash = block_hash or self.calculate_hash()
        vorliq_logger.debug("Block object initialized at index %s", self.index)

    def _normalized_transactions(self) -> list[dict[str, Any]]:
        normalized = []
        for transaction in self.transactions:
            if hasattr(transaction, "to_dict"):
                normalized.append(transaction.to_dict())
            elif isinstance(transaction, dict):
                normalized.append(transaction)
            else:
                raise TypeError(f"Unsupported transaction type: {type(transaction)!r}")
        return normalized

    def calculate_hash(self) -> str:
        block_data = {
            "index": self.index,
            "timestamp": self.timestamp,
            "transactions": self._normalized_transactions(),
            "previous_hash": self.previous_hash,
            "nonce": self.nonce,
        }
        encoded_block = json.dumps(block_data, sort_keys=True, separators=(",", ":")).encode()
        return hashlib.sha256(encoded_block).hexdigest()

    def proof_of_work(self, difficulty: int | None = None) -> str:
        if difficulty is not None:
            self.difficulty = int(difficulty)
        target = "0" * self.difficulty
        self.hash = self.calculate_hash()
        while not self.hash.startswith(target):
            self.nonce += 1
            self.hash = self.calculate_hash()
        return self.hash

    def has_valid_proof(self, difficulty: int | None = None) -> bool:
        target = "0" * (self.difficulty if difficulty is None else difficulty)
        return self.hash == self.calculate_hash() and self.hash.startswith(target)

    def to_dict(self) -> dict[str, Any]:
        return {
            "index": self.index,
            "timestamp": self.timestamp,
            "transactions": self._normalized_transactions(),
            "previous_hash": self.previous_hash,
            "nonce": self.nonce,
            "difficulty": self.difficulty,
            "hash": self.hash,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Block":
        return cls(
            index=int(data["index"]),
            timestamp=float(data["timestamp"]),
            transactions=list(data["transactions"]),
            previous_hash=str(data["previous_hash"]),
            nonce=int(data["nonce"]),
            block_hash=str(data["hash"]),
            difficulty=int(data.get("difficulty", cls.difficulty)),
        )
