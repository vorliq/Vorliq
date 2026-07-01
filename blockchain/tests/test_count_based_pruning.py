"""Count-based pruning: the trigger, the prune-point commitment, and honest
post-prune historical reads.

The prune *mechanism* and multi-node consensus are covered by
test_pruning_consensus.py. These tests pin the parts that the count-based
auto-trigger and the explorer/audit read paths depend on:

  * the auto-trigger fires exactly at (keep + batch) and never below it or when
    disabled,
  * a prune updates the prune-point commitment and the height bookkeeping,
  * a request for a pruned block is a clear, documented 410 (not a generic
    not-found and not a 500), while a block that never existed stays a 404, and
  * /audit/chain and /chain/summary do not silently present a retained block as
    the genesis or the retained count as the full history.
"""

import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import app as app_module
from app import app, node
from blockchain import Blockchain


class _NoDifficultyAdjust(unittest.TestCase):
    """Disable difficulty adjustment for deterministic, fast mining, restoring the
    environment in tearDown so it never leaks into other test modules (a global
    set here would, for example, break the difficulty-increase tests)."""

    def setUp(self):
        super().setUp()
        self._prev_diff = os.environ.get("VORLIQ_DISABLE_DIFFICULTY_ADJUSTMENT")
        os.environ["VORLIQ_DISABLE_DIFFICULTY_ADJUSTMENT"] = "true"

    def tearDown(self):
        if self._prev_diff is None:
            os.environ.pop("VORLIQ_DISABLE_DIFFICULTY_ADJUSTMENT", None)
        else:
            os.environ["VORLIQ_DISABLE_DIFFICULTY_ADJUSTMENT"] = self._prev_diff
        super().tearDown()


def _mine(bc, miner, seconds=61):
    latest = bc.get_latest_block()
    ts = latest.timestamp + seconds
    with patch("blockchain.time.time", return_value=ts), patch(
        "block.time.time", return_value=ts
    ), patch.object(bc, "is_chain_valid", return_value=True):
        return bc.mine_pending_transactions(miner)


def _build(height):
    bc = Blockchain()
    bc.difficulty = 1
    bc.proof_target = "0"
    miners = [f"miner_{i}" for i in range(4)]
    i = 0
    while bc.get_block_height() < height:
        _mine(bc, miners[i % len(miners)])
        i += 1
    return bc


class CountBasedTriggerTests(unittest.TestCase):
    """The decision in app._auto_prune_if_enabled, isolated from storage."""

    def _run_trigger(self, *, enabled, keep, batch, chain_len):
        stub_node = SimpleNamespace(blockchain=SimpleNamespace(chain=[None] * chain_len))
        with patch.object(app_module, "VORLIQ_CHAIN_PRUNE_ENABLED", enabled), patch.object(
            app_module, "VORLIQ_CHAIN_PRUNE_KEEP_BLOCKS", keep
        ), patch.object(app_module, "VORLIQ_CHAIN_PRUNE_BATCH", batch), patch.object(
            app_module, "node", stub_node
        ), patch.object(app_module, "_prune_chain_to") as prune:
            app_module._auto_prune_if_enabled()
        return prune

    def test_fires_at_keep_plus_batch(self):
        prune = self._run_trigger(enabled=True, keep=100, batch=10, chain_len=110)
        prune.assert_called_once_with(100)

    def test_does_not_fire_one_below_threshold(self):
        prune = self._run_trigger(enabled=True, keep=100, batch=10, chain_len=109)
        prune.assert_not_called()

    def test_disabled_never_fires_even_far_past_threshold(self):
        prune = self._run_trigger(enabled=False, keep=100, batch=10, chain_len=10_000)
        prune.assert_not_called()


class PruneCommitmentTests(_NoDifficultyAdjust):
    def test_prune_updates_commitment_and_height(self):
        bc = _build(60)
        issued_before = bc.get_total_issued()
        result = bc.prune_chain(20)
        self.assertTrue(result["pruned"])
        self.assertEqual(result["retained_blocks"], 20)
        self.assertEqual(result["dropped_blocks"], 41)  # 61 total blocks - 20 kept
        self.assertEqual(bc.prune_height(), 40)
        self.assertIsNotNone(bc.prune_point.get("commitment"))
        self.assertTrue(bc.prune_commitment_is_valid())
        # Supply is seeded from the commitment, so it survives the prune unchanged.
        self.assertAlmostEqual(bc.get_total_issued(), issued_before, places=6)
        self.assertEqual(bc.get_block_height(), 60)  # true height, not retained count

    def test_is_pruned_block_index_classification(self):
        bc = _build(60)
        bc.prune_chain(20)
        self.assertTrue(bc.is_pruned_block_index(3))     # well below prune point
        self.assertTrue(bc.is_pruned_block_index(40))    # exactly at the prune point
        self.assertFalse(bc.is_pruned_block_index(41))   # first retained block
        self.assertFalse(bc.is_pruned_block_index(60))   # tip
        self.assertFalse(bc.is_pruned_block_index(999))  # never existed
        # An unpruned chain has no pruned indices at all.
        self.assertFalse(_build(10).is_pruned_block_index(0))


class PostPruneReadRouteTests(_NoDifficultyAdjust):
    """Endpoint behaviour after a prune, via the Flask test client. The shared
    node blockchain is swapped for a pruned one and restored, with no storage
    writes (prune_chain rebuilds indexes in memory only)."""

    def setUp(self):
        super().setUp()
        self.client = app.test_client()
        self._original = node.blockchain
        bc = _build(60)
        bc.prune_chain(20)  # retain 41..60, prune point at height 40
        node.blockchain = bc

    def tearDown(self):
        node.blockchain = self._original
        super().tearDown()

    def test_pruned_block_is_a_clear_410(self):
        response = self.client.get("/chain/block/3")
        self.assertEqual(response.status_code, 410)
        body = response.get_json()
        self.assertFalse(body["success"])
        self.assertTrue(body["pruned"])
        self.assertEqual(body["prune_point"]["height"], 40)
        self.assertIn("prune point", body["message"].lower())

    def test_retained_block_is_served(self):
        response = self.client.get("/chain/block/60")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()["success"])

    def test_never_existed_block_is_a_plain_404(self):
        # Above the tip: never existed, so it must NOT be reported as pruned.
        response = self.client.get("/chain/block/999")
        self.assertEqual(response.status_code, 404)
        self.assertFalse(response.get_json().get("pruned", False))

    def test_audit_chain_does_not_fake_a_genesis(self):
        body = self.client.get("/audit/chain").get_json()
        self.assertIsNone(body["genesis_hash"])  # the retained head is not the genesis
        self.assertTrue(body["pruned"])
        self.assertEqual(body["prune_point"]["height"], 40)
        self.assertEqual(body["chain_height"], 60)
        self.assertEqual(body["retained_from_index"], 41)

    def test_summary_surfaces_the_prune_boundary(self):
        body = self.client.get("/chain/summary").get_json()
        summary = body["summary"]
        self.assertEqual(summary["block_height"], 60)
        self.assertTrue(summary["pruned"])
        self.assertEqual(summary["retained_blocks"], 20)
        self.assertEqual(summary["prune_point"]["height"], 40)

    def test_blocks_page_reports_true_height_and_prune_point(self):
        body = self.client.get("/chain/blocks?limit=5&offset=0").get_json()
        self.assertEqual(body["chain_height"], 60)
        self.assertEqual(body["prune_point"]["height"], 40)


if __name__ == "__main__":
    unittest.main()
