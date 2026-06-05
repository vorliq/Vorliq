import os
import tempfile
import unittest
from unittest.mock import patch

_TEST_DATA_DIR = tempfile.TemporaryDirectory()
os.environ["VORLIQ_DATA_DIR"] = _TEST_DATA_DIR.name
os.environ["VORLIQ_PEER_RECEIVE_ENABLED"] = "true"
os.environ["VORLIQ_PEER_BROADCAST_ENABLED"] = "false"

from app import app, node, peer_events, storage
from block import Block
from blockchain import Blockchain
from peer_propagation import PeerEventLog
from network import Network
from transaction import SYSTEM_ADDRESS, Transaction
from wallet import Wallet


class PeerPropagationTests(unittest.TestCase):
    def setUp(self):
        app.config["TESTING"] = True
        self.client = app.test_client()
        node.blockchain = Blockchain()
        node.blockchain.pending_transactions = []
        peer_events.path = storage.data_dir / "peer_events_test.json"
        if peer_events.path.exists():
            peer_events.path.unlink()

    def fund_wallet(self, wallet, amount=100):
        node.blockchain.add_pending_transaction(Transaction(SYSTEM_ADDRESS, wallet.address, amount))
        node.blockchain.get_latest_block().timestamp -= node.blockchain.BLOCK_TIME_MINIMUM + 1
        node.blockchain.mine_pending_transactions("miner_one")
        node.blockchain.pending_transactions = []

    def signed_transaction_payload(self, amount=5):
        sender = Wallet()
        receiver = Wallet()
        self.fund_wallet(sender)
        transaction = Transaction(sender.address, receiver.address, amount)
        transaction.sign_transaction(sender)
        return transaction.to_dict()

    def test_valid_peer_transaction_is_accepted(self):
        payload = self.signed_transaction_payload()
        response = self.client.post("/peer/transaction", json={"transaction": payload, "source_node_url": "https://peer.example.org"})

        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.get_json()["success"])
        self.assertEqual(len(node.blockchain.pending_transactions), 1)
        events = peer_events.load()
        self.assertEqual(events[-1]["status"], "accepted")
        self.assertNotIn("sender_public_key", events[-1])
        self.assertNotIn("signature", events[-1])

    def test_duplicate_peer_transaction_is_safe_success(self):
        payload = self.signed_transaction_payload()
        first = self.client.post("/peer/transaction", json={"transaction": payload})
        second = self.client.post("/peer/transaction", json={"transaction": payload})

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 200)
        self.assertTrue(second.get_json()["duplicate"])
        self.assertEqual(len(node.blockchain.pending_transactions), 1)

    def test_invalid_signature_is_rejected(self):
        payload = self.signed_transaction_payload()
        payload["signature"] = "00" + payload["signature"][2:]
        payload["tx_id"] = Transaction.from_dict({**payload, "tx_id": None}).calculate_tx_id()
        response = self.client.post("/peer/transaction", json={"transaction": payload})

        self.assertEqual(response.status_code, 400)
        self.assertFalse(response.get_json()["success"])
        self.assertEqual(response.get_json()["reason"], "invalid_signature")

    def test_fake_system_peer_transaction_is_rejected(self):
        receiver = Wallet()
        response = self.client.post(
            "/peer/transaction",
            json={
                "transaction": {
                    "sender_address": "SYSTEM",
                    "receiver_address": receiver.address,
                    "amount": 1,
                    "timestamp": 1,
                    "signature": None,
                    "sender_public_key": None,
                }
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()["reason"], "reserved_address")

    def test_valid_direct_next_peer_block_is_accepted(self):
        latest = node.blockchain.get_latest_block()
        block = Block(
            index=latest.index + 1,
            transactions=[],
            previous_hash=latest.hash,
            timestamp=latest.timestamp + node.blockchain.BLOCK_TIME_MINIMUM + 1,
            miner_address=Wallet().address,
            difficulty=node.blockchain.difficulty,
        )
        block.proof_of_work(node.blockchain.difficulty)
        response = self.client.post("/peer/block", json={"block": block.to_dict(), "source_node_url": "https://peer.example.org"})

        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.get_json()["success"])
        self.assertEqual(node.blockchain.get_block_height(), 1)
        self.assertEqual(peer_events.load()[-1]["status"], "accepted")

    def test_non_next_valid_peer_block_is_quarantined(self):
        latest = node.blockchain.get_latest_block()
        block = Block(
            index=latest.index + 2,
            transactions=[],
            previous_hash="0" * 64,
            timestamp=latest.timestamp + node.blockchain.BLOCK_TIME_MINIMUM + 1,
            difficulty=node.blockchain.difficulty,
        )
        block.proof_of_work(node.blockchain.difficulty)
        response = self.client.post("/peer/block", json={"block": block.to_dict()})

        self.assertEqual(response.status_code, 202)
        self.assertTrue(response.get_json()["quarantined"])
        self.assertEqual(node.blockchain.get_block_height(), 0)
        self.assertEqual(peer_events.load()[-1]["status"], "quarantined")

    def test_invalid_peer_block_is_rejected(self):
        latest = node.blockchain.get_latest_block()
        block = Block(
            index=latest.index + 1,
            transactions=[],
            previous_hash=latest.hash,
            timestamp=latest.timestamp + node.blockchain.BLOCK_TIME_MINIMUM + 1,
            difficulty=node.blockchain.difficulty,
        )
        block.proof_of_work(node.blockchain.difficulty)
        data = block.to_dict()
        data["hash"] = "bad"
        response = self.client.post("/peer/block", json={"block": data})

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()["reason"], "invalid_hash")

    def test_legacy_receive_block_route_is_retired_without_mutation(self):
        marker = "dummy-private-key-marker-never-reflect"
        initial_height = node.blockchain.get_block_height()

        response = self.client.post(
            "/receive_block",
            json={
                "index": initial_height + 1,
                "transactions": [],
                "previous_hash": "0" * 64,
                "nonce": 1,
                "hash": "bad",
                "raw_payload": marker,
            },
        )

        serialized = response.get_data(as_text=True)
        body = response.get_json()
        self.assertEqual(response.status_code, 410)
        self.assertFalse(body["success"])
        self.assertEqual(body["error"]["code"], "LEGACY_PEER_BLOCK_RETIRED")
        self.assertEqual(node.blockchain.get_block_height(), initial_height)
        self.assertNotIn(marker, serialized)

    def test_legacy_network_block_broadcast_uses_safe_peer_block_route(self):
        network = Network()
        network.register_peer("https://community-node.example")

        with patch("network.requests.post") as post:
            post.return_value.raise_for_status.return_value = None
            network.broadcast_block({"index": 1})

        post.assert_called_once_with(
            "https://community-node.example/api/peer/block",
            json={"block": {"index": 1}},
            timeout=5,
        )

    def test_peer_event_log_is_capped_and_safe(self):
        event_log = PeerEventLog(storage.data_dir / "peer_events_cap_test.json", retention_limit=3)
        for index in range(5):
            event_log.append(
                {
                    "direction": "inbound",
                    "type": "transaction",
                    "peer_url": "https://peer.example.org",
                    "status": "rejected",
                    "reason": "invalid_payload",
                    "tx_id": f"tx-{index}",
                    "safe_message": "PRIVATE KEY should not persist as a raw payload",
                }
            )
        events = event_log.load()
        serialized = str(events)
        self.assertEqual(len(events), 3)
        self.assertNotIn("raw_payload", serialized)
        self.assertNotIn("sender_public_key", serialized)

    def test_peer_event_log_redacts_raw_ip_peer_urls(self):
        event_log = PeerEventLog(storage.data_dir / "peer_events_ip_test.json", retention_limit=3)
        event_log.append(
            {
                "direction": "inbound",
                "type": "block",
                "peer_url": "https://192.0.2.10:5000",
                "status": "quarantined",
                "reason": "ahead_candidate",
                "safe_message": "Peer block was quarantined.",
            }
        )

        events = event_log.load()
        self.assertEqual(events[-1]["peer_url"], "")
        self.assertNotIn("192.0.2.10", str(events))


if __name__ == "__main__":
    unittest.main()
