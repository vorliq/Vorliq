from __future__ import annotations

import re
import time
from typing import Any
from urllib.parse import urlparse


class Profiles:
    ALLOWED_AVATAR_STYLES = {"gradient", "green", "cyan", "blue", "gold", "purple"}
    PUBLIC_FIELDS = {
        "wallet_address",
        "display_name",
        "bio",
        "location",
        "country",
        "avatar_style",
        "website",
        "x_link",
        "telegram_link",
        "discord_name",
        "created_at",
        "updated_at",
        "reputation_score",
        "is_ambassador",
        "badges",
        "verified_wallet",
        "verification_message",
        "verified_at",
    }
    SECRET_FIELD_PATTERN = re.compile(r"(private|password|secret|token|email)", re.IGNORECASE)

    def __init__(self) -> None:
        self.profiles: dict[str, dict[str, Any]] = {}
        self.verification_challenges: dict[str, dict[str, Any]] = {}

    def create_or_update_profile(self, wallet_address: str, data: dict[str, Any]) -> dict[str, Any]:
        wallet_address = self._require_text(wallet_address, "wallet address", 160)
        if not isinstance(data, dict):
            raise ValueError("profile data must be an object")

        now = time.time()
        existing = self.profiles.get(wallet_address, {})
        display_name = self._require_text(data.get("display_name", existing.get("display_name")), "display name", 32)
        if len(display_name) < 3:
            raise ValueError("display name must be at least 3 characters")

        profile = {
            "wallet_address": wallet_address,
            "display_name": display_name,
            "bio": self._optional_text(data.get("bio", existing.get("bio", "")), "bio", 300),
            "location": self._optional_text(data.get("location", existing.get("location", "")), "location", 80),
            "country": self._optional_text(data.get("country", existing.get("country", "")), "country", 80),
            "avatar_style": self._avatar_style(data.get("avatar_style", existing.get("avatar_style", "gradient"))),
            "website": self._optional_url(data.get("website", existing.get("website", "")), "website"),
            "x_link": self._optional_url(data.get("x_link", existing.get("x_link", "")), "X link"),
            "telegram_link": self._optional_url(
                data.get("telegram_link", existing.get("telegram_link", "")), "Telegram link"
            ),
            "discord_name": self._optional_text(
                data.get("discord_name", existing.get("discord_name", "")), "Discord name", 80
            ),
            "created_at": float(existing.get("created_at", now)),
            "updated_at": now,
            "reputation_score": int(existing.get("reputation_score", 10)),
            "is_ambassador": bool(data.get("is_ambassador", existing.get("is_ambassador", False))),
            "badges": self._badges(data.get("badges", existing.get("badges", []))),
            "verified_wallet": bool(existing.get("verified_wallet", False)),
            "verification_message": self._optional_text(
                existing.get("verification_message", ""), "verification message", 220
            ),
            "verified_at": existing.get("verified_at"),
        }
        self.profiles[wallet_address] = profile
        return dict(profile)

    def get_profile(self, wallet_address: str) -> dict[str, Any] | None:
        wallet_address = self._require_text(wallet_address, "wallet address", 160)
        profile = self.profiles.get(wallet_address)
        return dict(profile) if profile else None

    def get_profiles(self, limit: int = 50, offset: int = 0) -> list[dict[str, Any]]:
        limit, offset = self._page_values(limit, offset)
        rows = sorted(self.profiles.values(), key=lambda profile: float(profile.get("updated_at", 0)), reverse=True)
        return [dict(profile) for profile in rows[offset : offset + limit]]

    def search_profiles(self, query: str, limit: int = 50, offset: int = 0) -> list[dict[str, Any]]:
        query = self._require_text(query, "query", 80).casefold()
        limit, offset = self._page_values(limit, offset)
        rows = [
            profile
            for profile in self.profiles.values()
            if query in str(profile.get("display_name", "")).casefold()
            or query in str(profile.get("location", "")).casefold()
            or query in str(profile.get("country", "")).casefold()
            or query in str(profile.get("wallet_address", "")).casefold()
        ]
        rows.sort(key=lambda profile: float(profile.get("reputation_score", 0)), reverse=True)
        return [dict(profile) for profile in rows[offset : offset + limit]]

    def calculate_reputation(
        self,
        wallet_address: str,
        blockchain: Any = None,
        lending_pool: Any = None,
        exchange: Any = None,
        governance: Any = None,
        treasury: Any = None,
        forum: Any = None,
        achievements: Any = None,
    ) -> dict[str, Any]:
        wallet_address = self._require_text(wallet_address, "wallet address", 160)
        profile_exists = wallet_address in self.profiles
        achievement_count = len(self._achievement_list(wallet_address, achievements))
        forum_posts = 0
        forum_replies = 0
        completed_trades = 0
        repaid_loans = 0
        governance_votes = 0
        treasury_votes = 0
        mined_blocks = 0

        if forum is not None:
            for post in getattr(forum, "posts", {}).values():
                if post.get("author_address") == wallet_address:
                    forum_posts += 1
                forum_replies += sum(
                    1 for reply in post.get("replies", []) if reply.get("author_address") == wallet_address
                )

        if exchange is not None:
            completed_trades = sum(
                1
                for offer in getattr(exchange, "offers", {}).values()
                if offer.get("status") == "completed"
                and wallet_address in {offer.get("creator_address"), offer.get("acceptor_address")}
            )

        if lending_pool is not None:
            repaid_loans = sum(
                1
                for loan in getattr(lending_pool, "loan_requests", {}).values()
                if loan.get("status") == "repaid" and loan.get("requester_address") == wallet_address
            )

        if governance is not None:
            governance_votes = sum(
                1 for proposal in getattr(governance, "proposals", {}).values() if wallet_address in proposal.get("votes", {})
            )

        if treasury is not None:
            treasury_votes = sum(
                1 for proposal in getattr(treasury, "proposals", {}).values() if wallet_address in proposal.get("votes", {})
            )

        if blockchain is not None:
            mined_blocks = sum(
                1 for block in getattr(blockchain, "chain", []) if getattr(block, "miner_address", None) == wallet_address
            )

        score = (
            (10 if profile_exists else 0)
            + achievement_count * 5
            + forum_posts * 2
            + forum_replies
            + completed_trades * 3
            + repaid_loans * 3
            + governance_votes * 2
            + treasury_votes * 2
            + mined_blocks
        )
        score = min(int(score), 1000)

        if profile_exists:
            self.profiles[wallet_address]["reputation_score"] = score

        return {
            "reputation_score": score,
            "activity_summary": {
                "achievements": achievement_count,
                "forum_posts": forum_posts,
                "forum_replies": forum_replies,
                "completed_exchange_trades": completed_trades,
                "repaid_loans": repaid_loans,
                "governance_votes": governance_votes,
                "treasury_votes": treasury_votes,
                "mined_blocks": mined_blocks,
            },
        }

    def get_public_profile(self, wallet_address: str, dependencies: dict[str, Any] | None = None) -> dict[str, Any] | None:
        wallet_address = self._require_text(wallet_address, "wallet address", 160)
        profile = self.get_profile(wallet_address)
        if not profile:
            return None

        dependencies = dependencies or {}
        reputation = self.calculate_reputation(wallet_address, **dependencies)
        badges = self._public_badges(wallet_address, dependencies.get("achievements"), profile.get("badges", []))
        public_profile = {key: profile.get(key) for key in self.PUBLIC_FIELDS}
        public_profile["reputation_score"] = reputation["reputation_score"]
        public_profile["badges"] = badges
        public_profile["activity_summary"] = reputation["activity_summary"]
        public_profile["trust_labels"] = self.trust_labels(public_profile)
        return public_profile

    def create_verification_challenge(self, wallet_address: str) -> dict[str, Any]:
        wallet_address = self._require_text(wallet_address, "wallet address", 160)
        timestamp = int(time.time())
        message = f"Verify Vorliq profile ownership for {wallet_address} at {timestamp}"
        challenge = {
            "wallet_address": wallet_address,
            "message": message,
            "timestamp": timestamp,
            "expires_at": timestamp + 15 * 60,
        }
        self.verification_challenges[wallet_address] = challenge
        return dict(challenge)

    def get_active_challenge(self, wallet_address: str) -> dict[str, Any] | None:
        wallet_address = self._require_text(wallet_address, "wallet address", 160)
        challenge = self.verification_challenges.get(wallet_address)
        if not challenge:
            return None
        if float(challenge.get("expires_at", 0)) < time.time():
            self.verification_challenges.pop(wallet_address, None)
            return None
        return dict(challenge)

    def mark_wallet_verified(self, wallet_address: str, verification_message: str) -> dict[str, Any]:
        wallet_address = self._require_text(wallet_address, "wallet address", 160)
        profile = self.profiles.get(wallet_address)
        if not profile:
            profile = self.create_or_update_profile(wallet_address, {
                "display_name": f"VLQ {wallet_address[:8]}",
                "avatar_style": "gradient",
            })
        profile["verified_wallet"] = True
        profile["verification_message"] = self._require_text(verification_message, "verification message", 220)
        profile["verified_at"] = time.time()
        self.profiles[wallet_address] = profile
        self.verification_challenges.pop(wallet_address, None)
        return dict(profile)

    def trust_labels(self, profile: dict[str, Any]) -> list[str]:
        labels: list[str] = []
        if profile.get("verified_wallet"):
            labels.append("Wallet Verified")
        else:
            labels.append("Unverified Wallet")
        score = int(profile.get("reputation_score", 0) or 0)
        summary = profile.get("activity_summary", {}) if isinstance(profile.get("activity_summary"), dict) else {}
        activity_count = sum(int(summary.get(key, 0) or 0) for key in summary)
        created_at = float(profile.get("created_at", time.time()) or time.time())
        if score >= 100:
            labels.append("Top Reputation")
        if score >= 25 or activity_count >= 5:
            labels.append("Active Contributor")
        if time.time() - created_at < 14 * 24 * 60 * 60:
            labels.append("New Member")
        return labels

    def get_top_profiles(self, limit: int = 20, dependencies: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        limit, _offset = self._page_values(limit, 0)
        dependencies = dependencies or {}
        rows = [
            self.get_public_profile(wallet_address, dependencies)
            for wallet_address in self.profiles
        ]
        rows = [row for row in rows if row is not None]
        rows.sort(key=lambda row: int(row.get("reputation_score", 0)), reverse=True)
        return rows[:limit]

    def public_profile_from_record(
        self, profile: dict[str, Any], dependencies: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        return self.get_public_profile(profile["wallet_address"], dependencies) or dict(profile)

    def _achievement_list(self, wallet_address: str, achievements: Any = None) -> list[dict[str, Any]]:
        if achievements is None:
            return []
        try:
            return list(achievements.get_achievements(wallet_address))
        except (ValueError, AttributeError):
            return []

    def _public_badges(self, wallet_address: str, achievements: Any = None, profile_badges: list[str] | None = None) -> list[Any]:
        badges: list[Any] = list(profile_badges or [])
        badges.extend(self._achievement_list(wallet_address, achievements))
        return badges

    def _avatar_style(self, value: Any) -> str:
        normalized = self._optional_text(value or "gradient", "avatar style", 24).lower() or "gradient"
        if normalized not in self.ALLOWED_AVATAR_STYLES:
            raise ValueError("avatar style is not valid")
        return normalized

    def _badges(self, value: Any) -> list[str]:
        if value in (None, ""):
            return []
        if not isinstance(value, list):
            raise ValueError("badges must be a list")
        badges = []
        for item in value[:20]:
            badges.append(self._require_text(item, "badge", 40))
        return badges

    def _optional_url(self, value: Any, field_name: str) -> str:
        if value in (None, ""):
            return ""
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"{field_name} must be a safe http or https URL")
        text = value.replace("\x00", "").strip()
        if len(text) > 240:
            raise ValueError(f"{field_name} must be 240 characters or fewer")
        if "<" in text or ">" in text:
            raise ValueError(f"{field_name} contains unsafe markup")
        parsed = urlparse(text)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError(f"{field_name} must be a safe http or https URL")
        return text

    def _optional_text(self, value: Any, field_name: str, max_length: int) -> str:
        if value in (None, ""):
            return ""
        return self._require_text(value, field_name, max_length)

    def _require_text(self, value: Any, field_name: str, max_length: int) -> str:
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"{field_name} is required")
        text = value.replace("\x00", "").strip()
        if len(text) > max_length:
            raise ValueError(f"{field_name} must be {max_length} characters or fewer")
        if self._unsafe_text(text):
            raise ValueError(f"{field_name} contains unsafe markup")
        return text

    def _unsafe_text(self, text: str) -> bool:
        lowered = text.casefold()
        return "<" in text or ">" in text or "javascript:" in lowered or "data:" in lowered

    def _page_values(self, limit: int, offset: int) -> tuple[int, int]:
        limit = int(limit)
        offset = int(offset)
        if limit <= 0:
            raise ValueError("limit must be greater than zero")
        if offset < 0:
            raise ValueError("offset must be zero or greater")
        return min(limit, 200), offset
