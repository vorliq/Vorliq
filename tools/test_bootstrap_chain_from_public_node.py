import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from bootstrap_chain_from_public_node import (
    BootstrapError,
    BootstrapOptions,
    block_hash,
    run_bootstrap,
    sha256_hex,
)


def make_block(index, previous_hash, transactions=None):
    block = {
        "index": index,
        "timestamp": 1700000000 + index,
        "transactions": transactions or [],
        "previous_hash": previous_hash,
        "nonce": index + 100,
    }
    block["hash"] = block_hash(block)
    return block


def fixture_payloads():
    genesis = make_block(0, "0", [{"tx_id": "genesis", "amount": 0.0}])
    second = make_block(1, genesis["hash"], [{"tx_id": "tx-1", "amount": 3.0}, {"tx_id": "tx-2", "amount": 4.0}])
    chain_export = {
        "success": True,
        "audit_schema_version": 1,
        "export_type": "chain",
        "export_timestamp": "2026-05-26T00:00:00Z",
        "block_count": 2,
        "latest_block_hash": second["hash"],
        "blocks": [genesis, second],
    }
    chain_hash = sha256_hex(chain_export)
    manifest = {
        "success": True,
        "export_type": "manifest",
        "export_timestamp": "2026-05-26T00:00:00Z",
        "chain_height": 1,
        "latest_block_hash": second["hash"],
        "exports": [{"name": "chain", "endpoint": "/api/audit/chain?export_timestamp=fixture", "sha256": chain_hash}],
    }
    manifest_hash = sha256_hex(manifest)
    snapshot = {
        "success": True,
        "chain_height": 1,
        "latest_block_hash": second["hash"],
        "signature": {
            "enabled": True,
            "snapshot_hash": "snapshot-hash",
            "signature": "signature",
            "public_key": "public-key",
            "public_key_id": "fixture-key",
        },
    }
    package = {
        "success": True,
        "package_version": 1,
        "snapshot_hash": "snapshot-hash",
        "snapshot_signature_verified": True,
        "chain_height": 1,
        "latest_block_hash": second["hash"],
        "audit_manifest_hash": manifest_hash,
        "audit_chain_hash": chain_hash,
        "audit_manifest_url": "https://trusted.example/api/audit/manifest?export_timestamp=fixture",
        "chain_export_url": "https://trusted.example/api/audit/chain?export_timestamp=fixture",
    }
    responses = {
        "https://trusted.example/api/bootstrap/package": package,
        "https://trusted.example/api/snapshot/latest": {"success": True, "snapshot": snapshot},
        "https://trusted.example/api/snapshot/verify": {"success": True, "verified": True, "signature_verified": True},
        "https://trusted.example/api/audit/manifest?export_timestamp=fixture": manifest,
        "https://trusted.example/api/audit/chain?export_timestamp=fixture": chain_export,
    }
    return responses


def fake_fetcher(responses):
    def fetch(url):
        try:
            return json.loads(json.dumps(responses[url]))
        except KeyError as error:
            raise AssertionError(f"unexpected URL {url}") from error

    return fetch


class BootstrapChainFromPublicNodeTests(unittest.TestCase):
    def test_dry_run_writes_nothing(self):
        responses = fixture_payloads()
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = Path(tmp)
            report = run_bootstrap(
                BootstrapOptions(trusted_node="https://trusted.example", data_dir=data_dir),
                fetcher=fake_fetcher(responses),
                signature_verifier=lambda snapshot: True,
            )
            self.assertEqual(report["mode"], "dry_run")
            self.assertFalse((data_dir / "chain.json").exists())

    def test_invalid_signature_fails_when_required(self):
        responses = fixture_payloads()
        with self.assertRaisesRegex(BootstrapError, "signature"):
            run_bootstrap(
                BootstrapOptions(trusted_node="https://trusted.example"),
                fetcher=fake_fetcher(responses),
                signature_verifier=lambda snapshot: False,
            )

    def test_invalid_chain_link_fails(self):
        responses = fixture_payloads()
        chain_export = responses["https://trusted.example/api/audit/chain?export_timestamp=fixture"]
        chain_export["blocks"][1]["previous_hash"] = "bad"
        chain_export["blocks"][1]["hash"] = block_hash(chain_export["blocks"][1])
        chain_export["latest_block_hash"] = chain_export["blocks"][1]["hash"]
        chain_hash = sha256_hex(chain_export)
        manifest = responses["https://trusted.example/api/audit/manifest?export_timestamp=fixture"]
        manifest["latest_block_hash"] = chain_export["latest_block_hash"]
        manifest["exports"][0]["sha256"] = chain_hash
        responses["https://trusted.example/api/bootstrap/package"]["audit_manifest_hash"] = sha256_hex(manifest)
        responses["https://trusted.example/api/bootstrap/package"]["audit_chain_hash"] = chain_hash
        responses["https://trusted.example/api/bootstrap/package"]["latest_block_hash"] = chain_export["latest_block_hash"]
        responses["https://trusted.example/api/snapshot/latest"]["snapshot"]["latest_block_hash"] = chain_export["latest_block_hash"]
        with self.assertRaisesRegex(BootstrapError, "previous_hash"):
            run_bootstrap(
                BootstrapOptions(trusted_node="https://trusted.example", require_signature=False),
                fetcher=fake_fetcher(responses),
                signature_verifier=lambda snapshot: True,
            )

    def test_matching_latest_hash_passes(self):
        responses = fixture_payloads()
        chain_export = responses["https://trusted.example/api/audit/chain?export_timestamp=fixture"]
        chain_export["blocks"][1]["transactions"][0]["amount"] = 3
        chain_hash = sha256_hex(chain_export)
        manifest = responses["https://trusted.example/api/audit/manifest?export_timestamp=fixture"]
        manifest["exports"][0]["sha256"] = chain_hash
        responses["https://trusted.example/api/bootstrap/package"]["audit_manifest_hash"] = sha256_hex(manifest)
        responses["https://trusted.example/api/bootstrap/package"]["audit_chain_hash"] = chain_hash
        report = run_bootstrap(
            BootstrapOptions(trusted_node="https://trusted.example", require_signature=False),
            fetcher=fake_fetcher(responses),
            signature_verifier=lambda snapshot: True,
        )
        self.assertEqual(report["chain_height"], 1)
        self.assertEqual(report["latest_block_hash"], responses["https://trusted.example/api/bootstrap/package"]["latest_block_hash"])

    def test_write_refuses_existing_chain_without_force(self):
        responses = fixture_payloads()
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = Path(tmp)
            (data_dir / "chain.json").write_text('{"chain":[{"index":0}]}', encoding="utf-8")
            with self.assertRaisesRegex(BootstrapError, "Existing non-empty chain"):
                run_bootstrap(
                    BootstrapOptions(trusted_node="https://trusted.example", data_dir=data_dir, write=True),
                    fetcher=fake_fetcher(responses),
                    signature_verifier=lambda snapshot: True,
                )

    def test_forbidden_marker_scan_catches_dangerous_strings(self):
        responses = fixture_payloads()
        responses["https://trusted.example/api/bootstrap/package"]["note"] = "ADMIN_TOKEN should never appear"
        with self.assertRaisesRegex(BootstrapError, "forbidden marker"):
            run_bootstrap(
                BootstrapOptions(trusted_node="https://trusted.example", require_signature=False),
                fetcher=fake_fetcher(responses),
                signature_verifier=lambda snapshot: True,
            )


if __name__ == "__main__":
    unittest.main()
