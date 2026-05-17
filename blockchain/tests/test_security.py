import unittest
import os
import tempfile

_TEST_DATA_DIR = tempfile.TemporaryDirectory()
os.environ["VORLIQ_DATA_DIR"] = _TEST_DATA_DIR.name

from app import app


class SecurityEndpointTests(unittest.TestCase):
    def setUp(self):
        app.config["TESTING"] = True
        self.client = app.test_client()

    def test_public_transaction_endpoint_rejects_fake_system_sender(self):
        response = self.client.post(
            "/transaction",
            json={
                "sender_address": "SYSTEM",
                "receiver_address": "VLQ_RECEIVER",
                "amount": 10,
                "timestamp": 1,
                "signature": "abcdef",
                "sender_public_key": "-----BEGIN PUBLIC KEY-----\nabc\n-----END PUBLIC KEY-----",
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("system-controlled", response.get_json()["error"])

    def test_lending_request_rejects_invalid_amount(self):
        response = self.client.post(
            "/lending/request",
            json={
                "requester_address": "VLQ_REQUESTER",
                "amount": 0,
                "reason": "community tools",
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("greater than zero", response.get_json()["error"])

    def test_treasury_proposal_rejects_invalid_category(self):
        response = self.client.post(
            "/treasury/propose",
            json={
                "proposer_address": "VLQ_PROPOSER",
                "recipient_address": "VLQ_RECIPIENT",
                "title": "Spend",
                "description": "Fund useful community work.",
                "category": "private",
                "requested_amount": 10,
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("category", response.get_json()["error"])


if __name__ == "__main__":
    unittest.main()
