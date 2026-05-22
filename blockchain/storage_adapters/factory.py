from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from .base import StorageAdapter
from .json_adapter import JsonStorageAdapter
from .postgres_adapter import PostgresStorageAdapter


class StorageAdapterConfigurationError(RuntimeError):
    pass


def _truthy(value: str | None) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def _node_env(env: dict[str, str] | None = None) -> str:
    source = env or os.environ
    node_env = str(source.get("NODE_ENV") or "").strip().lower()
    flask_env = str(source.get("FLASK_ENV") or "").strip().lower()
    if "production" in {node_env, flask_env}:
        return "production"
    return node_env or flask_env


def validate_storage_backend_config(
    backend: str | None = None,
    *,
    env: dict[str, str] | None = None,
) -> str:
    source = env or os.environ
    selected = str(backend or source.get("VORLIQ_STORAGE_BACKEND") or "json").strip().lower()
    if selected in {"", "json"}:
        return "json"
    if selected != "postgres":
        raise StorageAdapterConfigurationError("Unsupported storage backend.")

    if _node_env(source) == "production":
        raise StorageAdapterConfigurationError(
            "PostgreSQL storage backend is blocked in production; production must start with VORLIQ_STORAGE_BACKEND=json."
        )
    if not _truthy(source.get("VORLIQ_ALLOW_EXPERIMENTAL_POSTGRES")):
        raise StorageAdapterConfigurationError(
            "PostgreSQL storage backend requires VORLIQ_ALLOW_EXPERIMENTAL_POSTGRES=true."
        )
    if not _truthy(source.get("VORLIQ_POSTGRES_SHADOW_ONLY")):
        raise StorageAdapterConfigurationError(
            "PostgreSQL storage backend requires VORLIQ_POSTGRES_SHADOW_ONLY=true for shadow/test use."
        )
    if _node_env(source) == "production":
        raise StorageAdapterConfigurationError("PostgreSQL storage backend is not allowed in production.")
    return "postgres"


def create_storage_adapter(
    data_dir: str | Path | None = None,
    *,
    backend: str | None = None,
    database_url: str | None = None,
    env: dict[str, str] | None = None,
) -> StorageAdapter:
    selected = validate_storage_backend_config(backend, env=env)
    if selected == "json":
        return JsonStorageAdapter(data_dir=data_dir)
    return PostgresStorageAdapter(database_url=database_url)


def storage_adapter_runtime_metadata(env: dict[str, str] | None = None) -> dict[str, Any]:
    source = env or os.environ
    requested = str(source.get("VORLIQ_STORAGE_BACKEND") or "json").strip().lower() or "json"
    production = _node_env(source) == "production"
    postgres_requested = requested == "postgres"
    try:
        validate_storage_backend_config(requested, env=source)
        blocked_reason = None
    except StorageAdapterConfigurationError as exc:
        blocked_reason = str(exc)
    return {
        "storage_adapter_interface_available": True,
        "storage_backend": "json",
        "active_storage_adapter": "json",
        "requested_storage_backend": requested,
        "postgres_adapter_available": True,
        "postgres_adapter_enabled": False,
        "postgres_active": False,
        "postgres_write_mode": "disabled",
        "postgres_runtime_blocked_in_production": True,
        "postgres_requested": postgres_requested,
        "production_runtime": production,
        "storage_backend_configuration_error": blocked_reason if postgres_requested else None,
    }
