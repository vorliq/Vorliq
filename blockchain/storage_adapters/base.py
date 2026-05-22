from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class StorageAdapter(ABC):
    """Abstract storage boundary for Vorliq domain state.

    The current production implementation is JSON. Alternative adapters must
    preserve the same domain ownership and never rewrite historical blocks.
    """

    adapter_name: str

    @abstractmethod
    def load_chain(self) -> Any:
        raise NotImplementedError

    @abstractmethod
    def save_chain(self, blockchain: Any) -> None:
        raise NotImplementedError

    @abstractmethod
    def load_pending(self) -> list[dict[str, Any]]:
        raise NotImplementedError

    @abstractmethod
    def save_pending(self, pending_transactions: list[Any]) -> None:
        raise NotImplementedError

    @abstractmethod
    def load_lending_pool(self) -> Any:
        raise NotImplementedError

    @abstractmethod
    def save_lending_pool(self, lending_pool: Any) -> None:
        raise NotImplementedError

    @abstractmethod
    def load_exchange(self) -> Any:
        raise NotImplementedError

    @abstractmethod
    def save_exchange(self, exchange: Any) -> None:
        raise NotImplementedError

    @abstractmethod
    def load_governance(self) -> Any:
        raise NotImplementedError

    @abstractmethod
    def save_governance(self, governance: Any) -> None:
        raise NotImplementedError

    @abstractmethod
    def load_treasury(self) -> Any:
        raise NotImplementedError

    @abstractmethod
    def save_treasury(self, treasury: Any) -> None:
        raise NotImplementedError

    @abstractmethod
    def load_profiles(self) -> Any:
        raise NotImplementedError

    @abstractmethod
    def save_profiles(self, profiles: Any) -> None:
        raise NotImplementedError

    @abstractmethod
    def load_forum(self) -> Any:
        raise NotImplementedError

    @abstractmethod
    def save_forum(self, forum: Any) -> None:
        raise NotImplementedError

    @abstractmethod
    def load_registry(self) -> Any:
        raise NotImplementedError

    @abstractmethod
    def save_registry(self, registry: Any) -> None:
        raise NotImplementedError

    @abstractmethod
    def load_faucet(self) -> Any:
        raise NotImplementedError

    @abstractmethod
    def save_faucet(self, faucet: Any) -> None:
        raise NotImplementedError

    @abstractmethod
    def load_price(self) -> Any:
        raise NotImplementedError

    @abstractmethod
    def save_price(self, price: Any) -> None:
        raise NotImplementedError

    @abstractmethod
    def load_achievements(self) -> Any:
        raise NotImplementedError

    @abstractmethod
    def save_achievements(self, achievements: Any) -> None:
        raise NotImplementedError

    @abstractmethod
    def health(self) -> dict[str, Any]:
        raise NotImplementedError
