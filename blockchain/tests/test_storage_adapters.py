import json

import pytest

from blockchain import Blockchain
from storage_adapters.factory import (
    StorageAdapterConfigurationError,
    create_storage_adapter,
    storage_adapter_runtime_metadata,
)
from storage_adapters.json_adapter import JsonStorageAdapter
from storage_adapters.postgres_adapter import PostgresStorageAdapter, PostgresWriteBlockedError
from transaction import SYSTEM_ADDRESS, Transaction


def test_json_adapter_wraps_existing_storage_with_temp_data(tmp_path):
    adapter = JsonStorageAdapter(data_dir=tmp_path)
    blockchain = Blockchain()
    pending = [Transaction(SYSTEM_ADDRESS, "VLQ_TEST_RECEIVER", 2.5)]

    adapter.save_chain(blockchain)
    adapter.save_pending(pending)

    restored_chain = adapter.load_chain()
    restored_pending = adapter.load_pending()
    health = adapter.health()

    assert restored_chain is not None
    assert restored_chain.get_latest_block().hash == blockchain.get_latest_block().hash
    assert restored_pending[0]["receiver_address"] == "VLQ_TEST_RECEIVER"
    assert health["storage_backend"] == "json"
    assert health["postgres_adapter_enabled"] is False
    assert (tmp_path / "chain.json").exists()


def test_factory_defaults_to_json(tmp_path, monkeypatch):
    monkeypatch.delenv("VORLIQ_STORAGE_BACKEND", raising=False)
    monkeypatch.delenv("VORLIQ_ALLOW_EXPERIMENTAL_POSTGRES", raising=False)
    monkeypatch.delenv("VORLIQ_POSTGRES_SHADOW_ONLY", raising=False)
    monkeypatch.delenv("NODE_ENV", raising=False)

    adapter = create_storage_adapter(data_dir=tmp_path)

    assert isinstance(adapter, JsonStorageAdapter)


def test_factory_refuses_postgres_in_production(monkeypatch):
    monkeypatch.setenv("VORLIQ_STORAGE_BACKEND", "postgres")
    monkeypatch.setenv("VORLIQ_ALLOW_EXPERIMENTAL_POSTGRES", "true")
    monkeypatch.setenv("VORLIQ_POSTGRES_SHADOW_ONLY", "true")
    monkeypatch.setenv("NODE_ENV", "production")

    with pytest.raises(StorageAdapterConfigurationError, match="blocked in production"):
        create_storage_adapter()


def test_factory_refuses_postgres_when_flask_env_is_production(monkeypatch):
    monkeypatch.setenv("VORLIQ_STORAGE_BACKEND", "postgres")
    monkeypatch.setenv("VORLIQ_ALLOW_EXPERIMENTAL_POSTGRES", "true")
    monkeypatch.setenv("VORLIQ_POSTGRES_SHADOW_ONLY", "true")
    monkeypatch.setenv("NODE_ENV", "test")
    monkeypatch.setenv("FLASK_ENV", "production")

    with pytest.raises(StorageAdapterConfigurationError, match="blocked in production"):
        create_storage_adapter()


def test_factory_refuses_postgres_without_experimental_flag(monkeypatch):
    monkeypatch.setenv("VORLIQ_STORAGE_BACKEND", "postgres")
    monkeypatch.delenv("VORLIQ_ALLOW_EXPERIMENTAL_POSTGRES", raising=False)
    monkeypatch.setenv("NODE_ENV", "test")

    with pytest.raises(StorageAdapterConfigurationError, match="VORLIQ_ALLOW_EXPERIMENTAL_POSTGRES"):
        create_storage_adapter()


def test_factory_allows_postgres_only_for_explicit_shadow_tests(monkeypatch):
    monkeypatch.setenv("VORLIQ_STORAGE_BACKEND", "postgres")
    monkeypatch.setenv("VORLIQ_ALLOW_EXPERIMENTAL_POSTGRES", "true")
    monkeypatch.setenv("VORLIQ_POSTGRES_SHADOW_ONLY", "true")
    monkeypatch.setenv("NODE_ENV", "test")

    adapter = create_storage_adapter()

    assert isinstance(adapter, PostgresStorageAdapter)
    assert adapter.health()["shadow_only"] is True


def test_postgres_adapter_initializes_without_leaking_secrets(monkeypatch):
    monkeypatch.delenv("SHADOW_DATABASE_URL", raising=False)
    database_url = "postgresql://user:super-secret-password@example.invalid:5432/vorliq_shadow"
    adapter = PostgresStorageAdapter(database_url=database_url, connect_timeout=1)

    health_json = json.dumps(adapter.health(), sort_keys=True)

    assert "super-secret-password" not in health_json
    assert database_url not in health_json
    assert "example.invalid" not in health_json
    assert "secrets_redacted" in health_json


def test_postgres_adapter_read_methods_fail_gracefully_without_connection(monkeypatch):
    monkeypatch.delenv("SHADOW_DATABASE_URL", raising=False)
    monkeypatch.delenv("VORLIQ_POSTGRES_SHADOW_DATABASE_URL", raising=False)
    adapter = PostgresStorageAdapter(database_url=None)

    assert adapter.load_chain() is None
    assert adapter.load_pending() == []
    assert adapter.load_blocks() == []
    assert adapter.load_confirmed_transactions() == []
    assert adapter.load_profiles().profiles == {}
    assert adapter.load_forum().posts == {}
    assert adapter.health()["configured"] is False


def test_postgres_write_methods_are_blocked_by_default(monkeypatch):
    monkeypatch.delenv("VORLIQ_POSTGRES_WRITE_MODE", raising=False)
    adapter = PostgresStorageAdapter(database_url=None)

    with pytest.raises(PostgresWriteBlockedError):
        adapter.save_pending([])


def test_postgres_write_mode_requires_explicit_shadow_test(monkeypatch):
    monkeypatch.setenv("VORLIQ_POSTGRES_WRITE_MODE", "shadow_test")
    adapter = PostgresStorageAdapter(database_url=None)

    with pytest.raises(NotImplementedError, match="shadow tests"):
        adapter.save_pending([])


def test_storage_health_metadata_is_safe(monkeypatch):
    monkeypatch.setenv("VORLIQ_STORAGE_BACKEND", "postgres")
    monkeypatch.setenv("VORLIQ_ALLOW_EXPERIMENTAL_POSTGRES", "true")
    monkeypatch.setenv("VORLIQ_POSTGRES_SHADOW_ONLY", "true")
    monkeypatch.setenv("NODE_ENV", "production")
    metadata = storage_adapter_runtime_metadata()

    assert metadata["storage_backend"] == "json"
    assert metadata["active_storage_adapter"] == "json"
    assert metadata["postgres_adapter_available"] is True
    assert metadata["postgres_adapter_enabled"] is False
    assert metadata["postgres_write_mode"] == "disabled"
    assert metadata["postgres_runtime_blocked_in_production"] is True
    assert "blocked in production" in metadata["storage_backend_configuration_error"]
