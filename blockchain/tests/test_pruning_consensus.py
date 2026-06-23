"""Multi-node consensus when one node has pruned its history.

A pruned node keeps only its most recent blocks plus a cryptographic commitment
to the pruned history (the prune-point block hash and a confirmed-balance
snapshot). A full-chain peer commits to a *different* first block (genesis), so
naive chain adoption — comparing list length and validating the peer chain
against the local node's own prune-point back-link — both break. These tests pin
the corrected behaviour:

  * a pruned node adopts a longer full chain whose history reaches exactly the
    state it committed to at the prune height, and
  * it rejects an equally-long, internally-valid chain that rewrote that history,
    so a fork can never erase committed history.
"""

import os
import unittest
from unittest.mock import patch

from blockchain import Blockchain
from network import Network


def _mine(blockchain, miner_address, seconds=61):
    latest = blockchain.get_latest_block()
    ts = latest.timestamp + seconds
    with patch("blockchain.time.time", return_value=ts), patch(
        "block.time.time", return_value=ts
    ), patch.object(blockchain, "is_chain_valid", return_value=True):
        return blockchain.mine_pending_transactions(miner_address)


def _build_chain(target_height, miner_prefix):
    bc = Blockchain()
    bc.difficulty = 1
    bc.proof_target = "0"
    miners = [f"{miner_prefix}_{i}" for i in range(4)]
    i = 0
    while bc.get_block_height() < target_height:
        _mine(bc, miners[i % len(miners)])
        i += 1
    return bc


class PruningConsensusTests(unittest.TestCase):
    def setUp(self):
        self._prev = os.environ.get("VORLIQ_DISABLE_DIFFICULTY_ADJUSTMENT")
        os.environ["VORLIQ_DISABLE_DIFFICULTY_ADJUSTMENT"] = "true"

    def tearDown(self):
        if self._prev is None:
            os.environ.pop("VORLIQ_DISABLE_DIFFICULTY_ADJUSTMENT", None)
        else:
            os.environ["VORLIQ_DISABLE_DIFFICULTY_ADJUSTMENT"] = self._prev

    def _pruned_from(self, full, keep_blocks):
        """A node that shares `full`'s history but has pruned to keep_blocks."""
        pruned = Blockchain()
        pruned.difficulty = 1
        pruned.proof_target = "0"
        pruned.chain = list(full.chain)  # same blocks, independent list
        pruned.prune_chain(keep_blocks)
        return pruned

    def test_offered_full_chain_consistent_with_commitment_is_accepted(self):
        full = _build_chain(60, "minerA")
        pruned = self._pruned_from(full, 20)
        self.assertIsNotNone(pruned.prune_point)
        self.assertEqual(len(pruned.chain), 20)
        # The full chain reaches exactly the state the pruned node committed to.
        self.assertTrue(pruned.offered_chain_matches_prune_point(full.chain))

    def test_forked_chain_that_rewrote_pruned_history_is_rejected(self):
        full = _build_chain(60, "minerA")
        pruned = self._pruned_from(full, 20)
        # An independent chain with different early history: its block at the prune
        # height hashes differently, so it cannot reproduce the commitment.
        forked = _build_chain(70, "minerB")
        self.assertFalse(pruned.offered_chain_matches_prune_point(forked.chain))

    def test_pruned_node_syncs_a_longer_consistent_full_chain(self):
        full = _build_chain(60, "minerA")
        pruned = self._pruned_from(full, 20)
        # The full-chain peer mines further: now it is taller than the pruned node.
        while full.get_block_height() < 75:
            _mine(full, "minerA_extra")
        self.assertGreater(full.get_block_height(), pruned.get_block_height())

        network = Network()
        network.peers.add("http://peer-full")

        class _Resp:
            status_code = 200
            def raise_for_status(self):
                return None
            def json(self):
                return {"chain": full.get_chain_data()}

        with patch("network.requests.get", return_value=_Resp()):
            adopted = network.sync_chain(pruned)

        self.assertTrue(adopted)
        # The pruned node now holds the full chain, at the peer's height, and is no
        # longer pruned.
        self.assertEqual(pruned.get_block_height(), full.get_block_height())
        self.assertIsNone(pruned.prune_point)
        self.assertTrue(pruned.is_chain_valid(enforce_block_spacing=False))

    def test_pruned_node_rejects_a_longer_contradicting_chain_over_the_wire(self):
        full = _build_chain(60, "minerA")
        pruned = self._pruned_from(full, 20)
        original_tip = pruned.get_latest_block().hash
        original_height = pruned.get_block_height()
        # A taller but contradicting full chain (independent history).
        forked = _build_chain(80, "minerB")
        self.assertGreater(forked.get_block_height(), pruned.get_block_height())

        network = Network()
        network.peers.add("http://peer-forked")

        class _Resp:
            status_code = 200
            def raise_for_status(self):
                return None
            def json(self):
                return {"chain": forked.get_chain_data()}

        with patch("network.requests.get", return_value=_Resp()):
            adopted = network.sync_chain(pruned)

        # Rejected: longer and internally valid, but it rewrote our committed
        # history, so the pruned node keeps its own chain and prune point.
        self.assertFalse(adopted)
        self.assertEqual(pruned.get_latest_block().hash, original_tip)
        self.assertEqual(pruned.get_block_height(), original_height)
        self.assertIsNotNone(pruned.prune_point)


if __name__ == "__main__":
    unittest.main()
