"""Operator-verification proof: the registry-side conflict policy and the probe
binding that turns a signed vouch into an earned badge.

The signature itself is proven in test_signed_authorization.py (the route shares
the one verifier). Here we prove the parts that are specific to operator identity:
first-verified-locks, that an unsigned heartbeat/register cannot move a locked
operator, the release/recovery path, and that the public verified badge only
lights up when an independent probe confirms the node advertises the same wallet.
"""

from __future__ import annotations

import pytest

from registry import NodeRegistry
from node_prober import compare_operator_claim


def _register(registry, url="https://node.example.org", **kwargs):
    return registry.register_node(url, kwargs.pop("display_name", "Community Node"), **kwargs)


# --------------------------------------------------------------------------- #
# A signed claim records the operator but does NOT by itself earn the badge.
# --------------------------------------------------------------------------- #
def test_signed_claim_records_operator_but_badge_waits_for_probe():
    registry = NodeRegistry()
    _register(registry)

    node = registry.verify_operator_claim("https://node.example.org", "wallet-A")

    assert node["operator_wallet_address"] == "wallet-A"
    assert node["is_verified_operator"] is True
    # The probe has not yet confirmed the node advertises this wallet, so the
    # earned badge must stay off.
    assert node["operator_probe_match"] is None
    assert node["operator_verified"] is False


def test_claim_requires_registered_node_and_wallet():
    registry = NodeRegistry()
    with pytest.raises(ValueError):
        registry.verify_operator_claim("https://unknown.example.org", "wallet-A")
    _register(registry)
    with pytest.raises(ValueError):
        registry.verify_operator_claim("https://node.example.org", "")


# --------------------------------------------------------------------------- #
# First-verified-locks: only the holding wallet may change or release the claim.
# --------------------------------------------------------------------------- #
def test_first_verified_locks_rejects_a_second_wallet():
    registry = NodeRegistry()
    _register(registry)
    registry.verify_operator_claim("https://node.example.org", "wallet-A")

    with pytest.raises(ValueError, match="already has a verified operator"):
        registry.verify_operator_claim("https://node.example.org", "wallet-B")

    # The original claim is untouched.
    assert registry.get_node("https://node.example.org")["operator_wallet_address"] == "wallet-A"


def test_holding_wallet_may_reaffirm_its_own_claim():
    registry = NodeRegistry()
    _register(registry)
    registry.verify_operator_claim("https://node.example.org", "wallet-A")
    node = registry.verify_operator_claim("https://node.example.org", "wallet-A")
    assert node["operator_wallet_address"] == "wallet-A"
    assert node["is_verified_operator"] is True


# --------------------------------------------------------------------------- #
# Unsigned register/heartbeat cannot overwrite a locked operator.
# --------------------------------------------------------------------------- #
def test_unsigned_heartbeat_cannot_move_a_verified_operator():
    registry = NodeRegistry()
    _register(registry)
    registry.verify_operator_claim("https://node.example.org", "wallet-A")

    # A hostile (or simply misconfigured) heartbeat tries to repoint the operator.
    registry.heartbeat("https://node.example.org", public_chain_height=10, operator_wallet_address="wallet-EVIL")
    assert registry.get_node("https://node.example.org")["operator_wallet_address"] == "wallet-A"

    # Re-registration cannot move it either.
    registry.register_node("https://node.example.org", "Community Node", operator_wallet_address="wallet-EVIL")
    assert registry.get_node("https://node.example.org")["operator_wallet_address"] == "wallet-A"


def test_unverified_self_report_is_still_allowed_to_set_a_hint():
    registry = NodeRegistry()
    _register(registry, operator_wallet_address="self-claim")
    node = registry.get_node("https://node.example.org")
    assert node["operator_wallet_address"] == "self-claim"
    assert node["is_verified_operator"] is False  # honest: unproven


# --------------------------------------------------------------------------- #
# Release recovery path: the holder frees the node, a new wallet can then claim.
# --------------------------------------------------------------------------- #
def test_release_frees_the_lock_for_a_new_wallet():
    registry = NodeRegistry()
    _register(registry)
    registry.verify_operator_claim("https://node.example.org", "wallet-A")

    released = registry.verify_operator_claim("https://node.example.org", "wallet-A", release=True)
    assert released["operator_wallet_address"] == ""
    assert released["is_verified_operator"] is False

    # Now a different wallet may claim the freed node.
    node = registry.verify_operator_claim("https://node.example.org", "wallet-B")
    assert node["operator_wallet_address"] == "wallet-B"
    assert node["is_verified_operator"] is True


# --------------------------------------------------------------------------- #
# The probe binding: advertised wallet vs signed claim.
# --------------------------------------------------------------------------- #
def test_compare_operator_claim_states():
    reachable_a = {"reachable": True, "served_operator_wallet": "wallet-A"}
    reachable_b = {"reachable": True, "served_operator_wallet": "wallet-B"}
    reachable_none = {"reachable": True, "served_operator_wallet": None}
    unreachable = {"reachable": False}

    assert compare_operator_claim(reachable_a, claimed_operator="wallet-A")[0] is True
    assert compare_operator_claim(reachable_b, claimed_operator="wallet-A")[0] is False
    assert compare_operator_claim(reachable_none, claimed_operator="wallet-A")[0] is None
    assert compare_operator_claim(unreachable, claimed_operator="wallet-A")[0] is None
    # No claim to confirm -> nothing to say.
    assert compare_operator_claim(reachable_a, claimed_operator=None)[0] is None


# --------------------------------------------------------------------------- #
# apply_probe_result wires the comparison into the earned badge + mismatch.
# --------------------------------------------------------------------------- #
def test_probe_match_earns_badge():
    registry = NodeRegistry()
    _register(registry)
    registry.verify_operator_claim("https://node.example.org", "wallet-A")
    probe = {"reachable": True, "served_height": 5, "served_hash": "h", "served_operator_wallet": "wallet-A"}

    node = registry.apply_probe_result(
        "https://node.example.org", probe, "verified", "ok", operator_match=True, operator_reason="confirmed"
    )
    assert node["operator_probe_match"] is True
    assert node["operator_verified"] is True


def test_probe_mismatch_flags_and_withholds_badge():
    registry = NodeRegistry()
    _register(registry)
    registry.verify_operator_claim("https://node.example.org", "wallet-A")
    probe = {"reachable": True, "served_height": 5, "served_hash": "h", "served_operator_wallet": "wallet-B"}

    node = registry.apply_probe_result(
        "https://node.example.org", probe, "verified", "ok", operator_match=False, operator_reason="mismatch"
    )
    assert node["operator_probe_match"] is False
    assert node["operator_verified"] is False
    # Surfaced as a mismatch in status history, the same shape as a chain-state lie.
    assert node["status_history"][-1]["status"] == "mismatch"
