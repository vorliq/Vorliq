from __future__ import annotations

import os
from decimal import Decimal
from typing import Any, Callable

from achievements import Achievements
from block import Block
from blockchain import Blockchain
from exchange import Exchange
from faucet import Faucet
from forum import Forum
from governance import Governance
from lending import LendingPool
from price import PriceDiscovery
from profiles import Profiles
from registry import NodeRegistry
from treasury import Treasury

from .base import StorageAdapter


COUNT_TABLES = [
    "blocks",
    "confirmed_transactions",
    "pending_transactions",
    "profiles",
    "registry_nodes",
    "lending_loans",
    "exchange_offers",
    "governance_proposals",
    "governance_rule_changes",
    "treasury_proposals",
    "treasury_ledger",
    "price_signals",
    "forum_posts",
    "forum_replies",
    "achievements",
    "faucet_claims",
    "incidents",
    "analytics_events",
    "reports",
]


class PostgresAdapterUnavailable(RuntimeError):
    pass


class PostgresWriteBlockedError(RuntimeError):
    pass


class PostgresStorageAdapter(StorageAdapter):
    """Experimental PostgreSQL adapter for shadow reads and tests only."""

    adapter_name = "postgres"

    def __init__(
        self,
        database_url: str | None = None,
        *,
        connect_timeout: int = 5,
        write_mode: str | None = None,
    ) -> None:
        self._database_url = (
            database_url
            or os.environ.get("VORLIQ_POSTGRES_SHADOW_DATABASE_URL")
            or os.environ.get("SHADOW_DATABASE_URL")
        )
        self.connect_timeout = connect_timeout
        self.write_mode = write_mode or os.environ.get("VORLIQ_POSTGRES_WRITE_MODE", "disabled")

    @property
    def configured(self) -> bool:
        return bool(self._database_url)

    def _load_psycopg(self) -> Any:
        try:
            import psycopg
        except Exception as exc:
            raise PostgresAdapterUnavailable("psycopg is not installed") from exc
        return psycopg

    def _connect(self) -> Any:
        if not self._database_url:
            raise PostgresAdapterUnavailable("PostgreSQL adapter is not configured")
        psycopg = self._load_psycopg()
        return psycopg.connect(self._database_url, connect_timeout=self.connect_timeout)

    def _query_all(self, sql: str, params: tuple[Any, ...] = ()) -> list[tuple[Any, ...]]:
        with self._connect() as conn:
            with conn.cursor() as cursor:
                cursor.execute(sql, params)
                return list(cursor.fetchall())

    def _safe_read(self, default: Any, reader: Callable[[], Any]) -> Any:
        try:
            return reader()
        except Exception:
            return default

    def load_chain(self) -> Blockchain | None:
        def read() -> Blockchain | None:
            rows = self._query_all("SELECT raw_block_json FROM blocks ORDER BY block_index ASC")
            if not rows:
                return None
            blockchain = Blockchain()
            blockchain.chain = [Block.from_dict(row[0]) for row in rows]
            latest_difficulty = getattr(blockchain.chain[-1], "difficulty", None)
            if latest_difficulty is not None:
                blockchain.difficulty = int(latest_difficulty)
                blockchain.proof_target = "0" * blockchain.difficulty
            return blockchain

        return self._safe_read(None, read)

    def save_chain(self, blockchain: Any) -> None:
        self._blocked_write("chain")

    def load_pending(self) -> list[dict[str, Any]]:
        return self._safe_read(
            [],
            lambda: [
                row[0]
                for row in self._query_all(
                    "SELECT raw_transaction_json FROM pending_transactions ORDER BY transaction_timestamp NULLS LAST, pending_pk"
                )
                if isinstance(row[0], dict)
            ],
        )

    def save_pending(self, pending_transactions: list[Any]) -> None:
        self._blocked_write("pending transactions")

    def load_lending_pool(self) -> LendingPool:
        pool = LendingPool()

        def read() -> LendingPool:
            for loan_id, raw in self._query_all("SELECT loan_id, raw_loan_json FROM lending_loans ORDER BY loan_id"):
                if isinstance(raw, dict):
                    pool.loan_requests[str(loan_id)] = raw
            return pool

        return self._safe_read(pool, read)

    def save_lending_pool(self, lending_pool: Any) -> None:
        self._blocked_write("lending pool")

    def load_exchange(self) -> Exchange:
        exchange = Exchange()

        def read() -> Exchange:
            for offer_id, raw in self._query_all("SELECT offer_id, raw_offer_json FROM exchange_offers ORDER BY offer_id"):
                if isinstance(raw, dict):
                    exchange.offers[str(offer_id)] = raw
            return exchange

        return self._safe_read(exchange, read)

    def save_exchange(self, exchange: Any) -> None:
        self._blocked_write("exchange")

    def load_governance(self) -> Governance:
        governance = Governance()

        def read() -> Governance:
            for proposal_id, raw in self._query_all("SELECT proposal_id, raw_proposal_json FROM governance_proposals ORDER BY proposal_id"):
                if isinstance(raw, dict):
                    governance.proposals[str(proposal_id)] = raw
            governance.rule_changes = [
                row[0]
                for row in self._query_all("SELECT raw_rule_change_json FROM governance_rule_changes ORDER BY rule_change_id")
                if isinstance(row[0], dict)
            ]
            return governance

        return self._safe_read(governance, read)

    def save_governance(self, governance: Any) -> None:
        self._blocked_write("governance")

    def load_treasury(self) -> Treasury:
        treasury = Treasury()

        def read() -> Treasury:
            for proposal_id, raw in self._query_all("SELECT proposal_id, raw_proposal_json FROM treasury_proposals ORDER BY proposal_id"):
                if isinstance(raw, dict):
                    treasury.proposals[str(proposal_id)] = raw
            return treasury

        return self._safe_read(treasury, read)

    def save_treasury(self, treasury: Any) -> None:
        self._blocked_write("treasury")

    def load_profiles(self) -> Profiles:
        profiles = Profiles()

        def read() -> Profiles:
            for wallet_address, raw in self._query_all("SELECT wallet_address, raw_profile_json FROM profiles ORDER BY wallet_address"):
                if isinstance(raw, dict):
                    profiles.profiles[str(wallet_address)] = raw
            return profiles

        return self._safe_read(profiles, read)

    def save_profiles(self, profiles: Any) -> None:
        self._blocked_write("profiles")

    def load_forum(self) -> Forum:
        forum = Forum()

        def read() -> Forum:
            for post_id, raw in self._query_all("SELECT post_id, raw_post_json FROM forum_posts ORDER BY post_timestamp NULLS LAST, post_id"):
                if isinstance(raw, dict):
                    forum.posts[str(post_id)] = raw
            return forum

        return self._safe_read(forum, read)

    def save_forum(self, forum: Any) -> None:
        self._blocked_write("forum")

    def load_registry(self) -> NodeRegistry:
        registry = NodeRegistry()

        def read() -> NodeRegistry:
            for node_url, raw in self._query_all("SELECT node_url, raw_node_json FROM registry_nodes ORDER BY node_url"):
                if isinstance(raw, dict):
                    registry.registered_nodes[str(node_url)] = raw
            return registry

        return self._safe_read(registry, read)

    def save_registry(self, registry: Any) -> None:
        self._blocked_write("registry")

    def load_faucet(self) -> Faucet:
        faucet = Faucet()

        def read() -> Faucet:
            for claim_id, raw in self._query_all("SELECT claim_id, raw_claim_json FROM faucet_claims ORDER BY claim_id"):
                if isinstance(raw, dict):
                    faucet.claims[str(claim_id)] = raw
            return faucet

        return self._safe_read(faucet, read)

    def save_faucet(self, faucet: Any) -> None:
        self._blocked_write("faucet")

    def load_price(self) -> PriceDiscovery:
        price = PriceDiscovery()

        def read() -> PriceDiscovery:
            for signal_id, raw in self._query_all("SELECT signal_id, raw_signal_json FROM price_signals ORDER BY signal_id"):
                if isinstance(raw, dict):
                    price.signals[str(signal_id)] = raw
            return price

        return self._safe_read(price, read)

    def save_price(self, price: Any) -> None:
        self._blocked_write("price discovery")

    def load_achievements(self) -> Achievements:
        achievements = Achievements()

        def read() -> Achievements:
            rows = self._query_all(
                "SELECT wallet_address, achievement_id, raw_achievement_json FROM achievements ORDER BY wallet_address, achievement_id"
            )
            for wallet_address, achievement_id, raw in rows:
                wallet_records = achievements.earned.setdefault(str(wallet_address), {})
                wallet_records[str(achievement_id)] = raw if isinstance(raw, dict) else {"achievement_id": str(achievement_id)}
            return achievements

        return self._safe_read(achievements, read)

    def save_achievements(self, achievements: Any) -> None:
        self._blocked_write("achievements")

    def load_blocks(self) -> list[dict[str, Any]]:
        return self._safe_read(
            [],
            lambda: [
                row[0]
                for row in self._query_all("SELECT raw_block_json FROM blocks ORDER BY block_index ASC")
                if isinstance(row[0], dict)
            ],
        )

    def load_confirmed_transactions(self) -> list[dict[str, Any]]:
        return self._safe_read(
            [],
            lambda: [
                row[0]
                for row in self._query_all(
                    "SELECT raw_transaction_json FROM confirmed_transactions ORDER BY block_index ASC, transaction_index ASC"
                )
                if isinstance(row[0], dict)
            ],
        )

    def latest_block_metadata(self) -> dict[str, Any]:
        def read() -> dict[str, Any]:
            rows = self._query_all("SELECT block_index, block_hash FROM blocks ORDER BY block_index DESC LIMIT 1")
            if not rows:
                return {"height": None, "latest_block_hash": None}
            return {"height": int(rows[0][0]), "latest_block_hash": str(rows[0][1])}

        return self._safe_read({"height": None, "latest_block_hash": None}, read)

    def table_counts(self) -> dict[str, int]:
        def read() -> dict[str, int]:
            counts: dict[str, int] = {}
            with self._connect() as conn:
                with conn.cursor() as cursor:
                    for table in COUNT_TABLES:
                        cursor.execute(f"SELECT count(*) FROM {table}")
                        counts[table] = int(cursor.fetchone()[0])
            return counts

        return self._safe_read({}, read)

    def health(self) -> dict[str, Any]:
        base: dict[str, Any] = {
            "success": True,
            "adapter": self.adapter_name,
            "experimental": True,
            "shadow_only": True,
            "configured": self.configured,
            "connected": False,
            "status": "warning" if not self.configured else "unknown",
            "message": "PostgreSQL adapter is shadow-only and is not configured for runtime reads.",
            "write_mode": "shadow_test" if self.write_mode == "shadow_test" else "disabled",
            "secrets_redacted": True,
        }
        if not self.configured:
            return base
        try:
            with self._connect() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("SELECT 1")
                    cursor.fetchone()
            counts = self.table_counts()
            latest = self.latest_block_metadata()
            return {
                **base,
                "connected": True,
                "status": "ok",
                "message": "PostgreSQL shadow adapter can read the configured shadow database.",
                "table_counts": counts,
                "chain": latest,
            }
        except Exception:
            return {
                **base,
                "status": "warning",
                "message": "PostgreSQL shadow adapter could not connect using the configured test connection.",
            }

    def _blocked_write(self, domain: str) -> None:
        if self.write_mode != "shadow_test":
            raise PostgresWriteBlockedError(
                f"PostgreSQL adapter writes are disabled for {domain}; set VORLIQ_POSTGRES_WRITE_MODE=shadow_test only in shadow tests."
            )
        raise NotImplementedError(
            "PostgreSQL adapter write methods are reserved for shadow tests; use tools/postgres_shadow_migrate.py for current imports."
        )


def decimal_to_public(value: Decimal | None) -> str | None:
    return str(value) if value is not None else None
