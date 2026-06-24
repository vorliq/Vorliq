"""The public treasury transparency view must agree with the canonical treasury
balance and the block explorer — visitors verify it, so it cannot drift."""

import os
import unittest
from unittest.mock import patch

from blockchain import Blockchain


class TreasuryTransparencyTests(unittest.TestCase):
    def setUp(self):
        self._prev = os.environ.get("VORLIQ_DISABLE_DIFFICULTY_ADJUSTMENT")
        os.environ["VORLIQ_DISABLE_DIFFICULTY_ADJUSTMENT"] = "true"

    def tearDown(self):
        if self._prev is None:
            os.environ.pop("VORLIQ_DISABLE_DIFFICULTY_ADJUSTMENT", None)
        else:
            os.environ["VORLIQ_DISABLE_DIFFICULTY_ADJUSTMENT"] = self._prev

    def _mine(self, blockchain, miner, seconds=61):
        latest = blockchain.get_latest_block()
        ts = latest.timestamp + seconds
        with patch("blockchain.time.time", return_value=ts), patch(
            "block.time.time", return_value=ts
        ), patch.object(blockchain, "is_chain_valid", return_value=True):
            return blockchain.mine_pending_transactions(miner)

    def test_transparency_balance_matches_canonical_balance(self):
        bc = Blockchain()
        bc.difficulty = 1
        bc.proof_target = "0"
        for i in range(8):
            self._mine(bc, f"miner{i % 3}")

        t = bc.get_treasury_transparency()
        # Balance equals the independent, full-chain treasury balance computation.
        self.assertAlmostEqual(t["balance"], bc.get_treasury_balance(), places=8)
        # Treasury is funded by the 5% reward, so there are inflows and the totals
        # reconcile: balance == inflow - outflow.
        self.assertGreater(t["inflow_count"], 0)
        self.assertAlmostEqual(t["balance"], t["total_inflow"] - t["total_outflow"], places=8)
        # Every inflow is a mining reward, and the series ends at the balance.
        self.assertTrue(all(f["source"] == "mining_reward" for f in t["recent_inflows"]))
        self.assertAlmostEqual(t["balance_series"][-1]["balance"], t["balance"], places=8)

    def test_series_is_downsampled_to_the_cap(self):
        bc = Blockchain()
        bc.difficulty = 1
        bc.proof_target = "0"
        for i in range(40):
            self._mine(bc, f"miner{i % 3}")

        t = bc.get_treasury_transparency(max_points=10)
        self.assertLessEqual(len(t["balance_series"]), 10)
        # Still ends at the true current balance after downsampling.
        self.assertAlmostEqual(t["balance_series"][-1]["balance"], t["balance"], places=8)


if __name__ == "__main__":
    unittest.main()
