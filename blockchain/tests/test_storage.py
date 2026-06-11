import json
import tempfile
import threading
import unittest
from pathlib import Path

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

            self.assertEqual(restored.get_loan(loan_id)["status"], "approved_pending_issue")

    def test_saving_and_loading_peers_restores_peer_urls(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            storage = Storage(temp_dir)
            peers = {"http://127.0.0.1:5001", "http://192.168.1.5:5001"}
            storage.save_peers(peers)

            restored = storage.load_peers()

            self.assertEqual(restored, peers)

    def test_atomic_write_creates_valid_json_and_backup_on_overwrite(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            storage = Storage(temp_dir)
            storage.save_peers({"http://one"})
            storage.save_peers({"http://two"})

            peers_file = Path(temp_dir) / "peers.json"
            backup_file = Path(temp_dir) / "peers.json.bak"

            self.assertEqual(json.loads(peers_file.read_text(encoding="utf-8")), ["http://two"])
            self.assertEqual(json.loads(backup_file.read_text(encoding="utf-8")), ["http://one"])

    def test_load_falls_back_to_backup_when_main_json_is_corrupt(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            storage = Storage(temp_dir)
            peers_file = Path(temp_dir) / "peers.json"
            peers_file.write_text("{bad json", encoding="utf-8")
            (Path(temp_dir) / "peers.json.bak").write_text(json.dumps(["http://backup"]), encoding="utf-8")

            restored = storage.load_peers()

            self.assertEqual(restored, {"http://backup"})
            self.assertTrue(list(Path(temp_dir).glob("peers.json.corrupt.*")))

    def test_chain_corruption_without_backup_does_not_silently_reset_chain(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            storage = Storage(temp_dir)
            (Path(temp_dir) / "chain.json").write_text("{bad json", encoding="utf-8")

            restored = storage.load_chain()

            self.assertIsNone(restored)
            self.assertTrue(storage.chain_write_protected)
            with self.assertRaises(Exception):
                storage.save_chain(Blockchain())

    def test_semantically_invalid_chain_restores_independently_validated_backup(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            storage = Storage(temp_dir)
            blockchain = Blockchain()
            blockchain.mine_pending_transactions("miner")
            storage.save_chain(blockchain)

            chain_file = Path(temp_dir) / "chain.json"
            backup_file = Path(temp_dir) / "chain.json.bak"
            backup_file.write_text(chain_file.read_text(encoding="utf-8"), encoding="utf-8")
            invalid_data = json.loads(chain_file.read_text(encoding="utf-8"))
            invalid_data["chain"][1]["hash"] = "invalid"
            chain_file.write_text(json.dumps(invalid_data), encoding="utf-8")

            restored = storage.load_chain()

            self.assertIsNotNone(restored)
            self.assertTrue(restored.is_chain_valid())
            self.assertFalse(storage.chain_write_protected)
            self.assertTrue(list(Path(temp_dir).glob("chain.json.invalid.*")))

    def test_semantically_invalid_chain_rejects_invalid_backup(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            storage = Storage(temp_dir)
            blockchain = Blockchain()
            blockchain.mine_pending_transactions("miner")
            storage.save_chain(blockchain)

            chain_file = Path(temp_dir) / "chain.json"
            invalid_data = json.loads(chain_file.read_text(encoding="utf-8"))
            invalid_data["chain"][1]["hash"] = "invalid"
            chain_file.write_text(json.dumps(invalid_data), encoding="utf-8")
            (Path(temp_dir) / "chain.json.bak").write_text(json.dumps(invalid_data), encoding="utf-8")

            with self.assertRaises(ValueError):
                storage.load_chain()

            self.assertTrue(storage.chain_write_protected)

    def test_file_locking_prevents_concurrent_write_corruption(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            storage = Storage(temp_dir)

            def write_peer(index):
                storage.save_peers({f"http://node-{index}"})

            threads = [threading.Thread(target=write_peer, args=(index,)) for index in range(12)]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join()

            data = json.loads((Path(temp_dir) / "peers.json").read_text(encoding="utf-8"))
            self.assertIsInstance(data, list)
            self.assertEqual(len(data), 1)

    def test_storage_health_reports_valid_and_corrupt_files(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            storage = Storage(temp_dir)
            storage.save_peers({"http://node"})
            (Path(temp_dir) / "forum.json").write_text("{bad json", encoding="utf-8")

            health = storage.storage_health()
            by_name = {item["file_name"]: item for item in health["files"]}

            self.assertEqual(by_name["peers.json"]["status"], "ok")
            self.assertEqual(by_name["forum.json"]["status"], "warning")
            self.assertGreaterEqual(health["warnings_count"], 1)

    def test_old_saved_data_compatibility_still_works(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            storage = Storage(temp_dir)
            (Path(temp_dir) / "governance.json").write_text(
                json.dumps({"proposals": {"p1": {"status": "active"}}}),
                encoding="utf-8",
            )

            governance = storage.load_governance()

            self.assertIn("p1", governance.proposals)


if __name__ == "__main__":
    unittest.main()
