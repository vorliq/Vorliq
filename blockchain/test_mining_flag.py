from __future__ import annotations

import os
import sys
import threading

import pytest

from mining_flag import mining_enabled


def test_flag_unset_keeps_mining_disabled(monkeypatch) -> None:
    monkeypatch.delenv("VORLIQ_MINING_ENABLED", raising=False)
    assert mining_enabled() is False


@pytest.mark.parametrize(
    "malformed_value",
    ["", " ", "0", "1", "yes", "on", "enabled", "false", "TruE!", "true mining"],
)
def test_flag_malformed_keeps_mining_disabled(monkeypatch, malformed_value: str) -> None:
    monkeypatch.setenv("VORLIQ_MINING_ENABLED", malformed_value)
    assert mining_enabled() is False


@pytest.mark.parametrize("enabled_value", ["true", "TRUE", " true ", "True"])
def test_flag_explicit_true_enables_mining(monkeypatch, enabled_value: str) -> None:
    monkeypatch.setenv("VORLIQ_MINING_ENABLED", enabled_value)
    assert mining_enabled() is True


@pytest.fixture(scope="module")
def mine_app(tmp_path_factory):
    data_dir = tmp_path_factory.mktemp("vorliq-flag-data")
    previous_data_dir = os.environ.get("VORLIQ_DATA_DIR")
    previous_flag = os.environ.get("VORLIQ_MINING_ENABLED")
    os.environ["VORLIQ_DATA_DIR"] = str(data_dir)
    os.environ.pop("VORLIQ_MINING_ENABLED", None)
    sys.modules.pop("app", None)
    import app as app_module

    yield app_module

    if previous_data_dir is None:
        os.environ.pop("VORLIQ_DATA_DIR", None)
    else:
        os.environ["VORLIQ_DATA_DIR"] = previous_data_dir
    if previous_flag is None:
        os.environ.pop("VORLIQ_MINING_ENABLED", None)
    else:
        os.environ["VORLIQ_MINING_ENABLED"] = previous_flag


def test_mine_route_refuses_when_flag_unset(mine_app, monkeypatch) -> None:
    monkeypatch.delenv("VORLIQ_MINING_ENABLED", raising=False)
    client = mine_app.app.test_client()

    response = client.post("/mine", json={"miner_address": "VLQ_FLAG_TEST"})

    assert response.status_code == 503
    payload = response.get_json()
    assert payload["success"] is False
    assert payload["code"] == "MINING_DISABLED"
    assert mine_app.node.blockchain.get_block_height() == 0


def test_mine_route_refuses_when_flag_malformed(mine_app, monkeypatch) -> None:
    monkeypatch.setenv("VORLIQ_MINING_ENABLED", "yes")
    client = mine_app.app.test_client()

    response = client.post("/mine", json={"miner_address": "VLQ_FLAG_TEST"})

    assert response.status_code == 503
    assert response.get_json()["code"] == "MINING_DISABLED"
    assert mine_app.node.blockchain.get_block_height() == 0


def test_mining_status_reports_disabled_when_flag_unset(mine_app, monkeypatch) -> None:
    monkeypatch.delenv("VORLIQ_MINING_ENABLED", raising=False)
    client = mine_app.app.test_client()

    response = client.get("/mining/status")

    assert response.status_code == 200
    payload = response.get_json()
    assert payload["enabled"] is False
    assert payload["can_mine_now"] is False
    assert payload["reason_if_not"] == "Mining is disabled on this node."


def test_mine_route_allows_mining_when_flag_enabled(mine_app, monkeypatch) -> None:
    from wallet import Wallet

    monkeypatch.setenv("VORLIQ_MINING_ENABLED", "true")
    client = mine_app.app.test_client()
    blockchain = mine_app.node.blockchain
    height_before = blockchain.get_block_height()

    # The enabled path must still go through the serialized append.
    assert isinstance(blockchain._append_lock, type(threading.Lock()))

    response = client.post("/mine", json={"miner_address": Wallet().address})

    assert response.status_code == 201
    payload = response.get_json()
    assert payload["success"] is True
    assert blockchain.get_block_height() == height_before + 1
    assert blockchain.is_chain_valid()
