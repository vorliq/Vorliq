"""Adversarial proof for the registry node prober.

These tests do not merely read the guard and trust it. They point the fetcher at
the exact tricks a hostile or compromised node_url would use - loopback, private
ranges, cloud metadata, IPv4-mapped IPv6, a public name that resolves to a
private address, a redirect aimed at an internal target, a hanging endpoint, and
an oversized body - and confirm each is rejected or capped for real.
"""

from __future__ import annotations

import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

import node_prober
from node_prober import (
    ProbeError,
    compare_probe_to_claim,
    fetch_diagnostics,
    probe_node,
    validate_probe_url,
)


# --------------------------------------------------------------------------- #
# SSRF guard: non-public targets must be rejected before any connection.
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize(
    "url, reason",
    [
        ("http://127.0.0.1:5001", "blocked_ip"),          # loopback
        ("http://[::1]/diagnostics", "blocked_ip"),        # IPv6 loopback
        ("http://10.0.0.4", "blocked_ip"),                 # private class A
        ("http://192.168.1.10", "blocked_ip"),             # private class C
        ("http://172.16.5.5", "blocked_ip"),               # private class B
        ("http://169.254.169.254/latest/meta-data/", "blocked_ip"),  # cloud metadata
        ("http://0.0.0.0", "blocked_ip"),                  # unspecified
        ("http://[fd00::1]", "blocked_ip"),                # IPv6 ULA (private)
        ("http://[::ffff:127.0.0.1]", "blocked_ip"),       # IPv4-mapped loopback
        ("ftp://example.com", "invalid_scheme"),
        ("file:///etc/passwd", "invalid_scheme"),
        ("http://user:pass@example.com", "credentials_forbidden"),
        ("", "invalid_url"),
    ],
)
def test_validate_rejects_unsafe_targets(url, reason):
    with pytest.raises(ProbeError) as info:
        validate_probe_url(url)
    assert info.value.reason_code == reason


def test_validate_blocks_hostname_resolving_to_private(monkeypatch):
    # A public-looking name that resolves to loopback must still be rejected
    # (DNS-based SSRF), not just IP literals.
    def fake_getaddrinfo(host, port, *args, **kwargs):
        return [(2, 1, 6, "", ("127.0.0.1", port))]

    monkeypatch.setattr(node_prober.socket, "getaddrinfo", fake_getaddrinfo)
    with pytest.raises(ProbeError) as info:
        validate_probe_url("https://rebind.evil.example")
    assert info.value.reason_code == "blocked_ip"


def test_validate_allows_public_targets(monkeypatch):
    def fake_getaddrinfo(host, port, *args, **kwargs):
        return [(2, 1, 6, "", ("8.8.8.8", port))]

    monkeypatch.setattr(node_prober.socket, "getaddrinfo", fake_getaddrinfo)
    base, resolved = validate_probe_url("https://node.example.org/")
    assert base == "https://node.example.org"
    assert resolved == ["8.8.8.8"]


def test_probe_node_blocks_private_without_connecting():
    # The full entry point must refuse a private target and never connect.
    result = probe_node("http://127.0.0.1:5001")
    assert result["reachable"] is False
    assert result["probe_status"] == "blocked"
    assert result["reason_code"] == "blocked_ip"


# --------------------------------------------------------------------------- #
# Fetch hardening: against a real local server, prove redirect / timeout /
# oversize caps actually fire. The SSRF guard is bypassed here (validate=False)
# only so we can exercise the fetch layer against a loopback test server; the
# guard itself is proven above.
# --------------------------------------------------------------------------- #

class _Handler(BaseHTTPRequestHandler):
    mode = "ok"

    def log_message(self, *args):  # silence test server noise
        pass

    def do_GET(self):
        if self.mode == "fallback":
            # Primary /api path is unavailable; only the bare /diagnostics works.
            if self.path.startswith("/api/"):
                self.send_response(404)
                self.end_headers()
                return
            body = b'{"block_height": 77, "last_block_hash": "fallbackhash", "chain_valid": true}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)
            return
        if self.mode == "redirect":
            self.send_response(302)
            self.send_header("Location", "http://169.254.169.254/latest/meta-data/")
            self.end_headers()
            return
        if self.mode == "slow":
            time.sleep(3)
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"{}")
            return
        if self.mode == "oversize":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b"x" * 50000)
            return
        body = b'{"block_height": 1234, "last_block_hash": "abc123", "chain_valid": true}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)


@pytest.fixture
def local_server():
    server = HTTPServer(("127.0.0.1", 0), _Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_address[1]}"
    try:
        yield base
    finally:
        server.shutdown()
        server.server_close()


def test_fetch_does_not_follow_redirect_to_metadata(local_server):
    _Handler.mode = "redirect"
    with pytest.raises(ProbeError) as info:
        fetch_diagnostics(local_server, validate=False)
    assert info.value.reason_code == "redirect_blocked"


def test_fetch_times_out_on_hanging_endpoint(local_server):
    _Handler.mode = "slow"
    started = time.time()
    with pytest.raises(ProbeError) as info:
        fetch_diagnostics(local_server, timeout=1, validate=False)
    elapsed = time.time() - started
    assert info.value.reason_code == "timeout"
    assert elapsed < 2.5  # capped, did not wait for the 3s server sleep


def test_fetch_caps_oversized_body(local_server):
    _Handler.mode = "oversize"
    with pytest.raises(ProbeError) as info:
        fetch_diagnostics(local_server, max_bytes=1024, validate=False)
    assert info.value.reason_code == "oversize"


def test_fetch_parses_valid_diagnostics(local_server):
    _Handler.mode = "ok"
    served = fetch_diagnostics(local_server, validate=False)
    assert served["block_height"] == 1234
    assert served["last_block_hash"] == "abc123"
    assert served["chain_valid"] is True


def test_fetch_falls_back_to_bare_diagnostics(local_server):
    # A node that exposes Flask directly (no /api prefix) must still be probed.
    _Handler.mode = "fallback"
    served = fetch_diagnostics(local_server, validate=False)
    assert served["block_height"] == 77
    assert served["last_block_hash"] == "fallbackhash"


# --------------------------------------------------------------------------- #
# Comparison: an independent probe must catch a node that lies in its heartbeat.
# --------------------------------------------------------------------------- #

def test_compare_flags_height_lie():
    probe = {"reachable": True, "served_height": 10, "served_hash": "h", "probe_status": "reachable"}
    status, _ = compare_probe_to_claim(probe, claimed_height=999, claimed_hash="h")
    assert status == "claim_mismatch"


def test_compare_flags_hash_lie():
    probe = {"reachable": True, "served_height": 10, "served_hash": "real", "probe_status": "reachable"}
    status, _ = compare_probe_to_claim(probe, claimed_height=10, claimed_hash="fake")
    assert status == "claim_mismatch"


def test_compare_verifies_matching_node():
    probe = {"reachable": True, "served_height": 10, "served_hash": "h", "probe_status": "reachable"}
    status, _ = compare_probe_to_claim(probe, claimed_height=10, claimed_hash="h")
    assert status == "verified"


def test_compare_reports_unreachable():
    probe = {"reachable": False, "probe_status": "unreachable", "message": "node diagnostics request failed."}
    status, _ = compare_probe_to_claim(probe, claimed_height=10, claimed_hash="h")
    assert status == "unreachable"


# --------------------------------------------------------------------------- #
# Registry integration: a mismatching/unreachable probe is recorded against the
# node and lowers its reliability, so a lying node cannot keep a clean record.
# --------------------------------------------------------------------------- #

def test_apply_probe_result_flags_mismatch_and_lowers_reliability():
    from registry import NodeRegistry

    reg = NodeRegistry()
    url = "https://node.example.org"
    reg.register_node(url, "Example")
    for _ in range(3):
        reg.heartbeat(url, public_chain_height=10, chain_height=10, last_block_hash="h", chain_valid=True)
    before = reg.get_node(url)["reliability_score"]

    probe = {"reachable": True, "served_height": 5, "served_hash": "other", "response_time_ms": 12}
    node = reg.apply_probe_result(url, probe, "claim_mismatch", "endpoint served 5, not the claimed 10")

    assert node["last_probe_status"] == "claim_mismatch"
    assert node["reachable"] is True
    assert node["probe_served_height"] == 5
    assert reg.get_node(url)["reliability_score"] < before


def test_apply_probe_result_marks_unreachable():
    from registry import NodeRegistry

    reg = NodeRegistry()
    url = "https://node.example.org"
    reg.register_node(url, "Example")
    probe = {"reachable": False, "served_height": None, "served_hash": None, "response_time_ms": None}
    node = reg.apply_probe_result(url, probe, "unreachable", "no response")
    assert node["reachable"] is False
    assert node["last_probe_status"] == "unreachable"
