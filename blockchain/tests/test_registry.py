import time

import pytest

from registry import NodeRegistry


def test_node_registration_validates_url_and_fields():
    registry = NodeRegistry()

    with pytest.raises(ValueError):
        registry.register_node("ftp://node.example.org", "Bad Node")

    with pytest.raises(ValueError):
        registry.register_node("https://node.example.org", "<script>alert(1)</script>")

    node = registry.register_node(
        "https://node.example.org/",
        "Community Node",
        description="Public node",
        region="Europe",
        country="United Kingdom",
        operator_wallet_address="wallet-1",
    )

    assert node["node_url"] == "https://node.example.org"
    assert node["display_name"] == "Community Node"
    assert node["operator_wallet_address"] == "wallet-1"
    assert node["is_verified_operator"] is False


def test_heartbeat_updates_diagnostics_fields():
    registry = NodeRegistry()
    registry.register_node("https://node.example.org", "Community Node")

    node = registry.heartbeat(
        "https://node.example.org",
        public_chain_height=25,
        chain_height=25,
        last_block_hash="abc123",
        chain_valid=True,
        software_version="1.0.0",
        response_time_ms=42,
    )

    assert node["last_chain_height"] == 25
    assert node["last_block_hash"] == "abc123"
    assert node["last_diagnostics_status"] == "valid"
    assert node["sync_status"] == "synced"
    assert node["software_version"] == "1.0.0"
    assert node["status_history"][-1]["response_time_ms"] == 42


def test_active_nodes_exclude_old_nodes_and_all_includes_inactive():
    registry = NodeRegistry()
    active = registry.register_node("https://active.example.org", "Active Node")
    old = registry.register_node("https://old.example.org", "Old Node")
    registry.registered_nodes[old["node_url"]]["last_seen"] = time.time() - registry.active_window_seconds - 10

    active_nodes = registry.get_active_nodes()
    all_nodes = registry.get_all_nodes()

    assert [node["node_url"] for node in active_nodes] == [active["node_url"]]
    assert {node["node_url"] for node in all_nodes} == {active["node_url"], old["node_url"]}
    assert registry.get_all_nodes(status="inactive")[0]["node_url"] == old["node_url"]


def test_summary_counts_sync_states():
    registry = NodeRegistry()
    registry.heartbeat("https://synced.example.org", public_chain_height=10, chain_height=10, chain_valid=True)
    registry.heartbeat("https://behind.example.org", public_chain_height=10, chain_height=6, chain_valid=True)
    registry.heartbeat("https://invalid.example.org", public_chain_height=10, chain_height=10, chain_valid=False)
    registry.register_node("https://unknown.example.org", "Unknown Node")

    summary = registry.get_summary(public_chain_height=10)

    assert summary["total_registered_node_count"] == 4
    assert summary["active_node_count"] == 4
    assert summary["synced_node_count"] == 1
    assert summary["behind_node_count"] == 1
    assert summary["invalid_node_count"] == 1
    assert summary["unknown_node_count"] == 1
    assert summary["highest_chain_height"] == 10


def test_reliability_score_and_uptime_score_calculation():
    registry = NodeRegistry()
    registry.heartbeat("https://node.example.org", public_chain_height=5, chain_height=5, chain_valid=True)
    registry.heartbeat("https://node.example.org", public_chain_height=5, chain_height=3, chain_valid=True)
    registry.heartbeat("https://node.example.org", public_chain_height=5, chain_height=5, chain_valid=False)
    registry.mark_offline("https://node.example.org")

    node = registry.get_node("https://node.example.org")

    assert node["uptime_score"] == 50
    assert node["reliability_score"] == 25


def test_status_history_is_capped():
    registry = NodeRegistry()

    for index in range(120):
      registry.heartbeat(
          "https://node.example.org",
          public_chain_height=120,
          chain_height=index,
          chain_valid=True,
      )

    node = registry.get_node("https://node.example.org")

    assert len(node["status_history"]) == 100
