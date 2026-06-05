import unittest
import os
import tempfile
import hashlib

_TEST_DATA_DIR = tempfile.TemporaryDirectory()
os.environ["VORLIQ_DATA_DIR"] = _TEST_DATA_DIR.name

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec, utils

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

    def test_profile_verification_challenge_and_submit(self):
        wallet = Wallet()
        challenge_response = self.client.post("/profiles/verify/challenge", json={"address": wallet.address})
        self.assertEqual(challenge_response.status_code, 200)
        message = challenge_response.get_json()["message"]
        digest = hashlib.sha256(message.encode("utf-8")).digest()
        signature = wallet.private_key.sign(digest, ec.ECDSA(utils.Prehashed(hashes.SHA256()))).hex()

        submit_response = self.client.post(
            "/profiles/verify/submit",
            json={
                "address": wallet.address,
                "public_key": wallet.public_key_pem(),
                "signature": signature,
                "message": message,
            },
        )

        self.assertEqual(submit_response.status_code, 200)
        self.assertTrue(submit_response.get_json()["verified_wallet"])

    def test_profile_verification_rejects_invalid_signature(self):
        wallet = Wallet()
        challenge_response = self.client.post("/profiles/verify/challenge", json={"address": wallet.address})
        message = challenge_response.get_json()["message"]

        submit_response = self.client.post(
            "/profiles/verify/submit",
            json={
                "address": wallet.address,
                "public_key": wallet.public_key_pem(),
                "signature": "abcdef",
                "message": message,
            },
        )

        self.assertEqual(submit_response.status_code, 400)
        self.assertIn("signature", submit_response.get_json()["message"])

    def test_direct_forum_tip_post_endpoint_is_retired(self):
        marker = "dummy-private-key-marker-never-reflect"

        response = self.client.post(
            "/forum/tip/post",
            json={
                "post_id": "post_1",
                "sender_address": "VLQ_SENDER",
                "receiver_address": "VLQ_RECEIVER",
                "amount": 1,
                "sender_private_key": marker,
            },
        )

        body = response.get_json()
        serialized = response.get_data(as_text=True)

        self.assertEqual(response.status_code, 410)
        self.assertFalse(body["success"])
        self.assertEqual(body["error"]["code"], "FORUM_TIPPING_RETIRED")
        self.assertIn("saved-wallet local signing flows", body["message"])
        self.assertNotIn(marker, serialized)

    def test_direct_forum_tip_reply_endpoint_is_retired(self):
        marker = "dummy-private-key-marker-never-reflect"

        response = self.client.post(
            "/forum/tip/reply",
            json={
                "post_id": "post_1",
                "reply_id": "reply_1",
                "sender_address": "VLQ_SENDER",
                "receiver_address": "VLQ_RECEIVER",
                "amount": 1,
                "senderPrivateKey": marker,
            },
        )

        body = response.get_json()
        serialized = response.get_data(as_text=True)

        self.assertEqual(response.status_code, 410)
        self.assertFalse(body["success"])
        self.assertEqual(body["error"]["code"], "FORUM_TIPPING_RETIRED")
        self.assertIn("saved-wallet local signing flows", body["message"])
        self.assertNotIn(marker, serialized)

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
