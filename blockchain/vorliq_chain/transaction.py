from __future__ import annotations

from dataclasses import dataclass, field
from hashlib import sha256
import time


@dataclass
class Transaction:
    sender: str
    recipient: str
    amount: float
    memo: str = ""
    timestamp: float = field(default_factory=time.time)

    def to_dict(self) -> dict:
        return {
            "sender": self.sender,
            "recipient": self.recipient,
            "amount": self.amount,
            "memo": self.memo,
            "timestamp": self.timestamp,
        }

    def id(self) -> str:
        raw = f"{self.sender}:{self.recipient}:{self.amount}:{self.memo}:{self.timestamp}"
        return sha256(raw.encode()).hexdigest()
