from __future__ import annotations

import hashlib
import time
from typing import Any

from logger import vorliq_logger
from transaction import Transaction


class Forum:
    VALID_CATEGORIES = {"general", "mining", "lending", "exchange", "governance", "technical"}

    def __init__(self) -> None:
        self.posts: dict[str, dict[str, Any]] = {}

    def create_post(
        self,
        author_address: str,
        title: str,
        body: str,
        category: str = "general",
        image_data: str | None = None,
    ) -> str:
        author_address = self._require_text(author_address, "author address")
        title = self._require_text(title, "title")
        body = self._require_text(body, "body")
        category = self._normalize_category(category)
        timestamp = time.time()
        post_id = hashlib.sha256(f"{author_address}{title}{timestamp}".encode("utf-8")).hexdigest()

        self.posts[post_id] = {
            "post_id": post_id,
            "author_address": author_address,
            "title": title,
            "body": body,
            "category": category,
            "image_data": self._normalize_image(image_data),
            "pinned": False,
            "featured": False,
            "feature_votes": [],
            "feature_vote_count": 0,
            "tips": [],
            "timestamp": timestamp,
            "replies": [],
            "vote_count": 0,
            "voters": [],
        }
        vorliq_logger.info("Forum post created by %s with id %s", author_address, post_id)
        return post_id

    def add_reply(
        self,
        post_id: str,
        author_address: str,
        body: str,
        image_data: str | None = None,
    ) -> dict[str, Any]:
        post = self._get_existing_post(post_id)
        author_address = self._require_text(author_address, "author address")
        body = self._require_text(body, "body")
        timestamp = time.time()
        reply_id = hashlib.sha256(f"{post_id}{author_address}{timestamp}".encode("utf-8")).hexdigest()
        reply = {
            "reply_id": reply_id,
            "author_address": author_address,
            "body": body,
            "image_data": self._normalize_image(image_data),
            "timestamp": timestamp,
            "vote_count": 0,
            "voters": [],
            "tips": [],
        }
        post["replies"].append(reply)
        vorliq_logger.info("Forum reply added to post %s by %s", post_id, author_address)
        return reply

    def upvote_post(self, post_id: str, address: str) -> dict[str, Any]:
        post = self._get_existing_post(post_id)
        address = self._require_text(address, "address")
        voters = set(post.get("voters", []))
        if address in voters:
            raise ValueError("address has already voted on this post")
        voters.add(address)
        post["voters"] = sorted(voters)
        post["vote_count"] = int(post.get("vote_count", 0)) + 1
        vorliq_logger.info("Forum post %s upvoted by %s", post_id, address)
        return post

    def upvote_reply(self, post_id: str, reply_id: str, address: str) -> dict[str, Any]:
        post = self._get_existing_post(post_id)
        address = self._require_text(address, "address")
        reply = self._get_existing_reply(post, reply_id)
        voters = set(reply.get("voters", []))
        if address in voters:
            raise ValueError("address has already voted on this reply")
        voters.add(address)
        reply["voters"] = sorted(voters)
        reply["vote_count"] = int(reply.get("vote_count", 0)) + 1
        vorliq_logger.info("Forum reply %s upvoted by %s", reply_id, address)
        return reply

    def feature_post(self, post_id: str, voter_address: str) -> dict[str, Any]:
        post = self._get_existing_post(post_id)
        voter_address = self._require_text(voter_address, "voter address")
        voters = set(post.get("feature_votes", []))
        if voter_address in voters:
            raise ValueError("address has already voted to feature this post")
        voters.add(voter_address)
        post["feature_votes"] = sorted(voters)
        post["feature_vote_count"] = len(voters)
        if post["feature_vote_count"] >= 5:
            post["featured"] = True
        vorliq_logger.info("Forum post %s received a feature vote from %s", post_id, voter_address)
        return post

    def get_all_posts(self) -> list[dict[str, Any]]:
        self._normalize_existing_posts()
        return sorted(
            self.posts.values(),
            key=lambda post: (
                bool(post.get("pinned", False)),
                int(post.get("vote_count", 0)),
                float(post.get("timestamp", 0)),
            ),
            reverse=True,
        )

    def get_post(self, post_id: str) -> dict[str, Any] | None:
        self._normalize_existing_posts()
        return self.posts.get(post_id)

    def get_featured_posts(self) -> list[dict[str, Any]]:
        self._normalize_existing_posts()
        return sorted(
            [post for post in self.posts.values() if bool(post.get("featured", False))],
            key=lambda post: (
                int(post.get("feature_vote_count", 0)),
                float(post.get("timestamp", 0)),
            ),
            reverse=True,
        )

    def search_posts(self, query: str) -> list[dict[str, Any]]:
        query = self._require_text(query, "query").casefold()
        return [
            post
            for post in self.get_all_posts()
            if query in str(post.get("title", "")).casefold()
            or query in str(post.get("body", "")).casefold()
        ]

    def pin_post(self, post_id: str) -> dict[str, Any]:
        post = self._get_existing_post(post_id)
        post["pinned"] = True
        vorliq_logger.info("Forum post %s was pinned", post_id)
        return post

    def tip_post(
        self,
        post_id: str,
        sender_address: str,
        receiver_address: str,
        amount: float,
        blockchain: Any,
        transaction: Transaction | None = None,
    ) -> dict[str, Any]:
        post = self._get_existing_post(post_id)
        tip = self._create_tip(sender_address, receiver_address, amount, blockchain, transaction)
        post.setdefault("tips", []).append(tip)
        vorliq_logger.info("Forum post %s received tip of %s VLQ", post_id, amount)
        return tip

    def tip_reply(
        self,
        post_id: str,
        reply_id: str,
        sender_address: str,
        receiver_address: str,
        amount: float,
        blockchain: Any,
        transaction: Transaction | None = None,
    ) -> dict[str, Any]:
        post = self._get_existing_post(post_id)
        reply = self._get_existing_reply(post, reply_id)
        tip = self._create_tip(sender_address, receiver_address, amount, blockchain, transaction)
        reply.setdefault("tips", []).append(tip)
        vorliq_logger.info("Forum reply %s received tip of %s VLQ", reply_id, amount)
        return tip

    def _get_existing_post(self, post_id: str) -> dict[str, Any]:
        post_id = self._require_text(post_id, "post ID")
        post = self.posts.get(post_id)
        if not post:
            raise ValueError("post does not exist")
        self._normalize_post(post)
        return post

    def _get_existing_reply(self, post: dict[str, Any], reply_id: str) -> dict[str, Any]:
        reply_id = self._require_text(reply_id, "reply ID")
        for reply in post.get("replies", []):
            if reply.get("reply_id") == reply_id:
                return reply
        raise ValueError("reply does not exist")

    def _require_text(self, value: str, field_name: str) -> str:
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"{field_name} must be a non-empty string")
        return value.strip()

    def _normalize_category(self, category: str) -> str:
        category = self._require_text(category or "general", "category").lower()
        if category not in self.VALID_CATEGORIES:
            raise ValueError(
                "category must be one of general, mining, lending, exchange, governance, or technical"
            )
        return category

    def _normalize_existing_posts(self) -> None:
        for post in self.posts.values():
            self._normalize_post(post)

    def _normalize_post(self, post: dict[str, Any]) -> None:
        post["category"] = post.get("category") if post.get("category") in self.VALID_CATEGORIES else "general"
        post["image_data"] = self._normalize_image(post.get("image_data"))
        post["pinned"] = bool(post.get("pinned", False))
        post["featured"] = bool(post.get("featured", False))
        legacy_feature_voters = post.pop("feature_voters", [])
        post["feature_votes"] = list(post.get("feature_votes", legacy_feature_voters))
        post["feature_vote_count"] = int(post.get("feature_vote_count", len(post["feature_votes"])))
        if post["feature_vote_count"] >= 5:
            post["featured"] = True
        post["voters"] = list(post.get("voters", []))
        post["replies"] = list(post.get("replies", []))
        post["tips"] = list(post.get("tips", []))
        for reply in post["replies"]:
            reply["voters"] = list(reply.get("voters", []))
            reply["vote_count"] = int(reply.get("vote_count", 0))
            reply["tips"] = list(reply.get("tips", []))
            reply["image_data"] = self._normalize_image(reply.get("image_data"))

    def _normalize_image(self, image_data: str | None) -> str | None:
        if image_data is None or image_data == "":
            return None
        if not isinstance(image_data, str):
            raise ValueError("image data must be a string")
        if not image_data.startswith("data:image/"):
            raise ValueError("image must be a browser image data URL")
        if len(image_data) > 2_000_000:
            raise ValueError("image is too large; please use an image under 2 MB")
        return image_data

    def _create_tip(
        self,
        sender_address: str,
        receiver_address: str,
        amount: float,
        blockchain: Any,
        transaction: Transaction | None = None,
    ) -> dict[str, Any]:
        sender_address = self._require_text(sender_address, "sender address")
        receiver_address = self._require_text(receiver_address, "receiver address")
        amount = float(amount)
        if amount < 1 or amount > 100:
            raise ValueError("tip amount must be between 1 and 100 VLQ")
        if blockchain is None:
            raise ValueError("blockchain is required to submit a tip")

        tip_transaction = transaction or Transaction(sender_address, receiver_address, amount)
        blockchain.add_pending_transaction(tip_transaction)
        return {
            "sender_address": sender_address,
            "receiver_address": receiver_address,
            "amount": amount,
            "timestamp": time.time(),
        }
