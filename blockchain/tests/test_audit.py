import json
import os
import tempfile
import unittest

os.environ["VORLIQ_DATA_DIR"] = tempfile.mkdtemp(prefix="vorliq-audit-test-")

from app import app, node


class AuditExportTests(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def test_chain_audit_export_shape_and_no_mutation(self):
        before_height = node.blockchain.get_block_height()
        before_hash = node.blockchain.get_latest_block().hash

        response = self.client.get("/audit/chain")

        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertTrue(data["success"])
        self.assertEqual(data["audit_schema_version"], 1)
        self.assertEqual(data["export_type"], "chain")
        self.assertIsInstance(data["blocks"], list)
        self.assertEqual(data["latest_block_hash"], before_hash)
        self.assertEqual(node.blockchain.get_block_height(), before_height)
        self.assertEqual(node.blockchain.get_latest_block().hash, before_hash)

    def test_public_audit_exports_do_not_include_obvious_secrets(self):
        for path in [
            "/audit/chain",
            "/audit/treasury",
            "/audit/governance",
            "/audit/lending",
            "/audit/exchange",
            "/audit/registry",
        ]:
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200)
            body = json.dumps(response.get_json())
            self.assertNotIn("BEGIN PRIVATE KEY", body)
            self.assertNotIn("ADMIN_TOKEN", body)
            self.assertNotIn("/home/vorliq", body)


if __name__ == "__main__":
    unittest.main()
