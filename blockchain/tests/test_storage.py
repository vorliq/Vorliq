import tempfile
import unittest

from blockchain import Blockchain
from lending import LendingPool
from storage import Storage
from transaction import SYSTEM_ADDRESS, Transaction


class StorageTests(unittest.TestCase):
    def test_saving_and_loading_chain_restores_blocks(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            storage = Storage(temp_dir)
            blockchain = Blockchain()
            blockchain.mine_pending_transactions("miner")
            storage.save_chain(blockchain)

            restored = storage.load_chain()

            self.assertIsNotNone(restored)
            self.assertEqual(len(restored.chain), 2)

    def test_saving_and_loading_pending_transactions_restores_them(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            storage = Storage(temp_dir)
            pending = [Transaction(SYSTEM_ADDRESS, "receiver", 25)]
            storage.save_pending(pending)

            restored = storage.load_pending()

            self.assertEqual(len(restored), 1)
            self.assertEqual(restored[0]["receiver_address"], "receiver")
            self.assertEqual(restored[0]["amount"], 25)

    def test_saving_and_loading_lending_pool_restores_loan_status(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            storage = Storage(temp_dir)
            lending_pool = LendingPool(Blockchain())
            loan_id = lending_pool.create_loan_request("requester", 500, "reason")
            lending_pool.loan_requests[loan_id]["status"] = "approved"
            storage.save_lending_pool(lending_pool)

            restored = storage.load_lending_pool()

            self.assertEqual(restored.get_loan(loan_id)["status"], "approved")

    def test_saving_and_loading_peers_restores_peer_urls(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            storage = Storage(temp_dir)
            peers = {"http://127.0.0.1:5001", "http://192.168.1.5:5001"}
            storage.save_peers(peers)

            restored = storage.load_peers()

            self.assertEqual(restored, peers)


if __name__ == "__main__":
    unittest.main()
