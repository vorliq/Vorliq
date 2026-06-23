import unittest
from types import SimpleNamespace
from unittest.mock import patch

from blockchain import Blockchain


class BlockchainTests(unittest.TestCase):
    def mine_after_cooldown(self, blockchain, miner_address, seconds=31):
        latest_block = blockchain.get_latest_block()
        next_timestamp = latest_block.timestamp + seconds
        with patch("blockchain.time.time", return_value=next_timestamp), patch("block.time.time", return_value=next_timestamp):
            return blockchain.mine_pending_transactions(miner_address)

    def test_genesis_block_is_created_automatically(self):
        blockchain = Blockchain()

        self.assertEqual(len(blockchain.chain), 1)
        self.assertEqual(blockchain.chain[0].index, 0)
        self.assertEqual(blockchain.chain[0].previous_hash, "0")

    def test_mining_block_adds_it_to_chain(self):
        blockchain = Blockchain()
        mined_block = blockchain.mine_pending_transactions("miner")

        self.assertEqual(len(blockchain.chain), 2)
        self.assertEqual(blockchain.chain[1].hash, mined_block.hash)

    def test_chain_is_valid_after_mining(self):
        blockchain = Blockchain()
        blockchain.mine_pending_transactions("miner")

        self.assertTrue(blockchain.is_chain_valid())

    def test_tampering_with_block_data_invalidates_chain(self):
        blockchain = Blockchain()
        blockchain.mine_pending_transactions("miner")
        blockchain.chain[1].nonce += 1

        self.assertFalse(blockchain.is_chain_valid())

    def test_invalid_chain_cannot_be_extended_by_mining(self):
        blockchain = Blockchain()
        blockchain.mine_pending_transactions("miner_one")
        blockchain.chain[1].nonce += 1
        original_height = blockchain.get_block_height()
        original_pending = list(blockchain.pending_transactions)

        with self.assertRaises(ValueError) as context:
            blockchain.mine_pending_transactions("miner_two")

        self.assertIn("current chain is invalid", str(context.exception))
        self.assertEqual(blockchain.get_block_height(), original_height)
        self.assertEqual(blockchain.pending_transactions, original_pending)

    def test_mining_reward_is_added_as_pending_transaction_after_mining(self):
        blockchain = Blockchain()
        blockchain.mine_pending_transactions("miner")

        self.assertEqual(len(blockchain.pending_transactions), 2)
        self.assertEqual(blockchain.pending_transactions[0].receiver_address, "miner")
        self.assertEqual(blockchain.pending_transactions[0].amount, 47.5)
        self.assertEqual(blockchain.pending_transactions[1].receiver_address, blockchain.TREASURY_ADDRESS)
        self.assertEqual(blockchain.pending_transactions[1].amount, 2.5)

    def test_reserved_addresses_cannot_receive_public_mining_rewards(self):
        blockchain = Blockchain()

        with self.assertRaises(ValueError) as context:
            blockchain.mine_pending_transactions("SYSTEM")

        self.assertIn("reserved system", str(context.exception))
        self.assertEqual(len(blockchain.chain), 1)
        self.assertEqual(len(blockchain.pending_transactions), 0)

    def test_halving_calculation(self):
        blockchain = Blockchain()
        self.assertEqual(blockchain.get_current_mining_reward(), 50)

        blockchain.get_total_issued = lambda: 0
        # The halving schedule is driven by the tip block's index + 1 (the true
        # block count, which survives pruning), not the retained-list length, so
        # the synthetic chain just needs its tip to carry index 209999 (the
        # 210000th block). Only the tip is dereferenced.
        blockchain.chain = [None] * 209999 + [SimpleNamespace(index=209999)]
        self.assertEqual(blockchain.get_current_mining_reward(), 25)

    def test_maximum_supply_constant(self):
        self.assertEqual(Blockchain.maximum_supply, 21000000)

    def test_mining_two_blocks_too_quickly_raises_value_error(self):
        blockchain = Blockchain()
        blockchain.mine_pending_transactions("miner_one")

        with self.assertRaises(ValueError) as context:
            blockchain.mine_pending_transactions("miner_two")

        self.assertIn("too soon to mine the next block", str(context.exception))

    def test_same_address_cannot_mine_two_consecutive_blocks(self):
        blockchain = Blockchain()
        blockchain.mine_pending_transactions("miner_one")

        with self.assertRaises(ValueError) as context:
            self.mine_after_cooldown(blockchain, "miner_one")

        self.assertIn("the same address cannot mine two consecutive blocks", str(context.exception))

    def test_mining_with_time_gap_and_different_addresses_succeeds(self):
        blockchain = Blockchain()
        blockchain.mine_pending_transactions("miner_one")
        mined_block = self.mine_after_cooldown(blockchain, "miner_two")

        self.assertEqual(len(blockchain.chain), 3)
        self.assertEqual(mined_block.miner_address, "miner_two")

    def test_difficulty_increases_after_ten_fast_blocks(self):
        blockchain = Blockchain()
        blockchain.difficulty = 2
        blockchain.proof_target = "0" * blockchain.difficulty

        for index in range(10):
            self.mine_after_cooldown(blockchain, f"miner_{index % 2}")

        self.assertEqual(blockchain.get_block_height(), 10)
        self.assertEqual(blockchain.difficulty, 3)

    def test_chain_summary_does_not_return_full_chain(self):
        blockchain = Blockchain()
        summary = blockchain.get_chain_summary()

        self.assertEqual(summary["block_height"], 0)
        self.assertEqual(summary["total_blocks"], 1)
        self.assertEqual(summary["total_transactions"], 0)
        self.assertTrue(summary["chain_valid"])
        self.assertNotIn("chain", summary)

    def test_blocks_page_returns_newest_first_with_has_more(self):
        blockchain = Blockchain()
        blockchain.mine_pending_transactions("miner_one")
        self.mine_after_cooldown(blockchain, "miner_two")

        blocks, total, has_more = blockchain.get_blocks_page(limit=1, offset=0)

        self.assertEqual(total, 3)
        self.assertTrue(has_more)
        self.assertEqual(blocks[0]["index"], 2)

    def test_address_transactions_are_paginated_and_include_block_metadata(self):
        blockchain = Blockchain()
        blockchain.mine_pending_transactions("miner_one")
        self.mine_after_cooldown(blockchain, "miner_two")

        transactions, total, has_more = blockchain.get_address_transactions("miner_one", limit=1, offset=0)

        self.assertEqual(total, 1)
        self.assertFalse(has_more)
        self.assertEqual(transactions[0]["receiver_address"], "miner_one")
        self.assertEqual(transactions[0]["block_index"], 2)
        self.assertIn("block_timestamp", transactions[0])


if __name__ == "__main__":
    unittest.main()
