#!/usr/bin/env python3
"""Verify and optionally bootstrap a Vorliq chain from a trusted public node."""

from __future__ import annotations

import argparse
import copy
import dataclasses
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Callable


DEFAULT_TRUSTED_NODE = "https://vorliq.org"
FORBIDDEN_PATTERNS = (
    "PRIVATE KEY",
    "BEGIN OPENSSH",
    "ADMIN_TOKEN",
    "VORLIQ_SNAPSHOT_PRIVATE_KEY",
    "SERVER_SSH_KEY",
    "password",
    "admin_token",
    "private_key",
    "raw_ip",
    "ip_address",
    "server_path",
    "user_agent",
    "ssh-ed25519",
    "Bearer ",
)


class BootstrapError(Exception):
    """Raised when verified bootstrap cannot continue safely."""


@dataclasses.dataclass
class BootstrapOptions:
    trusted_node: str = DEFAULT_TRUSTED_NODE
    data_dir: Path = Path("./blockchain/data")
    write: bool = False
    force: bool = False
    require_signature: bool = True
    max_blocks: int | None = None


def trim_url(url: str) -> str:
    return str(url or DEFAULT_TRUSTED_NODE).rstrip("/")


def canonicalize(value: Any) -> Any:
    if isinstance(value, list):
        return [canonicalize(item) for item in value]
    if isinstance(value, dict):
        return {key: canonicalize(value[key]) for key in sorted(value)}
    return value


def canonical_json(value: Any) -> str:
    return json.dumps(canonicalize(value), separators=(",", ":"), ensure_ascii=False)


def sha256_hex(value: Any) -> str:
    if isinstance(value, str):
        data = value.encode("utf-8")
    else:
        data = canonical_json(value).encode("utf-8")
    return hashlib.sha256(data).hexdigest()


def fetch_json(url: str, timeout: int = 30) -> Any:
    request = urllib.request.Request(url, headers={"User-Agent": "vorliq-bootstrap-verifier"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8")
    except urllib.error.URLError as error:
        raise BootstrapError(f"Could not fetch {safe_url_label(url)}: {error}") from error
    try:
        return json.loads(body)
    except json.JSONDecodeError as error:
        raise BootstrapError(f"Response from {safe_url_label(url)} was not valid JSON.") from error


def safe_url_label(url: str) -> str:
    if not url:
        return "requested endpoint"
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme and parsed.netloc:
        return f"{parsed.scheme}://{parsed.netloc}{parsed.path}"
    return url


def full_url(base: str, path_or_url: str) -> str:
    if str(path_or_url).startswith(("http://", "https://")):
        return str(path_or_url)
    return f"{trim_url(base)}/{str(path_or_url).lstrip('/')}"


def scan_forbidden_public_data(*payloads: Any) -> None:
    text = json.dumps(payloads, sort_keys=True, ensure_ascii=False)
    lowered = text.lower()
    for marker in FORBIDDEN_PATTERNS:
        if marker.lower() in lowered:
            raise BootstrapError(f"Downloaded public data contained a forbidden marker: {marker}")


def snapshot_payload(snapshot: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in snapshot.items() if key != "signature"}


def verify_snapshot_signature_with_node(snapshot: dict[str, Any], repo_root: Path | None = None) -> bool:
    root = repo_root or Path(__file__).resolve().parents[1]
    script = """
const fs = require("fs");
const { verifySnapshotSignature } = require("./backend/snapshotSigner");
const snapshot = JSON.parse(fs.readFileSync(0, "utf8"));
const result = verifySnapshotSignature(snapshot, { publicKey: snapshot.signature && snapshot.signature.public_key });
process.stdout.write(JSON.stringify(result));
process.exit(result.verified ? 0 : 1);
"""
    try:
        result = subprocess.run(
            ["node", "-e", script],
            cwd=str(root),
            input=json.dumps(snapshot),
            text=True,
            capture_output=True,
            timeout=20,
            check=False,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise BootstrapError(f"Local snapshot signature verifier could not run: {error}") from error
    if result.returncode != 0:
        return False
    try:
        verification = json.loads(result.stdout or "{}")
    except json.JSONDecodeError:
        return False
    return bool(verification.get("verified") and verification.get("signature_verified"))


def block_hash(block: dict[str, Any]) -> str:
    payload = {
        "index": block.get("index"),
        "timestamp": block.get("timestamp"),
        "transactions": block.get("transactions", []),
        "previous_hash": block.get("previous_hash"),
        "nonce": block.get("nonce"),
    }
    if block.get("miner_address") is not None:
        payload["miner_address"] = block.get("miner_address")
    return sha256_hex(payload)


def normalize_blocks_for_hashing(blocks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Restore JSON-loaded numeric transaction amounts to the float form used by block hashing."""
    normalized = copy.deepcopy(blocks)
    for block in normalized:
        for transaction in block.get("transactions", []) or []:
            if isinstance(transaction, dict) and isinstance(transaction.get("amount"), (int, float)):
                transaction["amount"] = float(transaction["amount"])
            metadata = transaction.get("metadata") if isinstance(transaction, dict) else None
            if isinstance(metadata, dict):
                for key, value in list(metadata.items()):
                    if "amount" in str(key).lower() and isinstance(value, (int, float)) and not isinstance(value, bool):
                        metadata[key] = float(value)
    return normalized


def verify_chain(blocks: list[dict[str, Any]], expected_latest_hash: str | None = None) -> dict[str, Any]:
    if not blocks:
        raise BootstrapError("Chain export did not include any blocks.")
    previous_hash = None
    for position, block in enumerate(blocks):
        if not isinstance(block, dict):
            raise BootstrapError(f"Block at position {position} is not an object.")
        if not isinstance(block.get("transactions", []), list):
            raise BootstrapError(f"Block {position} transactions are not ordered as a list.")
        calculated = block_hash(block)
        if block.get("hash") != calculated:
            raise BootstrapError(f"Block {block.get('index', position)} hash does not match its contents.")
        if position == 0:
            if block.get("previous_hash") not in (None, "0"):
                raise BootstrapError("Genesis block previous_hash is not a genesis value.")
        elif block.get("previous_hash") != previous_hash:
            raise BootstrapError(f"Block {block.get('index', position)} previous_hash link is invalid.")
        previous_hash = block.get("hash")
    latest_hash = blocks[-1].get("hash")
    if expected_latest_hash and latest_hash != expected_latest_hash:
        raise BootstrapError("Latest block hash does not match the verified bootstrap package.")
    return {"chain_height": max(len(blocks) - 1, 0), "latest_block_hash": latest_hash}


def transaction_order_digest(blocks: list[dict[str, Any]]) -> str:
    ordered = []
    for block in blocks:
        ordered.append(
            {
                "index": block.get("index"),
                "transactions": [
                    {
                        "position": position,
                        "tx_id": tx.get("tx_id") or tx.get("id") or tx.get("transaction_id"),
                        "hash": sha256_hex(tx),
                    }
                    for position, tx in enumerate(block.get("transactions", []))
                    if isinstance(tx, dict)
                ],
            }
        )
    return sha256_hex(ordered)


def existing_chain_non_empty(chain_file: Path) -> bool:
    if not chain_file.exists() or chain_file.stat().st_size == 0:
        return False
    try:
        payload = json.loads(chain_file.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return True
    chain = payload.get("chain") if isinstance(payload, dict) else None
    return bool(chain)


def atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, path)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)


def backup_data_dir(data_dir: Path) -> str | None:
    if not data_dir.exists():
        return None
    timestamp = time.strftime("%Y%m%d-%H%M%S")
    backup_dir = data_dir.parent / f"{data_dir.name}.bootstrap-backup-{timestamp}"
    shutil.copytree(data_dir, backup_dir)
    return backup_dir.name


def chain_storage_payload(chain_export: dict[str, Any], blocks: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "coin": chain_export.get("coin") or "VLQ",
        "difficulty": chain_export.get("difficulty", 4),
        "mining_reward": chain_export.get("current_reward") or chain_export.get("mining_reward", 50),
        "initial_mining_reward": chain_export.get("initial_mining_reward", 50),
        "maximum_supply": chain_export.get("maximum_supply", 21000000),
        "halving_interval": chain_export.get("halving_interval", 210000),
        "chain": blocks,
    }


def rebuild_indexes_if_available(data_dir: Path, blocks: list[dict[str, Any]]) -> bool:
    repo_root = Path(__file__).resolve().parents[1]
    blockchain_dir = repo_root / "blockchain"
    if not (blockchain_dir / "indexes.py").exists():
        return False
    script = f"""
import json, sys
from pathlib import Path
sys.path.insert(0, {str(blockchain_dir)!r})
from block import Block
from blockchain import Blockchain
from indexes import BlockchainIndexes
data_dir = Path({str(data_dir)!r})
blocks = json.loads({json.dumps(json.dumps(blocks))!r})
chain = Blockchain()
chain.chain = [Block.from_dict(block) for block in blocks]
chain.pending_transactions = []
indexes = BlockchainIndexes.build(chain)
index_file = data_dir / "indexes.json"
with open(index_file, "w", encoding="utf-8") as handle:
    json.dump(indexes.to_payload(), handle, indent=2, sort_keys=True)
    handle.write("\\n")
"""
    result = subprocess.run([sys.executable, "-c", script], capture_output=True, text=True, timeout=30, check=False)
    return result.returncode == 0


def validate_bootstrap_artifacts(
    options: BootstrapOptions,
    fetcher: Callable[[str], Any] = fetch_json,
    signature_verifier: Callable[[dict[str, Any]], bool] = verify_snapshot_signature_with_node,
) -> dict[str, Any]:
    trusted_node = trim_url(options.trusted_node)
    package = fetcher(full_url(trusted_node, "/api/bootstrap/package"))
    if not package.get("success"):
        raise BootstrapError("Trusted node did not return a successful bootstrap package.")

    snapshot_response = fetcher(full_url(trusted_node, "/api/snapshot/latest"))
    snapshot = snapshot_response.get("snapshot") or snapshot_response
    snapshot_verify = fetcher(full_url(trusted_node, "/api/snapshot/verify"))
    manifest_url = package.get("audit_manifest_url") or full_url(trusted_node, "/api/audit/manifest")
    manifest = fetcher(manifest_url)
    chain_export_url = package.get("chain_export_url")
    if not chain_export_url:
      chain_endpoint = next((item.get("endpoint") for item in manifest.get("exports", []) if item.get("name") == "chain"), None)
      chain_export_url = full_url(trusted_node, chain_endpoint or "/api/audit/chain")
    chain_export = fetcher(chain_export_url)

    scan_forbidden_public_data(package, snapshot, snapshot_verify, manifest, chain_export)

    if options.require_signature:
        if not snapshot_verify.get("signature_verified") or not snapshot_verify.get("verified"):
            raise BootstrapError("Trusted node snapshot verification did not report a valid signature.")
        if not signature_verifier(snapshot):
            raise BootstrapError("Local snapshot signature verification failed.")

    manifest_hash = sha256_hex(manifest)
    if package.get("audit_manifest_hash") and package.get("audit_manifest_hash") != manifest_hash:
        raise BootstrapError("Audit manifest hash does not match the bootstrap package.")

    chain_entry = next((item for item in manifest.get("exports", []) if item.get("name") == "chain"), None)
    if not chain_entry:
        raise BootstrapError("Audit manifest did not include a chain export entry.")
    chain_hash = sha256_hex(chain_export)
    if chain_entry.get("sha256") != chain_hash:
        raise BootstrapError("Chain audit export hash does not match the audit manifest.")
    if package.get("audit_chain_hash") and package.get("audit_chain_hash") != chain_hash:
        raise BootstrapError("Chain audit export hash does not match the bootstrap package.")

    blocks = normalize_blocks_for_hashing(list(chain_export.get("blocks") or []))
    if options.max_blocks is not None and len(blocks) > options.max_blocks:
        raise BootstrapError(f"Chain export has {len(blocks)} blocks, above the --max-blocks limit.")

    chain_report = verify_chain(blocks, expected_latest_hash=package.get("latest_block_hash"))
    if snapshot.get("latest_block_hash") and snapshot.get("latest_block_hash") != chain_report["latest_block_hash"]:
        raise BootstrapError("Latest block hash does not match the signed snapshot metadata.")
    if number(snapshot.get("chain_height")) is not None and number(snapshot.get("chain_height")) != chain_report["chain_height"]:
        raise BootstrapError("Chain height does not match the signed snapshot metadata.")

    order_before = transaction_order_digest(blocks)
    order_after = transaction_order_digest(json.loads(json.dumps(blocks)))
    if order_before != order_after:
        raise BootstrapError("Transaction ordering changed during bootstrap preparation.")

    snapshot_hash = (snapshot.get("signature") or {}).get("snapshot_hash") or package.get("snapshot_hash")
    return {
        "trusted_node": trusted_node,
        "package": package,
        "snapshot_hash": snapshot_hash,
        "audit_manifest_hash": manifest_hash,
        "audit_chain_hash": chain_hash,
        "chain_export": chain_export,
        "blocks": blocks,
        "chain_height": chain_report["chain_height"],
        "latest_block_hash": chain_report["latest_block_hash"],
        "transaction_order_digest": order_before,
    }


def number(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def run_bootstrap(
    options: BootstrapOptions,
    fetcher: Callable[[str], Any] = fetch_json,
    signature_verifier: Callable[[dict[str, Any]], bool] = verify_snapshot_signature_with_node,
) -> dict[str, Any]:
    if options.force and not options.write:
        raise BootstrapError("--force is only allowed with --write.")
    report = validate_bootstrap_artifacts(options, fetcher=fetcher, signature_verifier=signature_verifier)
    data_dir = Path(options.data_dir)
    chain_file = data_dir / "chain.json"
    write_status = "dry_run_no_files_written"
    backup_name = None
    indexes_rebuilt = False

    if options.write:
        if existing_chain_non_empty(chain_file) and not options.force:
            raise BootstrapError("Existing non-empty chain.json found. Refusing to overwrite without --force.")
        if options.force:
            backup_name = backup_data_dir(data_dir)
        payload = chain_storage_payload(report["chain_export"], report["blocks"])
        atomic_write_json(chain_file, payload)
        marker = {
            "trusted_node": report["trusted_node"],
            "bootstrap_time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "chain_height": report["chain_height"],
            "latest_block_hash": report["latest_block_hash"],
            "snapshot_hash": report["snapshot_hash"],
            "audit_chain_hash": report["audit_chain_hash"],
            "mode": "write",
        }
        atomic_write_json(data_dir / "bootstrap.json", marker)
        indexes_rebuilt = rebuild_indexes_if_available(data_dir, report["blocks"])
        write_status = "chain_written"

    return {
        "success": True,
        "mode": "write" if options.write else "dry_run",
        "write_status": write_status,
        "backup_name": backup_name,
        "indexes_rebuilt": indexes_rebuilt,
        "trusted_node": report["trusted_node"],
        "chain_height": report["chain_height"],
        "latest_block_hash": report["latest_block_hash"],
        "snapshot_hash": report["snapshot_hash"],
        "audit_manifest_hash": report["audit_manifest_hash"],
        "audit_chain_hash": report["audit_chain_hash"],
        "transaction_order_digest": report["transaction_order_digest"],
    }


def print_report(report: dict[str, Any], trusted_node: str) -> None:
    print("\nVorliq verified chain bootstrap report")
    print("--------------------------------------")
    print(f"Trusted node: {report['trusted_node']}")
    print(f"Mode: {report['mode']}")
    print(f"Chain height: {report['chain_height']}")
    print(f"Latest block hash: {report['latest_block_hash']}")
    print(f"Snapshot hash: {report['snapshot_hash']}")
    print(f"Audit manifest hash: {report['audit_manifest_hash']}")
    print(f"Audit chain hash: {report['audit_chain_hash']}")
    print(f"Write status: {report['write_status']}")
    if report.get("backup_name"):
        print(f"Backup created beside data directory: {report['backup_name']}")
    print(f"Indexes rebuilt: {'yes' if report.get('indexes_rebuilt') else 'not needed or unavailable'}")
    print("\nNext command:")
    print(f"node tools/node_doctor.js --base-url http://127.0.0.1:5000 --trusted-node {trusted_node}")


def parse_args(argv: list[str]) -> BootstrapOptions:
    parser = argparse.ArgumentParser(description="Verify and optionally bootstrap a Vorliq chain from a trusted public node.")
    parser.add_argument("--trusted-node", default=DEFAULT_TRUSTED_NODE)
    parser.add_argument("--data-dir", default="./blockchain/data")
    parser.add_argument("--dry-run", action="store_true", help="Verify only. This is the default.")
    parser.add_argument("--write", action="store_true", help="Write verified chain data atomically.")
    parser.add_argument("--force", action="store_true", help="With --write, back up and replace an existing non-empty chain.json.")
    parser.add_argument("--require-signature", dest="require_signature", action="store_true", default=True)
    parser.add_argument("--no-require-signature", dest="require_signature", action="store_false")
    parser.add_argument("--max-blocks", type=int, default=None)
    args = parser.parse_args(argv)
    return BootstrapOptions(
        trusted_node=args.trusted_node,
        data_dir=Path(args.data_dir),
        write=bool(args.write),
        force=bool(args.force),
        require_signature=bool(args.require_signature),
        max_blocks=args.max_blocks,
    )


def main(argv: list[str]) -> int:
    options = parse_args(argv)
    try:
        report = run_bootstrap(options)
        print_report(report, trim_url(options.trusted_node))
        return 0
    except BootstrapError as error:
        print(f"\nVorliq verified chain bootstrap failed: {error}", file=sys.stderr)
        if not options.write:
            print("No files were written.", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
