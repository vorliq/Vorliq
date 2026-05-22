from __future__ import annotations

from pathlib import Path
from typing import Any

from storage import Storage

from .base import StorageAdapter


class JsonStorageAdapter(StorageAdapter):
    """Adapter wrapper around the hardened JSON Storage implementation."""

    adapter_name = "json"

    def __init__(self, data_dir: str | Path | None = None, storage: Storage | None = None) -> None:
        self.storage = storage or Storage(data_dir)

    def load_chain(self) -> Any:
        return self.storage.load_chain()

    def save_chain(self, blockchain: Any) -> None:
        self.storage.save_chain(blockchain)

    def load_pending(self) -> list[dict[str, Any]]:
        return self.storage.load_pending()

    def save_pending(self, pending_transactions: list[Any]) -> None:
        self.storage.save_pending(pending_transactions)

    def load_lending_pool(self) -> Any:
        return self.storage.load_lending_pool()

    def save_lending_pool(self, lending_pool: Any) -> None:
        self.storage.save_lending_pool(lending_pool)

    def load_exchange(self) -> Any:
        return self.storage.load_exchange()

    def save_exchange(self, exchange: Any) -> None:
        self.storage.save_exchange(exchange)

    def load_governance(self) -> Any:
        return self.storage.load_governance()

    def save_governance(self, governance: Any) -> None:
        self.storage.save_governance(governance)

    def load_treasury(self) -> Any:
        return self.storage.load_treasury()

    def save_treasury(self, treasury: Any) -> None:
        self.storage.save_treasury(treasury)

    def load_profiles(self) -> Any:
        return self.storage.load_profiles()

    def save_profiles(self, profiles: Any) -> None:
        self.storage.save_profiles(profiles)

    def load_forum(self) -> Any:
        return self.storage.load_forum()

    def save_forum(self, forum: Any) -> None:
        self.storage.save_forum(forum)

    def load_registry(self) -> Any:
        return self.storage.load_registry()

    def save_registry(self, registry: Any) -> None:
        self.storage.save_registry(registry)

    def load_faucet(self) -> Any:
        return self.storage.load_faucet()

    def save_faucet(self, faucet: Any) -> None:
        self.storage.save_faucet(faucet)

    def load_price(self) -> Any:
        return self.storage.load_price_discovery()

    def save_price(self, price: Any) -> None:
        self.storage.save_price_discovery(price)

    def load_achievements(self) -> Any:
        return self.storage.load_achievements()

    def save_achievements(self, achievements: Any) -> None:
        self.storage.save_achievements(achievements)

    def health(self) -> dict[str, Any]:
        health = self.storage.storage_health()
        return {
            **health,
            "adapter": self.adapter_name,
            "storage_adapter_interface_available": True,
            "storage_backend": "json",
            "active_storage_adapter": "json",
            "postgres_adapter_available": True,
            "postgres_adapter_enabled": False,
            "postgres_active": False,
            "postgres_write_mode": "disabled",
            "postgres_runtime_blocked_in_production": True,
        }
