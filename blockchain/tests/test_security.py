import unittest
import os
import tempfile

_TEST_DATA_DIR = tempfile.TemporaryDirectory()
os.environ["VORLIQ_DATA_DIR"] = _TEST_DATA_DIR.name

from app import app
from blockchain import Blockchain
from transaction import LENDING_POOL_ADDRESS, SYSTEM_ADDRESS, TREASURY_ADDRESS, Transaction
from wallet import Wallet, validate_address


class SecurityEndpointTests(unittest.TestCase):
    def setUp(self):
        app.config["TESTING"] = True
        self.client = app.test_client()

    def test_public_transaction_endpoint_rejects_fake_system_sender(self):
        response = self.client.post(
            "/transaction",
            json={
                "sender_address": "SYSTEM",
                "receiver_address": Wallet().address,
                "amount": 10,
                "timestamp": 1,
                "signature": "abcdef",
                "sender_public_key": "-----BEGIN PUBLIC KEY-----\nabc\n-----END PUBLIC KEY-----",
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("system-controlled", response.get_json()["error"])

    def test_public_transaction_endpoint_rejects_invalid_amount(self):
        wallet = Wallet()
        receiver = Wallet()
        response = self.client.post(
            "/transaction",
            json={
                "sender_address": wallet.address,
                "receiver_address": receiver.address,
                "amount": 0,
                "timestamp": 1,
                "signature": "abcdef",
                "sender_public_key": wallet.public_key_pem(),
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("amount", response.get_json()["error"])

    def test_public_transaction_endpoint_rejects_same_sender_receiver(self):
        wallet = Wallet()
        response = self.client.post(
            "/transaction",
            json={
                "sender_address": wallet.address,
                "receiver_address": wallet.address,
                "amount": 1,
                "timestamp": 1,
                "signature": "abcdef",
                "sender_public_key": wallet.public_key_pem(),
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("same address", response.get_json()["error"])

    def test_public_transaction_endpoint_rejects_reserved_receiver(self):
        wallet = Wallet()
        response = self.client.post(
            "/transaction",
            json={
                "sender_address": wallet.address,
                "receiver_address": TREASURY_ADDRESS,
                "amount": 1,
                "timestamp": 1,
                "signature": "abcdef",
                "sender_public_key": wallet.public_key_pem(),
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("reserved system", response.get_json()["error"])

    def test_public_transaction_endpoint_rejects_obviously_invalid_receiver(self):
        wallet = Wallet()
        response = self.client.post(
            "/transaction",
            json={
                "sender_address": wallet.address,
                "receiver_address": "bad_receiver!",
                "amount": 1,
                "timestamp": 1,
                "signature": "abcdef",
                "sender_public_key": wallet.public_key_pem(),
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("base58", response.get_json()["error"])

    def test_internal_system_transactions_still_allowed(self):
        blockchain = Blockchain()

        self.assertTrue(blockchain.add_pending_transaction(Transaction(SYSTEM_ADDRESS, Wallet().address, 10)))
        self.assertTrue(blockchain.add_pending_transaction(Transaction(SYSTEM_ADDRESS, TREASURY_ADDRESS, 5)))
        self.assertTrue(blockchain.add_pending_transaction(Transaction(LENDING_POOL_ADDRESS, Wallet().address, 3)))

    def test_address_validation_accepts_generated_wallet_address(self):
        wallet = Wallet()
        valid, errors, warnings = validate_address(wallet.address)

        self.assertTrue(valid)
        self.assertEqual(errors, [])
        self.assertEqual(warnings, [])

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
