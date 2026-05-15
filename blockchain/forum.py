from __future__ import annotations

import hashlib
import time
from typing import Any

from logger import vorliq_logger


class Forum:
    VALID_CATEGORIES = {"general", "mining", "lending", "exchange", "governance", "technical"}

    def __init__(self) -> None:
        self.posts: dict[str, dict[str, Any]] = {}

    def create_post(self, author_address: str, title: str, body: str, category: str = "general") -> str:
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
            "pinned": False,
            "timestamp": timestamp,
            "replies": [],
            "vote_count": 0,
            "voters": [],
        }
        vorliq_logger.info("Forum post created by %s with id %s", author_address, post_id)
        return post_id

    def add_reply(self, post_id: str, author_address: str, body: str) -> dict[str, Any]:
        post = self._get_existing_post(post_id)
        author_address = self._require_text(author_address, "author address")
        body = self._require_text(body, "body")
        timestamp = time.time()
        reply_id = hashlib.sha256(f"{post_id}{author_address}{timestamp}".encode("utf-8")).hexdigest()
        reply = {
            "reply_id": reply_id,
            "author_address": author_address,
            "body": body,
            "timestamp": timestamp,
            "vote_count": 0,
            "voters": [],
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
        post["pinned"] = bool(post.get("pinned", False))
        post["voters"] = list(post.get("voters", []))
        post["replies"] = list(post.get("replies", []))
        for reply in post["replies"]:
            reply["voters"] = list(reply.get("voters", []))
            reply["vote_count"] = int(reply.get("vote_count", 0))
