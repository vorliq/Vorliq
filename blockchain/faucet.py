from __future__ import annotations

import hashlib
import time
from typing import Any

from logger import vorliq_logger
from transaction import LENDING_POOL_ADDRESS, SYSTEM_ADDRESS, TREASURY_ADDRESS, Transaction
from wallet import validate_address


class Faucet:
    STARTER_AMOUNT = 1.0
    WALLET_COOLDOWN_SECONDS = 24 * 60 * 60
    # A device fingerprint may claim at most once per cooldown window, no matter
    # which wallet address it uses. Stops casual multi-wallet abuse from one phone
    # or computer. Stacks on top of the per-wallet cooldown, never replaces it.
    FINGERPRINT_LIMIT = 1
    # The fingerprint rejection is deliberately worded exactly like the per-wallet
    # cooldown so it does not reveal that device fingerprinting is in play.
    COOLDOWN_MESSAGE = "wallet already claimed starter VLQ in the last 24 hours"
    MAX_TREASURY_PERCENT = 0.10
    SYSTEM_RECEIVERS = {SYSTEM_ADDRESS, TREASURY_ADDRESS, LENDING_POOL_ADDRESS}

    def __init__(self) -> None:
        self.claims: dict[str, dict[str, Any]] = {}

    def request_claim(
        self,
        wallet_address: str,
        treasury_balance: float,
        blockchain: Any,
        fingerprint_hash: str | None = None,
    ) -> dict[str, Any]:
        wallet_address = self._require_wallet(wallet_address)
        fingerprint_hash = self._optional_hash(fingerprint_hash)
        now = time.time()
        treasury_balance = float(treasury_balance or 0)

        blocked_status, reason = self._blocked_reason(wallet_address, fingerprint_hash, treasury_balance, now)
        if blocked_status:
            claim = self._record_claim(wallet_address, 0, blocked_status, reason, fingerprint_hash, now)
            vorliq_logger.warning("Faucet claim rejected for %s: %s", wallet_address, reason)
            return claim

        amount = self.STARTER_AMOUNT
        transaction = Transaction(
            sender_address=TREASURY_ADDRESS,
            receiver_address=wallet_address,
            amount=amount,
            transaction_type="faucet_starter",
            category="faucet",
            metadata={"faucet_claim": True, "starter_amount": amount},
        )
        blockchain.add_pending_transaction(transaction)
        claim = self._record_claim(
            wallet_address,
            amount,
            "pending",
            "Starter VLQ transaction submitted from the community treasury.",
            fingerprint_hash,
            now,
            tx_id=transaction.tx_id,
        )
        transaction.metadata["claim_id"] = claim["claim_id"]
        transaction.tx_id = transaction.calculate_tx_id()
        claim["tx_id"] = transaction.tx_id
        self.claims[claim["claim_id"]]["tx_id"] = transaction.tx_id
        vorliq_logger.info("Faucet queued %s VLQ for %s with tx %s", amount, wallet_address, transaction.tx_id)
        return claim

    def sync_claim_statuses(self, blockchain: Any) -> bool:
        tx_lookup = self._confirmed_transaction_lookup(blockchain)
        changed = False
        for claim in self.claims.values():
            self._normalize_claim(claim)
            if claim.get("status") != "pending" or not claim.get("tx_id"):
                continue
            record = tx_lookup.get(claim["tx_id"])
            if not record:
                continue
            claim["status"] = "confirmed"
            claim["confirmed_at"] = record.get("block_timestamp") or time.time()
            claim["block_index"] = record.get("block_index")
            claim["block_hash"] = record.get("block_hash")
            claim["reason"] = "Starter VLQ transaction confirmed on chain."
            changed = True
        return changed

    def get_claims_for_address(self, wallet_address: str) -> list[dict[str, Any]]:
        wallet_address = self._require_wallet(wallet_address)
        claims = [
            self._public_claim(claim)
            for claim in self.claims.values()
            if claim.get("wallet_address") == wallet_address
        ]
        return sorted(claims, key=lambda claim: float(claim.get("requested_at") or 0), reverse=True)

    def get_recent_claims(self, limit: int = 25, offset: int = 0) -> dict[str, Any]:
        limit, offset = self._page_values(limit, offset)
        claims = sorted(
            (self._public_claim(claim) for claim in self.claims.values()),
            key=lambda claim: float(claim.get("requested_at") or 0),
            reverse=True,
        )
        total = len(claims)
        return {
            "claims": claims[offset : offset + limit],
            "total": total,
            "limit": limit,
            "offset": offset,
            "has_more": offset + limit < total,
        }

    def get_faucet_summary(self, blockchain: Any) -> dict[str, Any]:
        self.sync_claim_statuses(blockchain)
        now = time.time()
        claims = [self._normalize_claim(claim) for claim in self.claims.values()]
        return {
            "enabled": True,
            "starter_amount": self.STARTER_AMOUNT,
            "treasury_balance": blockchain.get_treasury_balance(),
            "claims_24h": len([claim for claim in claims if now - float(claim.get("requested_at") or 0) < self.WALLET_COOLDOWN_SECONDS]),
            "confirmed_claims": len([claim for claim in claims if claim.get("status") == "confirmed"]),
            "pending_claims": len([claim for claim in claims if claim.get("status") == "pending"]),
            "next_available_hint": "Wallets can claim once every 24 hours while the treasury is funded.",
        }

    def _blocked_reason(
        self,
        wallet_address: str,
        fingerprint_hash: str | None,
        treasury_balance: float,
        now: float,
    ) -> tuple[str | None, str | None]:
        if wallet_address in self.SYSTEM_RECEIVERS:
            return "rejected", "system-controlled addresses cannot receive faucet claims"
        if treasury_balance <= 0:
            return "treasury_empty", "community treasury balance is zero"
        if treasury_balance < self.STARTER_AMOUNT or self.STARTER_AMOUNT > treasury_balance * self.MAX_TREASURY_PERCENT:
            return "treasury_empty", "community treasury balance is too low for the starter amount"

        recent_wallet_claims = [
            claim
            for claim in self.claims.values()
            if claim.get("wallet_address") == wallet_address
            and claim.get("status") in {"pending", "confirmed"}
            and now - float(claim.get("requested_at") or 0) < self.WALLET_COOLDOWN_SECONDS
        ]
        if recent_wallet_claims:
            return "rate_limited", self.COOLDOWN_MESSAGE

        if fingerprint_hash:
            recent_fingerprint_claims = [
                claim
                for claim in self.claims.values()
                if claim.get("fingerprint_hash") == fingerprint_hash
                and claim.get("status") in {"pending", "confirmed"}
                and now - float(claim.get("requested_at") or 0) < self.WALLET_COOLDOWN_SECONDS
            ]
            # Same message as the per-wallet cooldown, regardless of which wallet
            # this device tried — a different wallet from the same device is still
            # the same person inside the cooldown window.
            if len(recent_fingerprint_claims) >= self.FINGERPRINT_LIMIT:
                return "rate_limited", self.COOLDOWN_MESSAGE

        return None, None

    def _record_claim(
        self,
        wallet_address: str,
        amount: float,
        status: str,
        reason: str,
        fingerprint_hash: str | None,
        requested_at: float,
        tx_id: str | None = None,
    ) -> dict[str, Any]:
        seed = f"{wallet_address}:{requested_at}:{status}:{tx_id or ''}"
        claim_id = hashlib.sha256(seed.encode("utf-8")).hexdigest()
        claim = {
            "claim_id": claim_id,
            "wallet_address": wallet_address,
            "amount": float(amount),
            "requested_at": requested_at,
            "status": status,
            "tx_id": tx_id,
            "reason": reason,
            "fingerprint_hash": fingerprint_hash,
            "confirmed_at": None,
            "block_index": None,
            "block_hash": None,
        }
        self.claims[claim_id] = claim
        return self._public_claim(claim)

    def _confirmed_transaction_lookup(self, blockchain: Any) -> dict[str, dict[str, Any]]:
        records: dict[str, dict[str, Any]] = {}
        for block in getattr(blockchain, "chain", []):
            for index, transaction in enumerate(block.transactions or []):
                tx = blockchain._coerce_transaction(transaction)
                records[tx.tx_id] = blockchain.safe_transaction_record(
                    tx,
                    status="confirmed",
                    block=block,
                    transaction_index=index,
                )
        return records

    def _public_claim(self, claim: dict[str, Any]) -> dict[str, Any]:
        normalized = dict(self._normalize_claim(claim))
        normalized.pop("fingerprint_hash", None)
        return normalized

    def _normalize_claim(self, claim: dict[str, Any]) -> dict[str, Any]:
        claim.setdefault("claim_id", "")
        claim.setdefault("wallet_address", "")
        claim["amount"] = float(claim.get("amount") or 0)
        claim.setdefault("requested_at", time.time())
        claim.setdefault("status", "pending")
        claim.setdefault("tx_id", None)
        claim.setdefault("reason", "")
        claim.setdefault("fingerprint_hash", None)
        claim.setdefault("confirmed_at", None)
        claim.setdefault("block_index", None)
        claim.setdefault("block_hash", None)
        return claim

    def _require_wallet(self, value: object) -> str:
        if not isinstance(value, str) or not value.strip():
            raise ValueError("wallet address is required")
        wallet_address = value.replace("\x00", "").strip()
        if len(wallet_address) > 160:
            raise ValueError("wallet address must be 160 characters or fewer")
        if wallet_address in self.SYSTEM_RECEIVERS:
            raise ValueError("system-controlled addresses cannot claim starter VLQ")
        valid, errors, _warnings = validate_address(wallet_address, label="wallet address", strict_length=True)
        if not valid:
            raise ValueError(errors[0])
        return wallet_address

    def _optional_hash(self, value: object) -> str | None:
        if not isinstance(value, str) or not value.strip():
            return None
        fingerprint_hash = value.strip().lower()
        if len(fingerprint_hash) > 128:
            raise ValueError("fingerprint hash is too long")
        return fingerprint_hash

    def _page_values(self, limit: int, offset: int) -> tuple[int, int]:
        limit = int(limit)
        offset = int(offset)
        if limit <= 0:
            raise ValueError("limit must be greater than zero")
        if offset < 0:
            raise ValueError("offset must be zero or greater")
        return min(limit, 100), offset
