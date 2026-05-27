from __future__ import annotations

import re
import time
from typing import Any, Callable
from urllib.parse import urlparse, urlunparse

from logger import vorliq_logger


class NodeRegistry:
    active_window_seconds = 30 * 60
    stale_window_seconds = 7 * 24 * 60 * 60
    history_limit = 100
    lifecycle_history_limit = 100
    display_name_limit = 64
    description_limit = 300
    location_limit = 80
    lifecycle_statuses = {"active", "stale", "inactive", "archived", "retired"}
    explicit_lifecycle_statuses = {"archived", "retired"}

    def __init__(self) -> None:
        self.registered_nodes: dict[str, dict[str, Any]] = {}

    def register_node(
        self,
        node_url: str,
        display_name: str,
        description: str = "",
        region: str = "",
        country: str = "",
        operator_wallet_address: str = "",
        software_version: str = "",
        is_public: bool = True,
    ) -> dict[str, Any]:
        normalized_url = self._normalize_node_url(node_url)
        now = time.time()
        existing = self._normalize_node(self.registered_nodes.get(normalized_url, {}), normalized_url)

        existing.update(
            {
                "node_url": normalized_url,
                "display_name": self._require_text(display_name, "display_name", self.display_name_limit),
                "description": self._optional_text(description, "description", self.description_limit),
                "region": self._optional_text(region, "region", self.location_limit),
                "country": self._optional_text(country, "country", self.location_limit),
                "operator_wallet_address": self._optional_text(operator_wallet_address, "operator_wallet_address", 160),
                "software_version": self._optional_text(software_version, "software_version", 80),
                "registered_at": float(existing.get("registered_at") or now),
                "last_seen": float(existing.get("last_seen") or now),
                "is_public": bool(is_public),
                "is_verified_operator": bool(existing.get("is_verified_operator", False)),
            }
        )

        self.registered_nodes[normalized_url] = self._normalize_node(existing, normalized_url)
        vorliq_logger.info("Registry node registered: %s as %s", normalized_url, existing["display_name"])
        return self.get_node(normalized_url) or self.registered_nodes[normalized_url]

    def heartbeat(
        self,
        node_url: str,
        public_chain_height: int = 0,
        display_name: str | None = None,
        chain_height: int | None = None,
        last_block_hash: str | None = None,
        chain_valid: bool | None = None,
        software_version: str | None = None,
        operator_wallet_address: str | None = None,
        response_time_ms: int | None = None,
        snapshot_hash: str | None = None,
        snapshot_signature_verified: bool | None = None,
        region: str | None = None,
        country: str | None = None,
    ) -> dict[str, Any]:
        normalized_url = self._normalize_node_url(node_url)
        now = time.time()
        node = self._normalize_node(self.registered_nodes.get(normalized_url, {}), normalized_url)

        if display_name is not None and str(display_name).strip():
            node["display_name"] = self._require_text(display_name, "display_name", self.display_name_limit)
        if software_version is not None:
            node["software_version"] = self._optional_text(software_version, "software_version", 80)
        if operator_wallet_address is not None:
            node["operator_wallet_address"] = self._optional_text(operator_wallet_address, "operator_wallet_address", 160)
        if region is not None:
            node["region"] = self._optional_text(region, "region", self.location_limit)
        if country is not None:
            node["country"] = self._optional_text(country, "country", self.location_limit)

        node["last_seen"] = now
        node["last_heartbeat_at"] = now
        node["last_chain_height"] = self._optional_int(chain_height)
        node["last_block_hash"] = self._optional_text(last_block_hash, "last_block_hash", 160)
        node["last_diagnostics_status"] = "valid" if chain_valid is True else "invalid" if chain_valid is False else "unknown"
        if snapshot_hash is not None:
            node["snapshot_hash"] = self._optional_text(snapshot_hash, "snapshot_hash", 160)
        if snapshot_signature_verified is not None:
            node["snapshot_signature_verified"] = bool(snapshot_signature_verified)
        node["sync_status"] = self._sync_status(node["last_chain_height"], bool(chain_valid), public_chain_height)

        history_status = "online"
        if node["sync_status"] in {"synced", "behind", "invalid", "unknown"}:
            history_status = node["sync_status"]
        self._append_history(
            node,
            {
                "timestamp": now,
                "status": history_status,
                "chain_height": node["last_chain_height"],
                "last_block_hash": node["last_block_hash"],
                "response_time_ms": self._optional_int(response_time_ms),
                "message": self._history_message(node["sync_status"]),
            },
        )
        self._recalculate_scores(node)
        self.registered_nodes[normalized_url] = node
        vorliq_logger.info("Registry heartbeat received from %s", normalized_url)
        return self.get_node(normalized_url) or node

    def get_active_nodes(self, profile_lookup: Callable[[str], dict[str, Any] | None] | None = None) -> list[dict[str, Any]]:
        cutoff = time.time() - self.active_window_seconds
        return [
            self._public_node(node, profile_lookup)
            for node in self._sorted_nodes()
            if self._is_active(node, cutoff) and self.classify_node_lifecycle(node)["lifecycle_status"] == "active"
        ]

    def get_all_nodes(
        self,
        status: str | None = None,
        country: str | None = None,
        sync_status: str | None = None,
        lifecycle_status: str | None = None,
        include_archived: bool = False,
        profile_lookup: Callable[[str], dict[str, Any] | None] | None = None,
    ) -> list[dict[str, Any]]:
        cutoff = time.time() - self.active_window_seconds
        lifecycle_filter = self._normalize_lifecycle_status(lifecycle_status) if lifecycle_status else ""
        nodes = []
        for node in self._sorted_nodes():
            public = self._public_node(node, profile_lookup)
            node_lifecycle = str(public.get("lifecycle_status") or "inactive")
            if not include_archived and not lifecycle_filter and node_lifecycle in {"archived", "retired"}:
                continue
            if lifecycle_filter and node_lifecycle != lifecycle_filter:
                continue
            if status:
                normalized_status = status.lower()
                if normalized_status == "active" and not self._is_active(node, cutoff):
                    continue
                if normalized_status == "inactive" and self._is_active(node, cutoff):
                    continue
            if country and str(public.get("country", "")).lower() != country.lower():
                continue
            if sync_status and public.get("sync_status") != sync_status:
                continue
            nodes.append(public)
        return nodes

    def get_node(
        self,
        node_url: str,
        profile_lookup: Callable[[str], dict[str, Any] | None] | None = None,
    ) -> dict[str, Any] | None:
        normalized_url = self._normalize_node_url(node_url)
        node = self.registered_nodes.get(normalized_url)
        if not node:
            return None
        return self._public_node(self._normalize_node(node, normalized_url), profile_lookup)

    def get_lifecycle_nodes(
        self,
        lifecycle_status: str | None = None,
        include_archived: bool = False,
        profile_lookup: Callable[[str], dict[str, Any] | None] | None = None,
    ) -> list[dict[str, Any]]:
        return self.get_all_nodes(
            lifecycle_status=lifecycle_status,
            include_archived=include_archived or bool(lifecycle_status),
            profile_lookup=profile_lookup,
        )

    def get_summary(self, public_chain_height: int = 0) -> dict[str, Any]:
        cutoff = time.time() - self.active_window_seconds
        active = 0
        synced = 0
        behind = 0
        invalid = 0
        unknown = 0
        highest_height = 0
        latest_hash = ""
        reliability_scores: list[int] = []

        for node in self._sorted_nodes():
            lifecycle = self.classify_node_lifecycle(node)
            if lifecycle["lifecycle_status"] == "active":
                active += 1
            sync_status = self._current_sync_status(node, public_chain_height)
            if sync_status == "synced":
                synced += 1
            elif sync_status == "behind":
                behind += 1
            elif sync_status == "invalid":
                invalid += 1
            else:
                unknown += 1
            height = int(node.get("last_chain_height") or 0)
            if height >= highest_height:
                highest_height = height
                latest_hash = str(node.get("last_block_hash") or latest_hash)
            reliability_scores.append(int(node.get("reliability_score") or 0))

        average_reliability = round(sum(reliability_scores) / len(reliability_scores)) if reliability_scores else 0
        return {
            "active_node_count": active,
            "total_registered_node_count": len(self.registered_nodes),
            "synced_node_count": synced,
            "behind_node_count": behind,
            "invalid_node_count": invalid,
            "unknown_node_count": unknown,
            "average_reliability_score": average_reliability,
            "highest_chain_height": highest_height,
            "latest_block_hash": latest_hash,
            **self.summarize_node_lifecycle(),
        }

    def summarize_node_lifecycle(self) -> dict[str, int]:
        summary = {
            "active_count": 0,
            "stale_count": 0,
            "inactive_count": 0,
            "archived_count": 0,
            "retired_count": 0,
            "visible_public_count": 0,
            "total_count": len(self.registered_nodes),
        }
        for node in self._sorted_nodes():
            lifecycle_status = self.classify_node_lifecycle(node)["lifecycle_status"]
            key = f"{lifecycle_status}_count"
            if key in summary:
                summary[key] += 1
            if lifecycle_status not in {"archived", "retired"}:
                summary["visible_public_count"] += 1
        return summary

    def archive_node(
        self,
        node_url: str,
        reason: str,
        changed_by: str = "admin",
        trusted_public_node_url: str = "https://node.vorliq.org",
        force: bool = False,
    ) -> dict[str, Any]:
        normalized_url = self._normalize_node_url(node_url)
        trusted_url = self._normalize_node_url(trusted_public_node_url)
        if normalized_url == trusted_url and not force:
            raise ValueError("Trusted public node cannot be archived without force=true.")
        return self._set_lifecycle_status(normalized_url, "archived", reason, changed_by)

    def restore_node(self, node_url: str, reason: str, changed_by: str = "admin") -> dict[str, Any]:
        normalized_url = self._normalize_node_url(node_url)
        node = self._require_registry_node(normalized_url)
        current = self.classify_node_lifecycle(node)
        restored = self._classify_time_based_lifecycle(node)
        updated = self.apply_node_lifecycle(
            node,
            {
                "lifecycle_status": restored,
                "reason": reason,
                "changed_by": changed_by,
                "from_status": current["lifecycle_status"],
            },
        )
        updated["lifecycle_status"] = ""
        updated["archived_at"] = ""
        updated["archived_by"] = ""
        updated["retired_at"] = ""
        updated["retired_by"] = ""
        self.registered_nodes[normalized_url] = self._normalize_node(updated, normalized_url)
        return self.get_node(normalized_url) or self._public_node(updated)

    def retire_node(self, node_url: str, reason: str, changed_by: str = "admin") -> dict[str, Any]:
        normalized_url = self._normalize_node_url(node_url)
        return self._set_lifecycle_status(normalized_url, "retired", reason, changed_by)

    def _set_lifecycle_status(self, normalized_url: str, status: str, reason: str, changed_by: str) -> dict[str, Any]:
        node = self._require_registry_node(normalized_url)
        updated = self.apply_node_lifecycle(
            node,
            {
                "lifecycle_status": status,
                "reason": reason,
                "changed_by": changed_by,
            },
        )
        self.registered_nodes[normalized_url] = self._normalize_node(updated, normalized_url)
        return self.get_node(normalized_url) or self._public_node(updated)

    def _require_registry_node(self, normalized_url: str) -> dict[str, Any]:
        node = self.registered_nodes.get(normalized_url)
        if not node:
            raise ValueError("Node not found")
        return self._normalize_node(node, normalized_url)

    def classify_node_lifecycle(
        self,
        node: dict[str, Any],
        now: float | None = None,
        options: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        now = float(now if now is not None else time.time())
        options = options or {}
        normalized_status = self._normalize_lifecycle_status(node.get("lifecycle_status"))
        base = {
            "lifecycle_reason": self._optional_text(node.get("lifecycle_reason"), "lifecycle_reason", 300),
            "archived_at": self._optional_text(node.get("archived_at"), "archived_at", 80),
            "archived_by": self._optional_text(node.get("archived_by"), "archived_by", 80),
            "retired_at": self._optional_text(node.get("retired_at"), "retired_at", 80),
            "retired_by": self._optional_text(node.get("retired_by"), "retired_by", 80),
            "last_lifecycle_change": self._optional_text(node.get("last_lifecycle_change"), "last_lifecycle_change", 80),
            "lifecycle_history": [
                self._normalize_lifecycle_history_entry(entry)
                for entry in (node.get("lifecycle_history") if isinstance(node.get("lifecycle_history"), list) else [])
            ][-self.lifecycle_history_limit :],
        }
        if normalized_status in self.explicit_lifecycle_statuses:
            return {"lifecycle_status": normalized_status, **base}
        return {"lifecycle_status": self._classify_time_based_lifecycle(node, now, options), **base}

    def apply_node_lifecycle(self, node: dict[str, Any], lifecycle_update: dict[str, Any]) -> dict[str, Any]:
        status = self._normalize_lifecycle_status(lifecycle_update.get("lifecycle_status"))
        if not status:
            raise ValueError("lifecycle_status is required")
        now_iso = self._optional_text(lifecycle_update.get("timestamp") or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "timestamp", 80)
        reason = self._optional_text(lifecycle_update.get("reason") or lifecycle_update.get("lifecycle_reason"), "lifecycle_reason", 300)
        changed_by = self._optional_text(lifecycle_update.get("changed_by") or "admin", "changed_by", 80) or "admin"
        previous_status = self._normalize_lifecycle_status(lifecycle_update.get("from_status")) or self.classify_node_lifecycle(node)["lifecycle_status"]
        updated = dict(node)
        history = [
            self._normalize_lifecycle_history_entry(entry)
            for entry in (updated.get("lifecycle_history") if isinstance(updated.get("lifecycle_history"), list) else [])
        ]
        history.append(
            self._normalize_lifecycle_history_entry(
                {
                    "timestamp": now_iso,
                    "from_status": previous_status,
                    "to_status": status,
                    "reason": reason,
                    "changed_by": changed_by,
                }
            )
        )
        updated["lifecycle_status"] = status if status in self.explicit_lifecycle_statuses else ""
        updated["lifecycle_reason"] = reason
        updated["last_lifecycle_change"] = now_iso
        updated["lifecycle_history"] = history[-self.lifecycle_history_limit :]
        if status == "archived":
            updated["archived_at"] = now_iso
            updated["archived_by"] = changed_by
        if status == "retired":
            updated["retired_at"] = now_iso
            updated["retired_by"] = changed_by
        return updated

    def mark_offline(self, node_url: str, message: str = "Node health check failed") -> dict[str, Any] | None:
        normalized_url = self._normalize_node_url(node_url)
        node = self.registered_nodes.get(normalized_url)
        if not node:
            return None
        node = self._normalize_node(node, normalized_url)
        self._append_history(
            node,
            {
                "timestamp": time.time(),
                "status": "offline",
                "chain_height": node.get("last_chain_height"),
                "last_block_hash": node.get("last_block_hash"),
                "response_time_ms": None,
                "message": self._optional_text(message, "message", 160),
            },
        )
        self._recalculate_scores(node)
        self.registered_nodes[normalized_url] = node
        return self._public_node(node)

    def _normalize_node(self, node: dict[str, Any], node_url: str) -> dict[str, Any]:
        now = time.time()
        normalized = dict(node or {})
        normalized["node_url"] = self._normalize_node_url(normalized.get("node_url") or node_url)
        normalized["display_name"] = self._optional_text(
            normalized.get("display_name") or "Vorliq Node",
            "display_name",
            self.display_name_limit,
        ) or "Vorliq Node"
        normalized["description"] = self._optional_text(normalized.get("description"), "description", self.description_limit)
        normalized["region"] = self._optional_text(normalized.get("region"), "region", self.location_limit)
        normalized["country"] = self._optional_text(normalized.get("country"), "country", self.location_limit)
        normalized["operator_wallet_address"] = self._optional_text(
            normalized.get("operator_wallet_address"),
            "operator_wallet_address",
            160,
        )
        normalized["software_version"] = self._optional_text(normalized.get("software_version"), "software_version", 80)
        normalized["registered_at"] = float(normalized.get("registered_at") or now)
        normalized["last_seen"] = float(normalized.get("last_seen") or normalized["registered_at"])
        normalized["last_heartbeat_at"] = float(normalized.get("last_heartbeat_at") or 0)
        normalized["last_chain_height"] = self._optional_int(normalized.get("last_chain_height"))
        normalized["last_block_hash"] = self._optional_text(normalized.get("last_block_hash"), "last_block_hash", 160)
        normalized["snapshot_hash"] = self._optional_text(normalized.get("snapshot_hash"), "snapshot_hash", 160)
        normalized["snapshot_signature_verified"] = bool(normalized.get("snapshot_signature_verified", False))
        normalized["last_diagnostics_status"] = self._optional_text(
            normalized.get("last_diagnostics_status") or "unknown",
            "last_diagnostics_status",
            32,
        )
        normalized["uptime_score"] = int(normalized.get("uptime_score") or 0)
        normalized["reliability_score"] = int(normalized.get("reliability_score") or 0)
        normalized["sync_status"] = self._optional_text(normalized.get("sync_status") or "unknown", "sync_status", 32)
        normalized["is_public"] = bool(normalized.get("is_public", True))
        normalized["is_verified_operator"] = bool(normalized.get("is_verified_operator", False))
        normalized["lifecycle_status"] = (
            self._normalize_lifecycle_status(normalized.get("lifecycle_status"))
            if self._normalize_lifecycle_status(normalized.get("lifecycle_status")) in self.explicit_lifecycle_statuses
            else ""
        )
        normalized["lifecycle_reason"] = self._optional_text(normalized.get("lifecycle_reason"), "lifecycle_reason", 300)
        normalized["archived_at"] = self._optional_text(normalized.get("archived_at"), "archived_at", 80)
        normalized["archived_by"] = self._optional_text(normalized.get("archived_by"), "archived_by", 80)
        normalized["retired_at"] = self._optional_text(normalized.get("retired_at"), "retired_at", 80)
        normalized["retired_by"] = self._optional_text(normalized.get("retired_by"), "retired_by", 80)
        normalized["last_lifecycle_change"] = self._optional_text(normalized.get("last_lifecycle_change"), "last_lifecycle_change", 80)
        lifecycle_history = normalized.get("lifecycle_history") if isinstance(normalized.get("lifecycle_history"), list) else []
        normalized["lifecycle_history"] = [
            self._normalize_lifecycle_history_entry(entry)
            for entry in lifecycle_history
        ][-self.lifecycle_history_limit :]
        history = normalized.get("status_history") if isinstance(normalized.get("status_history"), list) else []
        normalized["status_history"] = [self._normalize_history_entry(entry) for entry in history][-self.history_limit :]
        return normalized

    def _public_node(
        self,
        node: dict[str, Any],
        profile_lookup: Callable[[str], dict[str, Any] | None] | None = None,
    ) -> dict[str, Any]:
        normalized = self._normalize_node(node, str(node.get("node_url")))
        lifecycle = self.classify_node_lifecycle(normalized)
        public = {
            "node_url": normalized["node_url"],
            "display_name": normalized["display_name"],
            "operator_wallet_address": normalized["operator_wallet_address"],
            "operator_profile": None,
            "description": normalized["description"],
            "region": normalized["region"],
            "country": normalized["country"],
            "software_version": normalized["software_version"],
            "registered_at": normalized["registered_at"],
            "last_seen": normalized["last_seen"],
            "last_heartbeat_at": normalized["last_heartbeat_at"],
            "last_chain_height": normalized["last_chain_height"],
            "last_block_hash": normalized["last_block_hash"],
            "snapshot_hash": normalized["snapshot_hash"],
            "snapshot_signature_verified": normalized["snapshot_signature_verified"],
            "last_diagnostics_status": normalized["last_diagnostics_status"],
            "uptime_score": normalized["uptime_score"],
            "reliability_score": normalized["reliability_score"],
            "sync_status": normalized["sync_status"],
            "is_public": normalized["is_public"],
            "is_verified_operator": normalized["is_verified_operator"],
            "active": lifecycle["lifecycle_status"] == "active",
            "lifecycle_status": lifecycle["lifecycle_status"],
            "lifecycle_reason": lifecycle["lifecycle_reason"],
            "archived_at": lifecycle["archived_at"],
            "archived_by": lifecycle["archived_by"],
            "retired_at": lifecycle["retired_at"],
            "retired_by": lifecycle["retired_by"],
            "last_lifecycle_change": lifecycle["last_lifecycle_change"],
            "lifecycle_history": lifecycle["lifecycle_history"],
            "status_history": normalized["status_history"],
        }
        wallet = normalized.get("operator_wallet_address")
        if wallet and profile_lookup:
            try:
                public["operator_profile"] = profile_lookup(wallet)
            except Exception:
                public["operator_profile"] = None
        return public

    def _sync_status(self, chain_height: int | None, chain_valid: bool, public_chain_height: int) -> str:
        if chain_valid is False:
            return "invalid"
        if chain_height is None:
            return "unknown"
        if int(chain_height) >= max(0, int(public_chain_height) - 1):
            return "synced"
        return "behind"

    def _current_sync_status(self, node: dict[str, Any], public_chain_height: int) -> str:
        if not self._is_active(node):
            return "unknown"
        if node.get("last_diagnostics_status") == "invalid":
            return "invalid"
        return self._sync_status(self._optional_int(node.get("last_chain_height")), node.get("last_diagnostics_status") != "invalid", public_chain_height)

    def _append_history(self, node: dict[str, Any], entry: dict[str, Any]) -> None:
        history = node.get("status_history") if isinstance(node.get("status_history"), list) else []
        history.append(self._normalize_history_entry(entry))
        node["status_history"] = history[-self.history_limit :]

    def _normalize_history_entry(self, entry: Any) -> dict[str, Any]:
        if not isinstance(entry, dict):
            entry = {}
        return {
            "timestamp": float(entry.get("timestamp") or time.time()),
            "status": self._optional_text(entry.get("status") or "unknown", "status", 32),
            "chain_height": self._optional_int(entry.get("chain_height")),
            "last_block_hash": self._optional_text(entry.get("last_block_hash"), "last_block_hash", 160),
            "response_time_ms": self._optional_int(entry.get("response_time_ms")),
            "message": self._optional_text(entry.get("message"), "message", 160),
        }

    def _normalize_lifecycle_history_entry(self, entry: Any) -> dict[str, Any]:
        if not isinstance(entry, dict):
            entry = {}
        return {
            "timestamp": self._optional_text(entry.get("timestamp") or entry.get("changed_at"), "timestamp", 80),
            "from_status": self._normalize_lifecycle_status(entry.get("from_status") or entry.get("fromStatus")),
            "to_status": self._normalize_lifecycle_status(entry.get("to_status") or entry.get("toStatus") or entry.get("lifecycle_status")) or "inactive",
            "reason": self._optional_text(entry.get("reason") or entry.get("lifecycle_reason"), "reason", 300),
            "changed_by": self._optional_text(entry.get("changed_by") or entry.get("changedBy") or "system", "changed_by", 80) or "system",
        }

    def _recalculate_scores(self, node: dict[str, Any]) -> None:
        history = node.get("status_history") if isinstance(node.get("status_history"), list) else []
        if not history:
            node["uptime_score"] = 0
            node["reliability_score"] = 0
            return
        online_count = sum(1 for entry in history if entry.get("status") in {"online", "synced", "behind", "unknown"})
        reliable_count = sum(1 for entry in history if entry.get("status") in {"online", "synced"})
        node["uptime_score"] = round((online_count / len(history)) * 100)
        node["reliability_score"] = round((reliable_count / len(history)) * 100)

    def _sorted_nodes(self) -> list[dict[str, Any]]:
        normalized_nodes = []
        for node_url, node in list(self.registered_nodes.items()):
            normalized = self._normalize_node(node, node_url)
            self.registered_nodes[normalized["node_url"]] = normalized
            normalized_nodes.append(normalized)
        return sorted(normalized_nodes, key=lambda item: float(item.get("last_seen") or 0), reverse=True)

    def _is_active(self, node: dict[str, Any], cutoff: float | None = None) -> bool:
        cutoff = cutoff if cutoff is not None else time.time() - self.active_window_seconds
        return float(node.get("last_seen") or 0) >= cutoff

    def _classify_time_based_lifecycle(
        self,
        node: dict[str, Any],
        now: float | None = None,
        options: dict[str, Any] | None = None,
    ) -> str:
        now = float(now if now is not None else time.time())
        options = options or {}
        active_window = float(options.get("active_window_seconds") or self.active_window_seconds)
        stale_window = float(options.get("stale_window_seconds") or self.stale_window_seconds)
        try:
            last_seen = float(node.get("last_seen") or 0)
        except (TypeError, ValueError):
            last_seen = 0
        if last_seen >= now - active_window:
            return "active"
        if last_seen >= now - stale_window:
            return "stale"
        return "inactive"

    def _normalize_lifecycle_status(self, value: Any) -> str:
        if value is None:
            return ""
        normalized = str(value).replace("\x00", "").strip().lower()
        return normalized if normalized in self.lifecycle_statuses else ""

    def _history_message(self, sync_status: str) -> str:
        return {
            "synced": "Node heartbeat is valid and close to the public chain height.",
            "behind": "Node heartbeat is valid but behind the public chain height.",
            "invalid": "Node reported an invalid chain.",
            "unknown": "Node heartbeat did not include enough diagnostics.",
        }.get(sync_status, "Node heartbeat received.")

    def _normalize_node_url(self, node_url: str) -> str:
        if not isinstance(node_url, str) or not node_url.strip():
            raise ValueError("node_url must be a non-empty URL string")

        parsed = urlparse(node_url.strip().rstrip("/"))
        if parsed.scheme not in {"http", "https"}:
            raise ValueError("node_url must start with http:// or https://")
        if not parsed.hostname:
            raise ValueError("node_url must include a host")
        if parsed.username or parsed.password:
            raise ValueError("node_url must not include credentials")

        netloc = parsed.hostname.lower()
        if parsed.port:
            netloc = f"{netloc}:{parsed.port}"
        return urlunparse((parsed.scheme, netloc, "", "", "", ""))

    def _require_text(self, value: Any, field_name: str, max_length: int) -> str:
        normalized = self._optional_text(value, field_name, max_length)
        if not normalized:
            raise ValueError(f"{field_name} is required")
        return normalized

    def _optional_text(self, value: Any, field_name: str, max_length: int) -> str:
        if value is None:
            return ""
        if not isinstance(value, str):
            value = str(value)
        normalized = value.replace("\x00", "").strip()
        if re.search(r"<\s*/?\s*(script|iframe|object|embed|img|svg|html|body|style|link|meta)\b", normalized, re.I):
            raise ValueError(f"{field_name} contains unsafe markup")
        normalized = re.sub(r"<[^>]*>", "", normalized).strip()
        if len(normalized) > max_length:
            raise ValueError(f"{field_name} must be {max_length} characters or fewer")
        return normalized

    def _optional_int(self, value: Any) -> int | None:
        if value in {None, ""}:
            return None
        try:
            return int(value)
        except (TypeError, ValueError):
            return None
