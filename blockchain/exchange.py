from __future__ import annotations

from hashlib import sha256
import time
from typing import Any

from logger import vorliq_logger


class Exchange:
    maximum_open_offers_per_creator = 5
    lifecycle_statuses = {
        "open",
        "accepted",
        "vlq_pending",
        "vlq_confirmed",
        "completed",
        "cancelled",
        "disputed",
    }
    offer_types = {"buy", "sell"}

    def __init__(self) -> None:
        self.offers: dict[str, dict[str, Any]] = {}

    def create_offer(
        self,
        creator_address: str,
        offer_type: str,
        amount: float,
        price_description: str,
        detail_description: str,
    ) -> str:
        creator_address = self._require_text(creator_address, "creator address")
        offer_type = self._require_text(offer_type, "offer type").lower()
        price_description = self._require_text(price_description, "price")
        detail_description = self._require_text(detail_description, "description")
        amount = float(amount)

        if amount <= 0:
            raise ValueError("offer amount must be greater than zero")

        if offer_type not in self.offer_types:
            raise ValueError("offer type must be buy or sell")

        open_offer_count = sum(
            1
            for offer in self.offers.values()
            if self.normalize_offer(offer)["creator_address"] == creator_address
            and offer["status"] == "open"
        )
        if open_offer_count >= self.maximum_open_offers_per_creator:
            raise ValueError("creator cannot have more than five open offers")

        timestamp = time.time()
        offer_id = sha256(f"{creator_address}:{timestamp}".encode("utf-8")).hexdigest()
        self.offers[offer_id] = {
            "offer_id": offer_id,
            "creator_address": creator_address,
            "offer_type": offer_type,
            "amount": amount,
            "price": price_description,
            "description": detail_description,
            "timestamp": timestamp,
            "created_at": timestamp,
            "accepted_at": None,
            "cancelled_at": None,
            "completed_at": None,
            "disputed_at": None,
            "updated_at": timestamp,
            "status": "open",
            "acceptor_address": None,
            "vlq_tx_id": None,
            "offchain_confirmation_creator": False,
            "offchain_confirmation_acceptor": False,
            "dispute_reason": "",
            "status_history": [
                {
                    "status": "open",
                    "timestamp": timestamp,
                    "message": "Offer posted and open for acceptance.",
                }
            ],
        }

        vorliq_logger.info(
            "Exchange offer %s created by %s to %s %s VLQ",
            offer_id,
            creator_address,
            offer_type,
            amount,
        )
        return offer_id

    def accept_offer(self, offer_id: str, acceptor_address: str) -> dict[str, Any]:
        offer = self._get_existing_offer(offer_id)
        acceptor_address = self._require_text(acceptor_address, "acceptor address")

        if offer["status"] != "open":
            raise ValueError("offer is no longer open")

        if offer["creator_address"] == acceptor_address:
            raise ValueError("creator cannot accept their own offer")

        now = time.time()
        offer["acceptor_address"] = acceptor_address
        offer["accepted_at"] = now
        offer["accepted_timestamp"] = now
        self._set_status(offer, "accepted", "Offer accepted by counterparty.", now)
        vorliq_logger.info("Exchange offer %s accepted by %s", offer_id, acceptor_address)
        return self.public_offer(offer)

    def cancel_offer(self, offer_id: str, caller_address: str) -> dict[str, Any]:
        offer = self._get_existing_offer(offer_id)
        caller_address = self._require_text(caller_address, "caller address")

        if offer["status"] != "open":
            raise ValueError("only open offers can be cancelled")

        if caller_address != offer["creator_address"]:
            raise ValueError("only the creator can cancel this offer")

        now = time.time()
        offer["cancelled_at"] = now
        self._set_status(offer, "cancelled", "Offer cancelled by creator.", now)
        vorliq_logger.info("Exchange offer %s cancelled by %s", offer_id, caller_address)
        return self.public_offer(offer)

    def record_vlq_tx(
        self,
        offer_id: str,
        tx_id: str,
        caller_address: str,
        blockchain: Any | None = None,
    ) -> dict[str, Any]:
        offer = self._get_existing_offer(offer_id)
        tx_id = self._require_text(tx_id, "transaction ID")
        caller_address = self._require_text(caller_address, "caller address")

        if offer["status"] not in {"accepted", "vlq_pending", "vlq_confirmed"}:
            raise ValueError("offer must be accepted before recording a VLQ transaction")

        if caller_address not in {offer["creator_address"], offer.get("acceptor_address")}:
            raise ValueError("only the creator or acceptor can record this transaction")

        expected_sender, expected_receiver = self.expected_vlq_parties(offer)
        if caller_address != expected_sender:
            raise ValueError("only the expected VLQ sender can record the transaction")

        transaction = blockchain.get_transaction_detail(tx_id) if blockchain else None
        if blockchain and not transaction:
            raise ValueError("transaction was not found in pending or confirmed records")

        if transaction:
            self._validate_vlq_transaction(offer, transaction, expected_sender, expected_receiver)

        now = time.time()
        offer["vlq_tx_id"] = tx_id
        offer["updated_at"] = now
        status = "vlq_confirmed" if transaction and transaction.get("status") == "confirmed" else "vlq_pending"
        message = (
            "VLQ transaction confirmed on-chain."
            if status == "vlq_confirmed"
            else "VLQ transaction recorded and waiting for mining confirmation."
        )
        self._set_status(offer, status, message, now)
        return self.public_offer(offer)

    def sync_trade_statuses(self, blockchain: Any | None = None) -> bool:
        if blockchain is None:
            for offer in self.offers.values():
                self.normalize_offer(offer)
            return False

        changed = False
        for offer in self.offers.values():
            before = (offer.get("status"), offer.get("updated_at"))
            self.normalize_offer(offer)
            tx_id = offer.get("vlq_tx_id")
            if offer["status"] == "vlq_pending" and tx_id:
                transaction = blockchain.get_transaction_detail(tx_id)
                if transaction and transaction.get("status") == "confirmed":
                    self._validate_vlq_transaction(offer, transaction, *self.expected_vlq_parties(offer))
                    self._set_status(offer, "vlq_confirmed", "VLQ transaction confirmed on-chain.")
            changed = changed or before != (offer.get("status"), offer.get("updated_at"))
        return changed

    def confirm_trade_complete(self, offer_id: str, caller_address: str) -> dict[str, Any]:
        offer = self._get_existing_offer(offer_id)
        caller_address = self._require_text(caller_address, "caller address")

        if offer["status"] != "vlq_confirmed":
            raise ValueError("VLQ transaction must be confirmed before completion")

        if caller_address == offer["creator_address"]:
            offer["offchain_confirmation_creator"] = True
        elif caller_address == offer.get("acceptor_address"):
            offer["offchain_confirmation_acceptor"] = True
        else:
            raise ValueError("only the creator or acceptor can confirm this trade")

        offer["updated_at"] = time.time()
        if offer["offchain_confirmation_creator"] and offer["offchain_confirmation_acceptor"]:
            offer["completed_at"] = offer["updated_at"]
            self._set_status(offer, "completed", "Both parties confirmed trade completion.", offer["updated_at"])
        else:
            offer.setdefault("status_history", []).append(
                {
                    "status": "vlq_confirmed",
                    "timestamp": offer["updated_at"],
                    "message": f"{'Creator' if caller_address == offer['creator_address'] else 'Acceptor'} confirmed completion.",
                }
            )

        return self.public_offer(offer)

    def open_dispute(self, offer_id: str, caller_address: str, reason: str) -> dict[str, Any]:
        offer = self._get_existing_offer(offer_id)
        caller_address = self._require_text(caller_address, "caller address")
        reason = self._require_text(reason, "dispute reason")

        if len(reason) > 1000:
            raise ValueError("dispute reason is too long")

        if offer["status"] not in {"accepted", "vlq_pending", "vlq_confirmed"}:
            raise ValueError("only active trades can be disputed")

        if caller_address not in {offer["creator_address"], offer.get("acceptor_address")}:
            raise ValueError("only the creator or acceptor can dispute this trade")

        now = time.time()
        offer["dispute_reason"] = reason
        offer["disputed_at"] = now
        self._set_status(offer, "disputed", "Trade disputed by a participant.", now)
        return self.public_offer(offer)

    def get_open_offers(self, limit: int | None = None, offset: int = 0) -> list[dict[str, Any]]:
        return self.get_offers(status="open", limit=limit, offset=offset)

    def get_all_offers(self, limit: int | None = None, offset: int = 0) -> list[dict[str, Any]]:
        return self.get_offers(limit=limit, offset=offset)

    def get_offers(
        self,
        status: str | None = None,
        offer_type: str | None = None,
        address: str | None = None,
        limit: int | None = None,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        status = status.strip().lower() if isinstance(status, str) and status.strip() else None
        offer_type = offer_type.strip().lower() if isinstance(offer_type, str) and offer_type.strip() else None
        address = address.strip() if isinstance(address, str) and address.strip() else None

        if status and status not in self.lifecycle_statuses:
            raise ValueError("status is not valid")
        if offer_type and offer_type not in self.offer_types:
            raise ValueError("offer type is not valid")

        offers = [self.public_offer(offer) for offer in self.offers.values()]
        if status:
            offers = [offer for offer in offers if offer["status"] == status]
        if offer_type:
            offers = [offer for offer in offers if offer["offer_type"] == offer_type]
        if address:
            offers = [
                offer for offer in offers
                if offer["creator_address"] == address or offer.get("acceptor_address") == address
            ]

        offers = sorted(offers, key=lambda offer: float(offer.get("timestamp") or 0), reverse=True)
        if limit is None:
            return offers
        return offers[offset : offset + limit]

    def get_offers_by_address(self, address: str) -> list[dict[str, Any]]:
        address = self._require_text(address, "address")
        return self.get_offers(address=address)

    def get_my_trades(self, address: str) -> dict[str, list[dict[str, Any]]]:
        offers = self.get_offers_by_address(address)
        return {
            "created": [offer for offer in offers if offer["creator_address"] == address],
            "accepted": [offer for offer in offers if offer.get("acceptor_address") == address],
            "offers": offers,
        }

    def get_offer(self, offer_id: str) -> dict[str, Any] | None:
        offer = self.offers.get(offer_id)
        if not offer:
            return None
        return self.public_offer(offer)

    def get_summary(self) -> dict[str, Any]:
        offers = self.get_offers()
        counts = {status: len([offer for offer in offers if offer["status"] == status]) for status in self.lifecycle_statuses}
        return {
            "total_offers": len(offers),
            "open_count": counts["open"],
            "accepted_count": counts["accepted"],
            "vlq_pending_count": counts["vlq_pending"],
            "vlq_confirmed_count": counts["vlq_confirmed"],
            "active_trades_count": counts["accepted"] + counts["vlq_pending"] + counts["vlq_confirmed"] + counts["disputed"],
            "completed_count": counts["completed"],
            "cancelled_count": counts["cancelled"],
            "disputed_count": counts["disputed"],
            "buy_count": len([offer for offer in offers if offer["offer_type"] == "buy"]),
            "sell_count": len([offer for offer in offers if offer["offer_type"] == "sell"]),
            "total_vlq_open": sum(float(offer.get("amount") or 0) for offer in offers if offer["status"] == "open"),
            "total_vlq_completed": sum(float(offer.get("amount") or 0) for offer in offers if offer["status"] == "completed"),
        }

    def expected_vlq_parties(self, offer: dict[str, Any]) -> tuple[str, str]:
        self.normalize_offer(offer)
        if not offer.get("acceptor_address"):
            raise ValueError("offer must be accepted before VLQ parties are known")
        if offer["offer_type"] == "sell":
            return offer["creator_address"], offer["acceptor_address"]
        return offer["acceptor_address"], offer["creator_address"]

    def public_offer(self, offer: dict[str, Any]) -> dict[str, Any]:
        self.normalize_offer(offer)
        return dict(offer)

    def normalize_offer(self, offer: dict[str, Any]) -> dict[str, Any]:
        status = str(offer.get("status") or "open").lower()
        mapped_status = status if status in self.lifecycle_statuses else "open"
        timestamp = float(offer.get("timestamp") or offer.get("created_at") or time.time())
        offer.setdefault("offer_id", "")
        offer.setdefault("timestamp", timestamp)
        offer.setdefault("created_at", timestamp)
        offer.setdefault("accepted_at", offer.get("accepted_timestamp"))
        offer.setdefault("cancelled_at", None)
        offer.setdefault("completed_at", offer.get("completed_timestamp"))
        offer.setdefault("disputed_at", None)
        offer.setdefault("updated_at", offer.get("accepted_at") or offer.get("completed_at") or timestamp)
        offer["status"] = mapped_status
        offer.setdefault("acceptor_address", None)
        offer.setdefault("vlq_tx_id", offer.get("tx_id"))
        offer.setdefault("offchain_confirmation_creator", mapped_status == "completed")
        offer.setdefault("offchain_confirmation_acceptor", mapped_status == "completed")
        offer.setdefault("dispute_reason", "")
        offer.setdefault("price", offer.get("price_description", ""))
        offer.setdefault("description", offer.get("detail_description", ""))
        offer["offer_type"] = str(offer.get("offer_type") or "buy").lower()
        if offer["offer_type"] not in self.offer_types:
            offer["offer_type"] = "buy"
        if "status_history" not in offer or not isinstance(offer.get("status_history"), list):
            offer["status_history"] = [
                {
                    "status": mapped_status,
                    "timestamp": timestamp,
                    "message": f"Legacy exchange status normalized to {mapped_status}.",
                }
            ]
        if status not in self.lifecycle_statuses:
            offer["compatibility_note"] = f"Unknown legacy status {status} treated as open."
        return offer

    def _validate_vlq_transaction(
        self,
        offer: dict[str, Any],
        transaction: dict[str, Any],
        expected_sender: str,
        expected_receiver: str,
    ) -> None:
        if transaction.get("sender_address") != expected_sender:
            raise ValueError("transaction sender does not match expected VLQ sender")
        if transaction.get("receiver_address") != expected_receiver:
            raise ValueError("transaction receiver does not match expected VLQ receiver")
        if float(transaction.get("amount") or 0) + 1e-9 < float(offer.get("amount") or 0):
            raise ValueError("transaction amount is less than the offer amount")

    def _set_status(self, offer: dict[str, Any], status: str, message: str, timestamp: float | None = None) -> None:
        timestamp = time.time() if timestamp is None else timestamp
        if offer.get("status") != status:
            offer["status"] = status
            offer["updated_at"] = timestamp
            offer.setdefault("status_history", []).append(
                {"status": status, "timestamp": timestamp, "message": message}
            )

    def _get_existing_offer(self, offer_id: str) -> dict[str, Any]:
        offer_id = self._require_text(offer_id, "offer ID")
        offer = self.offers.get(offer_id)
        if not offer:
            raise ValueError("offer does not exist")
        return self.normalize_offer(offer)

    def _require_text(self, value: str, field_name: str) -> str:
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"{field_name} is required")
        return value.strip()
