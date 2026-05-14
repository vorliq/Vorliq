from __future__ import annotations

import time
from typing import Any
from urllib.parse import urlparse


class NodeRegistry:
    active_window_seconds = 30 * 60

    def __init__(self) -> None:
        self.registered_nodes: dict[str, dict[str, Any]] = {}

    def register_node(self, node_url: str, display_name: str) -> dict[str, Any]:
        normalized_url = self._normalize_node_url(node_url)
        display_name = self._require_display_name(display_name)
        now = time.time()

        existing_node = self.registered_nodes.get(normalized_url, {})
        self.registered_nodes[normalized_url] = {
            "node_url": normalized_url,
            "display_name": display_name,
            "registered_at": existing_node.get("registered_at", now),
            "last_seen": now,
        }

        return self.registered_nodes[normalized_url]

    def get_active_nodes(self) -> list[dict[str, Any]]:
        cutoff = time.time() - self.active_window_seconds
        return sorted(
            [
                node
                for node in self.registered_nodes.values()
                if float(node.get("last_seen", 0)) >= cutoff
            ],
            key=lambda node: float(node["last_seen"]),
            reverse=True,
        )

    def heartbeat(self, node_url: str) -> dict[str, Any]:
        normalized_url = self._normalize_node_url(node_url)
        now = time.time()

        if normalized_url not in self.registered_nodes:
            self.registered_nodes[normalized_url] = {
                "node_url": normalized_url,
                "display_name": "Vorliq Node",
                "registered_at": now,
                "last_seen": now,
            }
        else:
            self.registered_nodes[normalized_url]["last_seen"] = now

        return self.registered_nodes[normalized_url]

    def get_all_nodes(self) -> list[dict[str, Any]]:
        return sorted(
            self.registered_nodes.values(),
            key=lambda node: float(node.get("last_seen", 0)),
            reverse=True,
        )

    def _normalize_node_url(self, node_url: str) -> str:
        if not isinstance(node_url, str) or not node_url.strip():
            raise ValueError("node_url must be a non-empty URL string")

        node_url = node_url.strip().rstrip("/")
        parsed = urlparse(node_url)

        if parsed.scheme not in {"http", "https"}:
            raise ValueError("node_url must start with http:// or https://")

        if not parsed.hostname or not parsed.port:
            raise ValueError("node_url must include a host and port")

        return f"{parsed.scheme}://{parsed.hostname}:{parsed.port}"

    def _require_display_name(self, display_name: str) -> str:
        if not isinstance(display_name, str) or not display_name.strip():
            raise ValueError("display_name is required")
        return display_name.strip()[:80]
