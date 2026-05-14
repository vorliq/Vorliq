from __future__ import annotations

from hashlib import sha256
import time
from typing import Any

from logger import vorliq_logger


class Exchange:
    maximum_open_offers_per_creator = 5

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

        if offer_type not in {"buy", "sell"}:
            raise ValueError("offer type must be buy or sell")

        open_offer_count = sum(
            1
            for offer in self.offers.values()
            if offer["creator_address"] == creator_address and offer["status"] == "open"
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
            "status": "open",
            "acceptor_address": None,
            "accepted_timestamp": None,
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

        offer["status"] = "accepted"
        offer["acceptor_address"] = acceptor_address
        offer["accepted_timestamp"] = time.time()
        vorliq_logger.info("Exchange offer %s accepted by %s", offer_id, acceptor_address)
        return offer

    def complete_offer(self, offer_id: str, caller_address: str) -> dict[str, Any]:
        offer = self._get_existing_offer(offer_id)
        caller_address = self._require_text(caller_address, "caller address")

        if offer["status"] != "accepted":
            raise ValueError("offer must be accepted before it can be completed")

        if caller_address not in {offer["creator_address"], offer["acceptor_address"]}:
            raise ValueError("only the creator or acceptor can complete this offer")

        offer["status"] = "completed"
        vorliq_logger.info("Exchange offer %s completed by %s", offer_id, caller_address)
        return offer

    def cancel_offer(self, offer_id: str, caller_address: str) -> dict[str, Any]:
        offer = self._get_existing_offer(offer_id)
        caller_address = self._require_text(caller_address, "caller address")

        if offer["status"] not in {"open", "accepted"}:
            raise ValueError("only open or accepted offers can be cancelled")

        if caller_address != offer["creator_address"]:
            raise ValueError("only the creator can cancel this offer")

        offer["status"] = "cancelled"
        vorliq_logger.info("Exchange offer %s cancelled by %s", offer_id, caller_address)
        return offer

    def get_open_offers(self) -> list[dict[str, Any]]:
        return sorted(
            [offer for offer in self.offers.values() if offer["status"] == "open"],
            key=lambda offer: offer["timestamp"],
            reverse=True,
        )

    def get_all_offers(self) -> list[dict[str, Any]]:
        return sorted(
            self.offers.values(),
            key=lambda offer: offer["timestamp"],
            reverse=True,
        )

    def get_offers_by_address(self, address: str) -> list[dict[str, Any]]:
        address = self._require_text(address, "address")
        return sorted(
            [
                offer
                for offer in self.offers.values()
                if offer["creator_address"] == address or offer.get("acceptor_address") == address
            ],
            key=lambda offer: offer["timestamp"],
            reverse=True,
        )

    def get_offer(self, offer_id: str) -> dict[str, Any] | None:
        return self.offers.get(offer_id)

    def _get_existing_offer(self, offer_id: str) -> dict[str, Any]:
        offer_id = self._require_text(offer_id, "offer ID")
        offer = self.get_offer(offer_id)
        if not offer:
            raise ValueError("offer does not exist")
        return offer

    def _require_text(self, value: str, field_name: str) -> str:
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"{field_name} is required")
        return value.strip()
