import unittest
import time

from blockchain import Blockchain


class BlockchainTests(unittest.TestCase):
    def make_latest_block_ready(self, blockchain, seconds=31):
        latest_block = blockchain.get_latest_block()
        latest_block.timestamp = time.time() - seconds
        latest_block.nonce = 0
        latest_block.proof_of_work(latest_block.difficulty)

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

    def test_mining_reward_is_added_as_pending_transaction_after_mining(self):
        blockchain = Blockchain()
        blockchain.mine_pending_transactions("miner")

        self.assertEqual(len(blockchain.pending_transactions), 2)
        self.assertEqual(blockchain.pending_transactions[0].receiver_address, "miner")
        self.assertEqual(blockchain.pending_transactions[0].amount, 47.5)
        self.assertEqual(blockchain.pending_transactions[1].receiver_address, blockchain.TREASURY_ADDRESS)
        self.assertEqual(blockchain.pending_transactions[1].amount, 2.5)

    def test_halving_calculation(self):
        blockchain = Blockchain()
        self.assertEqual(blockchain.get_current_mining_reward(), 50)

        blockchain.get_total_issued = lambda: 0
        blockchain.chain = [None] * 210000
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
        self.make_latest_block_ready(blockchain)

        with self.assertRaises(ValueError) as context:
            blockchain.mine_pending_transactions("miner_one")

        self.assertIn("the same address cannot mine two consecutive blocks", str(context.exception))

    def test_mining_with_time_gap_and_different_addresses_succeeds(self):
        blockchain = Blockchain()
        blockchain.mine_pending_transactions("miner_one")
        self.make_latest_block_ready(blockchain)
        mined_block = blockchain.mine_pending_transactions("miner_two")

        self.assertEqual(len(blockchain.chain), 3)
        self.assertEqual(mined_block.miner_address, "miner_two")

    def test_difficulty_increases_after_ten_fast_blocks(self):
        blockchain = Blockchain()
        blockchain.difficulty = 2
        blockchain.proof_target = "0" * blockchain.difficulty

        for index in range(10):
            self.make_latest_block_ready(blockchain)
            blockchain.mine_pending_transactions(f"miner_{index % 2}")

        self.assertEqual(blockchain.get_block_height(), 10)
        self.assertEqual(blockchain.difficulty, 3)


if __name__ == "__main__":
    unittest.main()
