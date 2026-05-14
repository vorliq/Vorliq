from __future__ import annotations

import json
import time
from typing import Any

from wallet import address_from_public_key_pem, verify_signature


SYSTEM_ADDRESS = "SYSTEM"
LENDING_POOL_ADDRESS = "LENDING_POOL"
SYSTEM_ADDRESSES = {SYSTEM_ADDRESS, LENDING_POOL_ADDRESS}


class Transaction:
    def __init__(
        self,
        sender_address: str,
        receiver_address: str,
        amount: float,
        timestamp: float | None = None,
        signature: str | None = None,
        sender_public_key: str | None = None,
    ) -> None:
        if not sender_address:
            raise ValueError("sender_address is required")
        if not receiver_address:
            raise ValueError("receiver_address is required")
        if amount <= 0:
            raise ValueError("amount must be greater than zero")

        self.sender_address = sender_address
        self.receiver_address = receiver_address
        self.amount = float(amount)
        self.timestamp = time.time() if timestamp is None else timestamp
        self.signature = signature
        self.sender_public_key = sender_public_key

    def data_to_sign(self) -> str:
        data = {
            "sender_address": self.sender_address,
            "receiver_address": self.receiver_address,
            "amount": self.amount,
            "timestamp": self.timestamp,
        }
        return json.dumps(data, sort_keys=True, separators=(",", ":"))

    def sign_transaction(self, wallet: object) -> str:
        wallet_address = getattr(wallet, "address", None)
        if wallet_address != self.sender_address:
            raise ValueError("wallet address does not match transaction sender address")
        if not hasattr(wallet, "sign"):
            raise TypeError("wallet must have a sign method")

        self.signature = wallet.sign(self.data_to_sign())
        self.sender_public_key = wallet.public_key_pem()
        return self.signature

    def verify_transaction(self, sender_public_key: str | None = None) -> bool:
        if self.sender_address in SYSTEM_ADDRESSES:
            return self.signature is None

        if self.receiver_address == LENDING_POOL_ADDRESS and self.signature is None:
            return self.signature is None

        public_key = sender_public_key or self.sender_public_key
        if not public_key or not self.signature:
            return False

        try:
            derived_address = address_from_public_key_pem(public_key)
        except (TypeError, ValueError):
            return False

        if derived_address != self.sender_address:
            return False

        return verify_signature(self.data_to_sign(), self.signature, public_key)

    def to_dict(self) -> dict[str, Any]:
        return {
            "sender_address": self.sender_address,
            "receiver_address": self.receiver_address,
            "amount": self.amount,
            "timestamp": self.timestamp,
            "signature": self.signature,
            "sender_public_key": self.sender_public_key,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Transaction":
        sender_address = data.get("sender_address") or data.get("senderAddress") or data.get("sender")
        receiver_address = data.get("receiver_address") or data.get("receiverAddress") or data.get("receiver")
        sender_public_key = data.get("sender_public_key") or data.get("senderPublicKey")

        return cls(
            sender_address=str(sender_address),
            receiver_address=str(receiver_address),
            amount=float(data["amount"]),
            timestamp=float(data["timestamp"]) if data.get("timestamp") is not None else None,
            signature=data.get("signature"),
            sender_public_key=sender_public_key,
        )

    def __repr__(self) -> str:
        return (
            "Transaction("
            f"sender_address={self.sender_address!r}, "
            f"receiver_address={self.receiver_address!r}, "
            f"amount={self.amount!r})"
        )
