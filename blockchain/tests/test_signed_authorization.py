import os
import tempfile
import time
import unittest

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

_TEST_DATA_DIR = tempfile.TemporaryDirectory()
os.environ["VORLIQ_DATA_DIR"] = _TEST_DATA_DIR.name

from app import app
from signed_authorization import AUTHORIZATION_DOMAIN, AUTHORITY_ROUTES, authorization_message, body_hash, verify_signed_authorization
from storage import Storage
from wallet import Wallet


def signed_body(action, actor_field, payload=None, *, wallet=None, nonce=None, timestamp=None):
    signer = wallet or Wallet()
    body = dict(payload or {})
    body[actor_field] = signer.address
    digest = body_hash(body)
    created_at = int(time.time()) if timestamp is None else timestamp
    nonce_value = nonce or f"nonce-{time.time_ns()}"
    message = authorization_message(
        action=action,
        body_hash_value=digest,
        nonce=nonce_value,
        timestamp=created_at,
        wallet=signer.address,
    )
    body["authorization"] = {
        "wallet": signer.address,
        "public_key": signer.public_key_pem(),
        "signature": signer.sign(message),
        "message": message,
        "timestamp": created_at,
        "nonce": nonce_value,
        "action": action,
        "body_hash": digest,
        "domain": AUTHORIZATION_DOMAIN,
    }
    return signer, body


class SignedAuthorizationTests(unittest.TestCase):
    def setUp(self):
        app.config["TESTING"] = True
        app.config["ALLOW_UNSIGNED_AUTHORITY_WRITES_FOR_VALIDATION_TESTS"] = False
        self.client = app.test_client()

    def test_missing_authorization_rejected(self):
        response = self.client.post("/governance/vote", json={"proposal_id": "proposal-1", "voter_address": Wallet().address, "vote": "yes"})
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.get_json()["error"]["code"], "SIGNED_AUTHORIZATION_REQUIRED")

    def test_canonical_cross_runtime_signing_vector(self):
        payload = {"amount": 10, "reason": "Community work", "requester_address": "3MNQE1X7T4Bz9kLmNpQrStUvWx"}
        digest = body_hash(payload)
        self.assertEqual(digest, "306a764ac47e83ec1a6366464338434e9d8f91b172a872f418ce37e17aace7bc")
        self.assertEqual(
            authorization_message(
                action="lending.request",
                body_hash_value=digest,
                nonce="nonce-example-1234",
                timestamp=1700000000,
                wallet=payload["requester_address"],
            ),
            '{"action":"lending.request","body_hash":"306a764ac47e83ec1a6366464338434e9d8f91b172a872f418ce37e17aace7bc","domain":"vorliq.authority.v1","nonce":"nonce-example-1234","timestamp":1700000000,"wallet":"3MNQE1X7T4Bz9kLmNpQrStUvWx"}',
        )

    def test_valid_signed_request_reaches_domain_validation(self):
        _, body = signed_body("governance.vote", "voter_address", {"proposal_id": "missing-proposal", "vote": "yes"})
        response = self.client.post("/governance/vote", json=body)
        self.assertEqual(response.status_code, 400)
        self.assertNotIn("AUTHORIZATION_", response.get_data(as_text=True))

    def test_replay_rejected_durably(self):
        _, body = signed_body("governance.vote", "voter_address", {"proposal_id": "missing-proposal", "vote": "yes"})
        self.client.post("/governance/vote", json=body)
        replay = self.client.post("/governance/vote", json=body)
        self.assertEqual(replay.status_code, 401)
        self.assertEqual(replay.get_json()["error"]["code"], "AUTHORIZATION_REPLAYED")

    def test_nonce_registry_persists_across_storage_instances(self):
        data_dir = tempfile.mkdtemp()
        first = Storage(data_dir)
        second = Storage(data_dir)
        now = int(time.time())
        self.assertTrue(first.consume_authority_nonce("test-nonce-key", expires_at=now + 60, now=now))
        self.assertFalse(second.consume_authority_nonce("test-nonce-key", expires_at=now + 60, now=now))

    def test_expired_authorization_rejected(self):
        _, body = signed_body("governance.vote", "voter_address", {"proposal_id": "proposal-1", "vote": "yes"}, timestamp=1)
        response = self.client.post("/governance/vote", json=body)
        self.assertEqual(response.get_json()["error"]["code"], "AUTHORIZATION_EXPIRED")

    def test_wrong_action_rejected(self):
        _, body = signed_body("treasury.vote", "voter_address", {"proposal_id": "proposal-1", "vote": "yes"})
        response = self.client.post("/governance/vote", json=body)
        self.assertEqual(response.get_json()["error"]["code"], "AUTHORIZATION_ACTION_MISMATCH")

    def test_wrong_domain_rejected(self):
        _, body = signed_body("governance.vote", "voter_address", {"proposal_id": "proposal-1", "vote": "yes"})
        body["authorization"]["domain"] = "wrong.domain"
        response = self.client.post("/governance/vote", json=body)
        self.assertEqual(response.get_json()["error"]["code"], "AUTHORIZATION_DOMAIN_MISMATCH")

    def test_malformed_authorization_rejected(self):
        response = self.client.post(
            "/governance/vote",
            json={
                "proposal_id": "proposal-1",
                "voter_address": Wallet().address,
                "vote": "yes",
                "authorization": {"wallet": Wallet().address},
            },
        )
        self.assertEqual(response.get_json()["error"]["code"], "AUTHORIZATION_MALFORMED")

    def test_wrong_body_hash_rejected(self):
        _, body = signed_body("governance.vote", "voter_address", {"proposal_id": "proposal-1", "vote": "yes"})
        body["authorization"]["body_hash"] = "0" * 64
        response = self.client.post("/governance/vote", json=body)
        self.assertEqual(response.get_json()["error"]["code"], "AUTHORIZATION_BODY_HASH_MISMATCH")

    def test_wrong_wallet_rejected(self):
        _, body = signed_body("governance.vote", "voter_address", {"proposal_id": "proposal-1", "vote": "yes"})
        body["authorization"]["wallet"] = Wallet().address
        response = self.client.post("/governance/vote", json=body)
        self.assertEqual(response.get_json()["error"]["code"], "AUTHORIZATION_WALLET_MISMATCH")

    def test_wrong_public_key_rejected(self):
        _, body = signed_body("governance.vote", "voter_address", {"proposal_id": "proposal-1", "vote": "yes"})
        body["authorization"]["public_key"] = Wallet().public_key_pem()
        response = self.client.post("/governance/vote", json=body)
        self.assertEqual(response.get_json()["error"]["code"], "AUTHORIZATION_WALLET_MISMATCH")

    def test_malformed_public_key_rejected_cleanly(self):
        _, body = signed_body("governance.vote", "voter_address", {"proposal_id": "proposal-1", "vote": "yes"})
        body["authorization"]["public_key"] = "not-a-public-key"
        response = self.client.post("/governance/vote", json=body)
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()["error"]["code"], "AUTHORIZATION_PUBLIC_KEY_INVALID")

    def test_non_vorliq_curve_public_key_rejected(self):
        _, body = signed_body("governance.vote", "voter_address", {"proposal_id": "proposal-1", "vote": "yes"})
        public_key = ec.generate_private_key(ec.SECP256R1()).public_key()
        body["authorization"]["public_key"] = public_key.public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        ).decode("ascii")
        response = self.client.post("/governance/vote", json=body)
        self.assertEqual(response.get_json()["error"]["code"], "AUTHORIZATION_PUBLIC_KEY_INVALID")

    def test_reserved_and_role_like_wallets_rejected(self):
        for identity in ("SYSTEM", "admin", "operator", "moderator"):
            with self.subTest(identity=identity):
                _, body = signed_body("governance.vote", "voter_address", {"proposal_id": "proposal-1", "vote": "yes"})
                body["authorization"]["wallet"] = identity
                body["voter_address"] = identity
                response = self.client.post("/governance/vote", json=body)
                self.assertEqual(response.get_json()["error"]["code"], "AUTHORIZATION_WALLET_INVALID")

    def test_actor_mismatch_rejected(self):
        signer, body = signed_body("governance.vote", "voter_address", {"proposal_id": "proposal-1", "vote": "yes"})
        body["voter_address"] = Wallet().address
        response = self.client.post("/governance/vote", json=body)
        self.assertEqual(response.get_json()["error"]["code"], "AUTHORIZATION_ACTOR_MISMATCH")

    def test_override_rejected(self):
        _, body = signed_body("governance.vote", "voter_address", {"proposal_id": "proposal-1", "vote": "yes", "vote_weight": 999})
        response = self.client.post("/governance/vote", json=body)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()["error"]["code"], "AUTHORIZATION_OVERRIDE_REJECTED")

    def test_invalid_signature_rejected(self):
        _, body = signed_body("governance.vote", "voter_address", {"proposal_id": "proposal-1", "vote": "yes"})
        body["authorization"]["signature"] = "abcdef"
        response = self.client.post("/governance/vote", json=body)
        self.assertEqual(response.get_json()["error"]["code"], "AUTHORIZATION_SIGNATURE_INVALID")
        self.assertNotIn(body["authorization"]["signature"], response.get_data(as_text=True))
        self.assertNotIn(body["authorization"]["public_key"], response.get_data(as_text=True))

    def test_all_guarded_routes_share_the_verifier(self):
        payloads = {
            "/governance/propose": ("governance.propose", "proposer_address", {"title": "Rule", "description": "Detailed proposal", "category": "general", "parameter": "note"}),
            "/governance/vote": ("governance.vote", "voter_address", {"proposal_id": "proposal-1", "vote": "yes"}),
            "/governance/cancel": ("governance.cancel", "proposer_address", {"proposal_id": "proposal-1"}),
            "/treasury/propose": ("treasury.propose", "proposer_address", {"recipient_address": Wallet().address, "title": "Work", "description": "Useful work", "category": "security", "requested_amount": 10}),
            "/treasury/vote": ("treasury.vote", "voter_address", {"proposal_id": "treasury-1", "vote": "yes"}),
            "/treasury/cancel": ("treasury.cancel", "proposer_address", {"proposal_id": "treasury-1"}),
            "/lending/request": ("lending.request", "requester_address", {"amount": 10, "reason": "Useful work"}),
            "/lending/vote": ("lending.vote", "voter_address", {"loan_id": "loan-1", "vote": "yes"}),
            "/lending/repay": ("lending.repay", "repayer_address", {"loan_id": "loan-1"}),
            "/registry/verify-operator": ("registry.verify_operator", "operator_wallet_address", {"node_url": "https://node.example.org"}),
        }
        self.assertEqual(set(payloads), set(AUTHORITY_ROUTES))
        verifier_storage = Storage(tempfile.mkdtemp())
        for route, (action, actor_field, payload) in payloads.items():
            with self.subTest(route=route):
                _, body = signed_body(action, actor_field, payload)
                verified = verify_signed_authorization(body, route, storage=verifier_storage)
                self.assertEqual(verified["action"], action)


if __name__ == "__main__":
    unittest.main()
