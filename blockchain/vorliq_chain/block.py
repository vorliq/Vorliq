from __future__ import annotations

from dataclasses import dataclass, field
from hashlib import sha256
import json
import time


@dataclass
class Block:
    index: int
    transactions: list[dict]
    previous_hash: str
    nonce: int = 0
    timestamp: float = field(default_factory=time.time)

    def to_dict(self) -> dict:
        return {
            "index": self.index,
            "timestamp": self.timestamp,
            "transactions": self.transactions,
            "previous_hash": self.previous_hash,
            "nonce": self.nonce,
        }

    def hash(self) -> str:
        block_json = json.dumps(self.to_dict(), sort_keys=True).encode()
        return sha256(block_json).hexdigest()
