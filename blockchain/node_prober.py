"""Independent registry node probing.

The registry otherwise only ever knows what a node *claims* about itself through
its own unsigned heartbeat. This module lets the registry directly fetch a
registered node's real public endpoint on its own schedule and compare what it
actually serves against what the node claimed.

Because the probed URL is operator-supplied (and therefore attacker-influenced),
the fetcher is hardened against server-side request forgery and against a hostile
endpoint trying to hang or flood the prober:

  * validate_probe_url  - rejects non-public targets (loopback, private,
                          link-local incl. cloud metadata, reserved, IPv4-mapped
                          IPv6, embedded credentials, non-http(s) schemes), and
                          resolves hostnames so a public name that maps to a
                          private address is also rejected.
  * fetch_diagnostics   - never follows redirects (so a public URL cannot bounce
                          the prober into a private target), enforces a strict
                          connect+read timeout, and caps the response body size.

The three layers are deliberately separate so each can be proven adversarially in
isolation.
"""

from __future__ import annotations

import ipaddress
import json
import socket
import time
from typing import Any
from urllib.parse import urlparse

import requests

PROBE_TIMEOUT_SECONDS = 6
PROBE_MAX_BYTES = 64 * 1024
# A Vorliq node's public API is served under /api (the bare /diagnostics path on
# a deployed node returns the single-page app HTML, not chain JSON). We try the
# canonical public path first and fall back to /diagnostics for nodes that expose
# the Flask app directly.
PROBE_DIAGNOSTICS_PATHS = ("/api/diagnostics", "/diagnostics")
ALLOWED_SCHEMES = {"http", "https"}


class ProbeError(Exception):
    """A probe could not be completed safely. Carries a stable reason code."""

    def __init__(self, reason_code: str, message: str) -> None:
        super().__init__(message)
        self.reason_code = reason_code


def _is_public_ip(ip_str: str) -> bool:
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return False
    # IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1) must be unwrapped or it sails past
    # the IPv4 private/loopback checks below.
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        return _is_public_ip(str(ip.ipv4_mapped))
    return not (
        ip.is_loopback
        or ip.is_private
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    )


def validate_probe_url(url: str) -> tuple[str, list[str]]:
    """Validate that a node_url is safe to fetch server-side.

    Returns (normalized_base_url, resolved_public_ips). Raises ProbeError if the
    target is malformed or resolves to any non-public address.
    """
    if not isinstance(url, str) or not url.strip():
        raise ProbeError("invalid_url", "node_url must be a non-empty string.")
    parsed = urlparse(url.strip())
    if parsed.scheme not in ALLOWED_SCHEMES:
        raise ProbeError("invalid_scheme", "node_url must use http or https.")
    if parsed.username or parsed.password:
        raise ProbeError("credentials_forbidden", "node_url must not embed credentials.")
    host = parsed.hostname
    if not host:
        raise ProbeError("invalid_host", "node_url must include a host.")

    try:
        ipaddress.ip_address(host)
        is_ip_literal = True
    except ValueError:
        is_ip_literal = False

    if is_ip_literal:
        if not _is_public_ip(host):
            raise ProbeError("blocked_ip", f"node_url host {host} is not a public address.")
        resolved = [host]
    else:
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        try:
            infos = socket.getaddrinfo(host, port, proto=socket.IPPROTO_TCP)
        except socket.gaierror as exc:
            raise ProbeError("dns_failure", f"could not resolve node_url host {host}.") from exc
        resolved = sorted({info[4][0] for info in infos})
        if not resolved:
            raise ProbeError("dns_failure", f"node_url host {host} did not resolve.")
        # Require EVERY resolved address to be public, so a name that maps to a mix
        # of public and private addresses is still rejected.
        for ip_str in resolved:
            if not _is_public_ip(ip_str):
                raise ProbeError(
                    "blocked_ip",
                    f"node_url host {host} resolves to non-public address {ip_str}.",
                )

    netloc = host.lower()
    if parsed.port:
        netloc = f"{netloc}:{parsed.port}"
    return f"{parsed.scheme}://{netloc}", resolved


def fetch_diagnostics(
    base_url: str,
    *,
    timeout: float = PROBE_TIMEOUT_SECONDS,
    max_bytes: int = PROBE_MAX_BYTES,
    session: Any | None = None,
    validate: bool = True,
) -> dict[str, Any]:
    """Fetch a node's diagnostics with SSRF and resource-exhaustion hardening.

    Tries the canonical public path first, then a fallback. A transport-level
    failure (timeout, connection error) aborts immediately because trying another
    path on the same host will not help; a soft failure (redirect, non-200,
    non-JSON body) moves on to the next candidate path.
    """
    if validate:
        base_url, _ = validate_probe_url(base_url)
    sess = session or requests
    soft_error: ProbeError | None = None
    for path in PROBE_DIAGNOSTICS_PATHS:
        try:
            return _fetch_one(f"{base_url}{path}", sess, timeout, max_bytes)
        except ProbeError as exc:
            if exc.reason_code in {"timeout", "unreachable"}:
                raise
            soft_error = exc
    raise soft_error or ProbeError("unreachable", "node diagnostics could not be fetched.")


def _fetch_one(target: str, sess: Any, timeout: float, max_bytes: int) -> dict[str, Any]:
    started = time.time()
    try:
        response = sess.get(
            target,
            timeout=timeout,
            allow_redirects=False,
            stream=True,
            headers={"User-Agent": "vorliq-node-prober/1", "Accept": "application/json"},
        )
    except requests.Timeout as exc:
        raise ProbeError("timeout", "node diagnostics request timed out.") from exc
    except requests.RequestException as exc:
        raise ProbeError("unreachable", "node diagnostics request failed.") from exc

    try:
        if response.is_redirect or 300 <= response.status_code < 400:
            raise ProbeError(
                "redirect_blocked",
                f"node returned redirect status {response.status_code}; redirects are not followed.",
            )
        if response.status_code != 200:
            raise ProbeError("http_error", f"node diagnostics returned status {response.status_code}.")
        chunks: list[bytes] = []
        total = 0
        for chunk in response.iter_content(chunk_size=4096):
            if not chunk:
                continue
            total += len(chunk)
            if total > max_bytes:
                raise ProbeError("oversize", "node diagnostics response exceeded the size cap.")
            chunks.append(chunk)
        body = b"".join(chunks)
    finally:
        response.close()

    elapsed_ms = int((time.time() - started) * 1000)
    try:
        data = json.loads(body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as exc:
        raise ProbeError("invalid_body", "node diagnostics response was not valid JSON.") from exc
    if not isinstance(data, dict):
        raise ProbeError("invalid_body", "node diagnostics response was not a JSON object.")

    return {
        "block_height": data.get("block_height"),
        "last_block_hash": data.get("last_block_hash"),
        "chain_valid": data.get("chain_valid"),
        "response_time_ms": elapsed_ms,
    }


def _unreachable_result(status: str, exc: ProbeError) -> dict[str, Any]:
    return {
        "reachable": False,
        "probe_status": status,
        "reason_code": exc.reason_code,
        "message": str(exc),
        "served_height": None,
        "served_hash": None,
        "served_valid": None,
        "response_time_ms": None,
    }


def probe_node(
    node_url: str,
    *,
    timeout: float = PROBE_TIMEOUT_SECONDS,
    max_bytes: int = PROBE_MAX_BYTES,
    session: Any | None = None,
) -> dict[str, Any]:
    """Independently probe a node's public /diagnostics.

    Always returns a storable result dict; ordinary network failures and blocked
    targets are reported, not raised.
    """
    try:
        base, _ = validate_probe_url(node_url)
    except ProbeError as exc:
        return _unreachable_result("blocked", exc)
    try:
        served = fetch_diagnostics(base, timeout=timeout, max_bytes=max_bytes, session=session, validate=False)
    except ProbeError as exc:
        return _unreachable_result("unreachable", exc)
    return {
        "reachable": True,
        "probe_status": "reachable",
        "reason_code": "ok",
        "message": "",
        "served_height": served["block_height"],
        "served_hash": served["last_block_hash"],
        "served_valid": served["chain_valid"],
        "response_time_ms": served["response_time_ms"],
    }


def compare_probe_to_claim(
    probe: dict[str, Any],
    *,
    claimed_height: int | None = None,
    claimed_hash: str | None = None,
    reference_height: int | None = None,
) -> tuple[str, str]:
    """Classify an independent probe against the node's self-reported heartbeat.

    Returns (status, reason). status is one of:
      blocked / unreachable - probe could not safely reach the node
      claim_mismatch        - endpoint serves something other than what was claimed
      inconclusive          - reachable but no comparable diagnostics
      verified              - endpoint corroborates the node's reported state
    """
    if not probe.get("reachable"):
        return probe.get("probe_status", "unreachable"), (
            probe.get("message") or "Node did not respond to an independent probe."
        )

    served_height = probe.get("served_height")
    served_hash = probe.get("served_hash")

    if claimed_height is not None and served_height is not None and int(served_height) != int(claimed_height):
        return (
            "claim_mismatch",
            f"Node heartbeat claimed height {claimed_height} but its endpoint served {served_height}.",
        )
    if claimed_hash and served_hash and str(claimed_hash) != str(served_hash):
        return (
            "claim_mismatch",
            "Node heartbeat block hash does not match what its endpoint actually serves.",
        )
    if served_height is None or not served_hash:
        return "inconclusive", "Node responded but did not expose comparable diagnostics."
    return "verified", "Independent probe matches the node's reported chain state."
