from __future__ import annotations

import json
import re
import time
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any
from urllib.parse import urlparse, urlunparse


REPO_ROOT = Path(__file__).resolve().parents[1]
DATABASE_DIR = REPO_ROOT / "database"
DEFAULT_DATA_DIR = REPO_ROOT / "blockchain" / "data"

SQL_FILES = [
    "schema.sql",
    "constraints.sql",
    "indexes.sql",
    "views.sql",
    "migrations/001_initial_schema.sql",
]

SHADOW_TABLES = [
    "analytics_events",
    "audit_exports_metadata",
    "storage_health_snapshots",
    "incidents",
    "faucet_claims",
    "achievements",
    "reports",
    "forum_replies",
    "forum_posts",
    "price_signals",
    "profiles",
    "treasury_ledger",
    "treasury_proposals",
    "governance_rule_changes",
    "governance_proposals",
    "exchange_offers",
    "lending_loans",
    "registry_nodes",
    "peers",
    "pending_transactions",
    "confirmed_transactions",
    "blocks",
    "schema_migrations",
]

SHADOW_VIEWS = [
    "public_storage_readiness",
    "miner_leaderboard",
    "address_activity",
    "explorer_confirmed_transactions",
    "explorer_latest_blocks",
]

OPTIONAL_FILES = {
    "pending": "pending.json",
    "peers": "peers.json",
    "registry": "registry.json",
    "lending": "lending.json",
    "exchange": "exchange.json",
    "governance": "governance.json",
    "treasury": "treasury.json",
    "price": "price.json",
    "forum": "forum.json",
    "achievements": "achievements.json",
    "profiles": "profiles.json",
    "faucet": "faucet.json",
    "indexes": "indexes.json",
}

BACKEND_FILES = {
    "analytics": "analytics.json",
    "incidents": "incidents.json",
    "reports": "reports.json",
}

PRODUCTION_DB_PATTERN = re.compile(r"(prod|production|primary|live|vorliq_prod|vorliq-production)", re.IGNORECASE)
PRODUCTION_HOST_PATTERN = re.compile(r"(vorliq\.org|node\.vorliq\.org|prod|production|primary|live|159\.65\.24\.177)", re.IGNORECASE)
SECRET_TEXT_PATTERN = re.compile(
    r"(BEGIN [A-Z ]*PRIVATE KEY|ADMIN_TOKEN|SERVER_SSH_KEY|ssh-rsa|ssh-ed25519|password\s*[:=]|private[_-]?key|/home/vorliq)",
    re.IGNORECASE,
)


def iso_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def redact_database_url(database_url: str) -> str:
    parsed = urlparse(database_url)
    scheme = parsed.scheme or "postgresql"
    return urlunparse((scheme, "[redacted]", "/[redacted]", "", "", ""))


def parse_database_url(database_url: str) -> dict[str, str]:
    parsed = urlparse(database_url)
    database_name = parsed.path.lstrip("/")
    return {
        "scheme": parsed.scheme,
        "host": parsed.hostname or "",
        "database": database_name,
        "redacted": redact_database_url(database_url),
    }


def validate_shadow_database_url(database_url: str | None, *, intent_flag: bool = False) -> tuple[str | None, list[str]]:
    errors: list[str] = []
    if not database_url:
        return None, ["SHADOW_DATABASE_URL or --database-url is required"]

    info = parse_database_url(database_url)
    scheme = info["scheme"].lower()
    host = info["host"].lower()
    database_name = info["database"].lower()

    if scheme not in {"postgresql", "postgres"}:
        errors.append("database URL must use the postgresql:// scheme")
    if not database_name:
        errors.append("database URL must include a database name")
    if not ("shadow" in database_name or "test" in database_name):
        errors.append("database name must contain 'shadow' or 'test'")
    if PRODUCTION_DB_PATTERN.search(database_name):
        errors.append("database name looks production-like and is refused")
    if PRODUCTION_HOST_PATTERN.search(host):
        errors.append("database host looks production-like and is refused")
    if not intent_flag and database_name and not ("shadow" in database_name or "test" in database_name):
        errors.append("--i-understand-this-is-not-production does not override the shadow/test database-name requirement")

    return database_url, errors


def backend_data_dir_for(data_dir: Path, backend_data_dir: Path | None = None) -> Path | None:
    if backend_data_dir:
        return backend_data_dir
    if data_dir.name == "data" and data_dir.parent.name == "blockchain":
        candidate = data_dir.parent.parent / "backend" / "data"
        return candidate if candidate.exists() else None
    candidate = data_dir / "backend"
    return candidate if candidate.exists() else None


def read_json(path: Path, *, required: bool, strict: bool, warnings: list[str], errors: list[str]) -> Any:
    if not path.exists():
        message = f"{path.name} is {'required' if required else 'optional'} but missing"
        if required or strict:
            errors.append(message)
        else:
            warnings.append(message)
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        errors.append(f"{path.name} could not be parsed as JSON: {exc}")
        return None


def load_shadow_source(data_dir: Path, *, backend_data_dir: Path | None = None, strict: bool = False) -> dict[str, Any]:
    warnings: list[str] = []
    errors: list[str] = []
    data_dir = data_dir.resolve()
    source: dict[str, Any] = {
        "data_dir": str(data_dir),
        "backend_data_dir": None,
        "files": {},
        "warnings": warnings,
        "errors": errors,
    }

    source["files"]["chain"] = read_json(data_dir / "chain.json", required=True, strict=strict, warnings=warnings, errors=errors)
    for name, file_name in OPTIONAL_FILES.items():
        source["files"][name] = read_json(data_dir / file_name, required=False, strict=strict, warnings=warnings, errors=errors)

    resolved_backend = backend_data_dir_for(data_dir, backend_data_dir)
    if resolved_backend:
        source["backend_data_dir"] = str(resolved_backend.resolve())
        for name, file_name in BACKEND_FILES.items():
            source["files"][name] = read_json(resolved_backend / file_name, required=False, strict=strict, warnings=warnings, errors=errors)
    else:
        for name in BACKEND_FILES:
            source["files"][name] = None
        warnings.append("backend data directory was not provided; analytics, incidents, and reports were skipped")

    return source


def as_list(value: Any) -> list[Any]:
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        return list(value.values())
    return []


def as_mapping(value: Any, field: str) -> dict[str, Any]:
    if isinstance(value, dict) and isinstance(value.get(field), dict):
        return value[field]
    return {}


def to_decimal(value: Any) -> Decimal | None:
    if value is None or value == "":
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None


def tx_id(transaction: dict[str, Any], block_index: int | None = None, transaction_index: int | None = None) -> str:
    for key in ("tx_id", "transaction_id", "id"):
        if transaction.get(key):
            return str(transaction[key])
    return f"legacy:{block_index if block_index is not None else 'pending'}:{transaction_index if transaction_index is not None else 0}"


def transaction_sender(transaction: dict[str, Any]) -> str | None:
    value = transaction.get("sender_address") or transaction.get("senderAddress") or transaction.get("sender")
    return str(value) if value else None


def transaction_receiver(transaction: dict[str, Any]) -> str | None:
    value = transaction.get("receiver_address") or transaction.get("receiverAddress") or transaction.get("receiver")
    return str(value) if value else None


def transaction_type(transaction: dict[str, Any]) -> str | None:
    value = transaction.get("type") or transaction.get("transaction_type") or transaction.get("category")
    return str(value) if value else None


def chain_blocks(source: dict[str, Any]) -> list[dict[str, Any]]:
    chain = source.get("files", {}).get("chain")
    if isinstance(chain, dict) and isinstance(chain.get("chain"), list):
        return [block for block in chain["chain"] if isinstance(block, dict)]
    return []


def confirmed_transactions(source: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for block in chain_blocks(source):
        block_index = int(block.get("index") or 0)
        block_hash = str(block.get("hash") or "")
        for transaction_index, transaction in enumerate(block.get("transactions") or []):
            if not isinstance(transaction, dict):
                continue
            current_tx_id = tx_id(transaction, block_index, transaction_index)
            rows.append(
                {
                    "transaction_pk": f"{block_hash}:{transaction_index}:{current_tx_id}",
                    "tx_id": current_tx_id,
                    "block_hash": block_hash,
                    "block_index": block_index,
                    "transaction_index": transaction_index,
                    "sender_address": transaction_sender(transaction),
                    "receiver_address": transaction_receiver(transaction),
                    "amount": to_decimal(transaction.get("amount")),
                    "transaction_type": transaction_type(transaction),
                    "category": transaction.get("category"),
                    "transaction_timestamp": transaction.get("timestamp"),
                    "raw_transaction_json": transaction,
                }
            )
    return rows


def pending_transactions(source: dict[str, Any]) -> list[dict[str, Any]]:
    pending = source.get("files", {}).get("pending")
    rows: list[dict[str, Any]] = []
    for index, transaction in enumerate(pending if isinstance(pending, list) else []):
        if not isinstance(transaction, dict):
            continue
        current_tx_id = tx_id(transaction, None, index)
        rows.append(
            {
                "pending_pk": f"pending:{index}:{current_tx_id}",
                "tx_id": current_tx_id,
                "sender_address": transaction_sender(transaction),
                "receiver_address": transaction_receiver(transaction),
                "amount": to_decimal(transaction.get("amount")),
                "transaction_type": transaction_type(transaction),
                "category": transaction.get("category"),
                "transaction_timestamp": transaction.get("timestamp"),
                "raw_transaction_json": transaction,
            }
        )
    return rows


def expected_counts(source: dict[str, Any]) -> dict[str, int]:
    files = source.get("files", {})
    forum_posts = as_mapping(files.get("forum"), "posts")
    indexes = files.get("indexes") if isinstance(files.get("indexes"), dict) else {}
    treasury_ledger = ((indexes.get("indexes") or {}).get("treasury_ledger_index") or []) if isinstance(indexes, dict) else []
    achievements = achievement_rows(source)
    return {
        "blocks": len(chain_blocks(source)),
        "confirmed_transactions": len(confirmed_transactions(source)),
        "pending_transactions": len(pending_transactions(source)),
        "profiles": len(as_mapping(files.get("profiles"), "profiles")),
        "registry_nodes": len(as_mapping(files.get("registry"), "registered_nodes")),
        "lending_loans": len(as_mapping(files.get("lending"), "loan_requests")),
        "exchange_offers": len(as_mapping(files.get("exchange"), "offers")),
        "governance_proposals": len(as_mapping(files.get("governance"), "proposals")),
        "governance_rule_changes": len(as_list((files.get("governance") or {}).get("rule_changes")) if isinstance(files.get("governance"), dict) else []),
        "treasury_proposals": len(as_mapping(files.get("treasury"), "proposals")),
        "treasury_ledger": len(treasury_ledger),
        "price_signals": len(as_mapping(files.get("price"), "signals")),
        "forum_posts": len(forum_posts),
        "forum_replies": sum(len(post.get("replies", []) or []) for post in forum_posts.values() if isinstance(post, dict)),
        "achievements": len(achievements),
        "faucet_claims": len(as_mapping(files.get("faucet"), "claims")),
        "incidents": len(as_list((files.get("incidents") or {}).get("incidents")) if isinstance(files.get("incidents"), dict) else []),
        "analytics_events": len(as_list((files.get("analytics") or {}).get("events")) if isinstance(files.get("analytics"), dict) else []),
        "reports": len(as_list((files.get("reports") or {}).get("reports")) if isinstance(files.get("reports"), dict) else []),
    }


def achievement_rows(source: dict[str, Any]) -> list[dict[str, Any]]:
    earned = as_mapping(source.get("files", {}).get("achievements"), "earned")
    rows: list[dict[str, Any]] = []
    for wallet_address, achievements in earned.items():
        if isinstance(achievements, dict):
            iterable = achievements.items()
        elif isinstance(achievements, list):
            iterable = [(str(item.get("achievement_id") or item.get("id") or index), item) for index, item in enumerate(achievements) if isinstance(item, dict)]
        else:
            iterable = []
        for achievement_id, payload in iterable:
            raw = payload if isinstance(payload, dict) else {"achievement_id": achievement_id, "earned_at": payload}
            rows.append(
                {
                    "achievement_pk": f"{wallet_address}:{achievement_id}",
                    "wallet_address": str(wallet_address),
                    "achievement_id": str(raw.get("achievement_id") or raw.get("id") or achievement_id),
                    "earned_at": raw.get("earned_at") or raw.get("timestamp"),
                    "raw_achievement_json": raw,
                }
            )
    return rows


def compute_balances_from_transactions(confirmed: list[dict[str, Any]], pending: list[dict[str, Any]] | None = None) -> dict[str, Decimal]:
    balances: dict[str, Decimal] = {}
    for row in [*confirmed, *(pending or [])]:
        amount = row.get("amount")
        if amount is None:
            continue
        amount = Decimal(str(amount))
        sender = row.get("sender_address")
        receiver = row.get("receiver_address")
        if sender and sender != "SYSTEM":
            balances[sender] = balances.get(sender, Decimal("0")) - amount
        if receiver:
            balances[receiver] = balances.get(receiver, Decimal("0")) + amount
    return balances


def contains_secret_text(value: Any) -> bool:
    try:
        text = json.dumps(value, sort_keys=True, default=str)
    except TypeError:
        text = str(value)
    return bool(SECRET_TEXT_PATTERN.search(text))


def load_psycopg():
    try:
        import psycopg
        from psycopg.types.json import Jsonb
    except Exception as exc:  # pragma: no cover - exercised when local optional dependency is absent.
        raise RuntimeError(
            "psycopg is required for PostgreSQL shadow rehearsal. Install psycopg[binary] or run the CI PostgreSQL job."
        ) from exc
    return psycopg, Jsonb
