"""Legacy peer network layer: peer bookkeeping, broadcasts, discovery, and the
height-based chain sync with full revalidation and prune-point reconciliation.
All HTTP is mocked at the requests boundary — no sockets are opened."""
from __future__ import annotations

import unittest
from unittest import mock

import requests as real_requests

import network as network_module
from blockchain import Blockchain
from network import Network
from transaction import SYSTEM_ADDRESS, Transaction
from wallet import Wallet


def _response(json_data=None, ok=True):
    response = mock.MagicMock()
    response.ok = ok
    response.json.return_value = json_data or {}
    response.raise_for_status.return_value = None
    return response


def _fast_rules():
    """Relax the spacing rules and difficulty on the CLASS for the duration of a
    test so a valid multi-block chain can be mined instantly. Restored by the
    context manager, so no other test sees the relaxed rules."""
    return mock.patch.multiple(
        Blockchain, BLOCK_TIME_MINIMUM=0, SAME_MINER_MIN_GAP=0, difficulty=1
    )


class PeerBookkeepingTest(unittest.TestCase):
    def test_registering_the_same_peer_twice_is_a_no_op(self):
        network = Network()
        self.assertTrue(network.register_peer("https://node-a.example.org"))
        self.assertFalse(network.register_peer("https://node-a.example.org/"))
        self.assertEqual(network.get_peers(), ["https://node-a.example.org"])

    def test_remove_peer_only_removes_known_peers(self):
        network = Network()
        network.register_peer("https://node-a.example.org")
        self.assertTrue(network.remove_peer("https://node-a.example.org"))
        self.assertFalse(network.remove_peer("https://node-a.example.org"))
        self.assertEqual(network.get_peers(), [])

    def test_peer_urls_are_normalized_and_validated(self):
        network = Network()
        self.assertTrue(network.register_peer("https://node-a.example.org:8443/some/path/"))
        self.assertEqual(network.get_peers(), ["https://node-a.example.org:8443"])
        for bad in ["", "   ", "ftp://node.example.org", "http://", None]:
            with self.subTest(bad=bad):
                with self.assertRaises(ValueError):
                    network.register_peer(bad)


class BroadcastTest(unittest.TestCase):
    def setUp(self):
        self.network = Network()
        self.network.register_peer("https://good.example.org")
        self.network.register_peer("https://bad.example.org")

    def test_transaction_broadcast_continues_past_a_failing_peer(self):
        def post(url, **_kwargs):
            if "bad.example.org" in url:
                raise real_requests.RequestException("down")
            return _response()

        with mock.patch.object(network_module.requests, "post", side_effect=post) as posted:
            self.network.broadcast_transaction({"tx_id": "t1"})
        self.assertEqual(posted.call_count, 2)

    def test_block_broadcast_continues_past_a_failing_peer(self):
        def post(url, **_kwargs):
            if "bad.example.org" in url:
                raise real_requests.RequestException("down")
            return _response()

        with mock.patch.object(network_module.requests, "post", side_effect=post) as posted:
            self.network.broadcast_block({"index": 1})
        self.assertEqual(posted.call_count, 2)
        self.assertIn("/api/peer/block", posted.call_args_list[0][0][0])


class PeerStatusAndDiscoveryTest(unittest.TestCase):
    def test_check_peer_statuses_marks_unreachable_peers_false(self):
        network = Network()
        network.register_peer("https://up.example.org")
        network.register_peer("https://down.example.org")

        def get(url, **_kwargs):
            if "down.example.org" in url:
                raise real_requests.RequestException("timeout")
            return _response(ok=True)

        with mock.patch.object(network_module.requests, "get", side_effect=get):
            statuses = network.check_peer_statuses()
        self.assertTrue(statuses["https://up.example.org"])
        self.assertFalse(statuses["https://down.example.org"])

    def test_discover_peers_registers_new_valid_peers_and_skips_bad_ones(self):
        network = Network()

        def get(url, **_kwargs):
            if "seed.example.org" in url:
                return _response({"peers": ["https://found.example.org", "not-a-url"]})
            raise real_requests.RequestException("unreachable")

        with mock.patch.object(network_module.requests, "get", side_effect=get):
            peers = network.discover_peers(["https://seed.example.org", "ftp://invalid"])
        self.assertIn("https://seed.example.org", peers)
        self.assertIn("https://found.example.org", peers)
        self.assertNotIn("not-a-url", peers)

    def test_announce_to_peers_skips_self_and_survives_failures(self):
        network = Network()
        local = "https://me.example.org"

        def post(url, **_kwargs):
            if "flaky.example.org" in url:
                raise real_requests.RequestException("down")
            return _response()

        with mock.patch.object(network_module.requests, "post", side_effect=post) as posted:
            network.announce_to_peers(
                local, ["https://me.example.org/", "https://other.example.org", "https://flaky.example.org", "bad url"]
            )
        called_urls = [call[0][0] for call in posted.call_args_list]
        self.assertEqual(len(called_urls), 2)  # self and the invalid URL are skipped
        self.assertTrue(all("me.example.org" not in url for url in called_urls))
        self.assertTrue(posted.call_args_list[0][1]["json"]["_announced"])


class ChainSyncTest(unittest.TestCase):
    def _mined_chain(self, blocks=2):
        """A real, fully valid chain a peer could serve, mined under relaxed
        spacing so the test is instant. Validation in sync happens under the
        same relaxed class rules, applied per test via _fast_rules()."""
        peer_chain = Blockchain()
        miners = [Wallet().address for _ in range(blocks)]
        for miner in miners:
            peer_chain.add_pending_transaction(Transaction(SYSTEM_ADDRESS, Wallet().address, 5))
            peer_chain.mine_pending_transactions(miner)
        return peer_chain

    def test_unreachable_and_empty_peers_leave_the_local_chain_alone(self):
        network = Network()
        network.register_peer("https://down.example.org")
        network.register_peer("https://empty.example.org")
        local = Blockchain()

        def get(url, **_kwargs):
            if "down.example.org" in url:
                raise real_requests.RequestException("timeout")
            return _response({"chain": []})

        with mock.patch.object(network_module.requests, "get", side_effect=get):
            self.assertFalse(network.sync_chain(local))
        self.assertEqual(local.get_block_height(), 0)

    def test_a_longer_valid_peer_chain_is_adopted_and_pending_refiltered(self):
        with _fast_rules():
            network = Network()
            network.register_peer("https://peer.example.org")
            peer_chain = self._mined_chain(blocks=2)
            local = Blockchain()
            # A SYSTEM reward stub and an unfunded spend both sit pending locally;
            # after adopting the longer chain both must be dropped.
            local.pending_transactions = [
                Transaction(SYSTEM_ADDRESS, Wallet().address, 5),
                Transaction(Wallet().address, Wallet().address, 999),
            ]
            payload = {"chain": [block.to_dict() for block in peer_chain.chain]}
            with mock.patch.object(network_module.requests, "get", return_value=_response(payload)):
                self.assertTrue(network.sync_chain(local))
        self.assertEqual(local.get_block_height(), peer_chain.get_block_height())
        self.assertIsNone(local.prune_point)
        self.assertEqual(local.pending_transactions, [])

    def test_a_longer_but_invalid_peer_chain_is_rejected(self):
        with _fast_rules():
            network = Network()
            network.register_peer("https://peer.example.org")
            peer_chain = self._mined_chain(blocks=2)
            tampered = [block.to_dict() for block in peer_chain.chain]
            tampered[1]["hash"] = "0" * 64  # break the hash link
            local = Blockchain()
            with mock.patch.object(network_module.requests, "get", return_value=_response({"chain": tampered})):
                self.assertFalse(network.sync_chain(local))
        self.assertEqual(local.get_block_height(), 0)

    def test_a_shorter_or_equal_peer_chain_is_never_adopted(self):
        with _fast_rules():
            network = Network()
            network.register_peer("https://peer.example.org")
            local = self._mined_chain(blocks=2)
            shorter = Blockchain()
            payload = {"chain": [block.to_dict() for block in shorter.chain]}
            with mock.patch.object(network_module.requests, "get", return_value=_response(payload)):
                self.assertFalse(network.sync_chain(local))
        self.assertEqual(local.get_block_height(), 2)

    def test_a_pruned_node_rejects_a_chain_contradicting_its_commitment(self):
        with _fast_rules():
            network = Network()
            network.register_peer("https://peer.example.org")
            peer_chain = self._mined_chain(blocks=3)
            local = Blockchain()
            local.prune_point = {"height": 1, "hash": "committed"}
            payload = {"chain": [block.to_dict() for block in peer_chain.chain]}
            with mock.patch.object(local, "offered_chain_matches_prune_point", return_value=False):
                with mock.patch.object(network_module.requests, "get", return_value=_response(payload)):
                    self.assertFalse(network.sync_chain(local))
        self.assertEqual(local.get_block_height(), 0)
        self.assertIsNotNone(local.prune_point)


class PendingFilterTest(unittest.TestCase):
    def test_system_and_unspendable_transactions_are_dropped_after_adoption(self):
        with _fast_rules():
            network = Network()
            funded = Wallet()
            chain = Blockchain()
            chain.add_pending_transaction(Transaction(SYSTEM_ADDRESS, funded.address, 50))
            chain.mine_pending_transactions(Wallet().address)
            chain.pending_transactions = [
                Transaction(SYSTEM_ADDRESS, Wallet().address, 5),   # reward stub: dropped
                Transaction(funded.address, Wallet().address, 10),  # spendable: kept
                Transaction(Wallet().address, Wallet().address, 10),  # unfunded: dropped
            ]
            retained = network._filter_pending_after_chain_update(chain)
        self.assertEqual(len(retained), 1)
        self.assertEqual(retained[0].sender_address, funded.address)


if __name__ == "__main__":
    unittest.main()
