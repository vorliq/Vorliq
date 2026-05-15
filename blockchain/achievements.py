from __future__ import annotations

import time
from typing import Any

from logger import vorliq_logger


class Achievements:
    DEFINITIONS: dict[str, dict[str, str]] = {
        "first_wallet": {
            "id": "first_wallet",
            "title": "First Steps",
            "description": "created your first Vorliq wallet",
            "badge_color": "green",
        },
        "first_transaction": {
            "id": "first_transaction",
            "title": "Sending Value",
            "description": "sent your first VLQ transaction",
            "badge_color": "blue",
        },
        "first_mine": {
            "id": "first_mine",
            "title": "Block Pioneer",
            "description": "mined your first block",
            "badge_color": "yellow",
        },
        "ten_blocks": {
            "id": "ten_blocks",
            "title": "Dedicated Miner",
            "description": "mined ten blocks",
            "badge_color": "orange",
        },
        "first_loan": {
            "id": "first_loan",
            "title": "Community Lender",
            "description": "participated in your first loan vote",
            "badge_color": "purple",
        },
        "first_repayment": {
            "id": "first_repayment",
            "title": "Debt Free",
            "description": "repaid a VLQ loan in full",
            "badge_color": "teal",
        },
        "first_vote": {
            "id": "first_vote",
            "title": "Voice of the Network",
            "description": "cast your first governance vote",
            "badge_color": "red",
        },
        "first_trade": {
            "id": "first_trade",
            "title": "Market Maker",
            "description": "completed your first VLQ exchange trade",
            "badge_color": "pink",
        },
        "first_tip": {
            "id": "first_tip",
            "title": "Generous Soul",
            "description": "tipped another community member VLQ",
            "badge_color": "gold",
        },
        "treasury_voter": {
            "id": "treasury_voter",
            "title": "Treasury Guardian",
            "description": "voted on a community treasury proposal",
            "badge_color": "silver",
        },
    }

    def __init__(self) -> None:
        self.earned: dict[str, dict[str, dict[str, Any]]] = {}

    def check_and_award(self, wallet_address: str, achievement_id: str, current_blockchain: Any | None = None) -> bool:
        wallet_address = self._require_text(wallet_address, "wallet address")
        achievement_id = self._require_text(achievement_id, "achievement ID")
        if achievement_id not in self.DEFINITIONS:
            raise ValueError("unknown achievement ID")

        if current_blockchain and achievement_id in {"first_mine", "ten_blocks"}:
            mined_count = sum(
                1
                for block in current_blockchain.chain
                if getattr(block, "miner_address", None) == wallet_address
            )
            if achievement_id == "first_mine" and mined_count < 1:
                return False
            if achievement_id == "ten_blocks" and mined_count < 10:
                return False

        return self.award_achievement(wallet_address, achievement_id)

    def get_achievements(self, wallet_address: str) -> list[dict[str, Any]]:
        wallet_address = self._require_text(wallet_address, "wallet address")
        earned_for_wallet = self.earned.get(wallet_address, {})
        return [
            {**self.DEFINITIONS[achievement_id], **record}
            for achievement_id, record in earned_for_wallet.items()
            if achievement_id in self.DEFINITIONS
        ]

    def get_all_achievements(self) -> list[dict[str, str]]:
        return list(self.DEFINITIONS.values())

    def award_achievement(self, wallet_address: str, achievement_id: str) -> bool:
        wallet_address = self._require_text(wallet_address, "wallet address")
        achievement_id = self._require_text(achievement_id, "achievement ID")
        if achievement_id not in self.DEFINITIONS:
            raise ValueError("unknown achievement ID")

        wallet_records = self.earned.setdefault(wallet_address, {})
        if achievement_id in wallet_records:
            return False

        wallet_records[achievement_id] = {
            "achievement_id": achievement_id,
            "earned_at": time.time(),
        }
        vorliq_logger.info("Achievement %s awarded to %s", achievement_id, wallet_address)
        return True

    def _require_text(self, value: str, field_name: str) -> str:
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"{field_name} must be a non-empty string")
        return value.strip()
