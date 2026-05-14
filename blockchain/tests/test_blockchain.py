import unittest

from blockchain import Blockchain


class BlockchainTests(unittest.TestCase):
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

        self.assertEqual(len(blockchain.pending_transactions), 1)
        self.assertEqual(blockchain.pending_transactions[0].receiver_address, "miner")
        self.assertEqual(blockchain.pending_transactions[0].amount, 50)

    def test_halving_calculation(self):
        blockchain = Blockchain()
        self.assertEqual(blockchain.get_current_mining_reward(), 50)

        blockchain.get_total_issued = lambda: 0
        blockchain.chain = [None] * 210000
        self.assertEqual(blockchain.get_current_mining_reward(), 25)

    def test_maximum_supply_constant(self):
        self.assertEqual(Blockchain.maximum_supply, 21000000)


if __name__ == "__main__":
    unittest.main()
