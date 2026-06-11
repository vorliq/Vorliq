import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from block import Block
from blockchain import Blockchain
from indexes import BlockchainIndexes
from storage import Storage


class BlockchainIndexTests(unittest.TestCase):
    def mine_after_cooldown(self, blockchain, miner_address, seconds=31):
        latest_block = blockchain.get_latest_block()
        next_timestamp = latest_block.timestamp + seconds
        with patch("blockchain.time.time", return_value=next_timestamp), patch("block.time.time", return_value=next_timestamp):
            return blockchain.mine_pending_transactions(miner_address)

    def make_confirmed_rewards(self):
        blockchain = Blockchain()
        blockchain.difficulty = 2
        blockchain.proof_target = "0" * blockchain.difficulty
        blockchain.mine_pending_transactions("miner_one")
        self.mine_after_cooldown(blockchain, "miner_two")
        return blockchain

    def test_index_build_from_chain(self):
        blockchain = self.make_confirmed_rewards()
        indexes = BlockchainIndexes.build(blockchain)

        self.assertEqual(indexes.chain_height, blockchain.get_block_height())
        self.assertEqual(indexes.latest_block_hash, blockchain.get_latest_block().hash)
        self.assertIn("chain_summary", indexes.indexes)

    def test_indexes_blocks_by_index_and_hash(self):
        blockchain = self.make_confirmed_rewards()
        indexes = BlockchainIndexes.build(blockchain)
        latest = blockchain.get_latest_block()

        self.assertEqual(indexes.block_detail(str(latest.index))["hash"], latest.hash)
        self.assertEqual(indexes.block_detail(latest.hash)["index"], latest.index)

    def test_index_transaction_by_tx_id(self):
        blockchain = self.make_confirmed_rewards()
        indexes = BlockchainIndexes.build(blockchain)
        transaction = blockchain.safe_transaction_record(
            blockchain.chain[2].transactions[0],
            status="confirmed",
            block=blockchain.chain[2],
            transaction_index=0,
        )

        self.assertEqual(indexes.transaction_detail(transaction["tx_id"])["tx_id"], transaction["tx_id"])

    def test_legacy_transaction_without_tx_id_is_indexed(self):
        blockchain = self.make_confirmed_rewards()
        legacy_transaction = blockchain.chain[2].transactions[0].to_dict()
        legacy_transaction.pop("tx_id", None)
        blockchain.chain[2].transactions[0] = legacy_transaction

        indexes = BlockchainIndexes.build(blockchain)
        indexed_transactions = indexes.indexes["transactions_by_block"][str(blockchain.chain[2].index)]

        self.assertTrue(indexed_transactions[0]["tx_id"])
        self.assertNotIn("tx_id", blockchain.chain[2].transactions[0])

    def test_address_transaction_index_works(self):
        blockchain = self.make_confirmed_rewards()
        indexes = BlockchainIndexes.build(blockchain)

        records = indexes.transactions_for_address("miner_one")

        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["receiver_address"], "miner_one")

    def test_balance_index_matches_existing_balance_calculation(self):
        blockchain = self.make_confirmed_rewards()
        indexes = BlockchainIndexes.build(blockchain)

        self.assertEqual(indexes.balance("miner_one"), blockchain.get_balance("miner_one"))
        self.assertEqual(indexes.balance(blockchain.TREASURY_ADDRESS), blockchain.get_balance(blockchain.TREASURY_ADDRESS))

    def test_miner_stats_index_works(self):
        blockchain = self.make_confirmed_rewards()
        indexes = BlockchainIndexes.build(blockchain)

        self.assertEqual(indexes.indexes["miner_stats"]["miner_one"]["blocks_mined"], 1)
        self.assertEqual(indexes.indexes["miner_stats"]["miner_two"]["blocks_mined"], 1)

    def test_indexes_rebuild_when_latest_hash_mismatch(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            blockchain = self.make_confirmed_rewards()
            storage = Storage(temp_dir)
            storage.save_indexes(BlockchainIndexes.build(blockchain))
            self.mine_after_cooldown(blockchain, "miner_three")

            self.assertIsNone(storage.load_indexes(blockchain))

    def test_corrupt_indexes_do_not_break_startup(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            storage = Storage(temp_dir)
            Path(temp_dir, "indexes.json").write_text("{bad json", encoding="utf-8")

            self.assertIsNone(storage.load_indexes(Blockchain()))

    def test_index_health_reports_mismatch(self):
        blockchain = self.make_confirmed_rewards()
        indexes = BlockchainIndexes.build(blockchain)
        self.mine_after_cooldown(blockchain, "miner_three")

        health = indexes.health(blockchain)

        self.assertEqual(health["status"], "warning")
        self.assertTrue(health["rebuild_needed"])
        self.assertFalse(health["index_chain_match"])


if __name__ == "__main__":
    unittest.main()
