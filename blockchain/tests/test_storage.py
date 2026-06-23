import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from blockchain import Blockchain
from lending import LendingPool
from storage import Storage, StorageCorruptionError
from transaction import SYSTEM_ADDRESS, Transaction


def _mine_fast(blockchain, miner, count):
    """Mine `count` blocks quickly: pin difficulty to 1 (auto-adjust resets each
    block) and bypass block spacing so a tight loop is allowed."""
    saved_min = Blockchain.BLOCK_TIME_MINIMUM
    saved_gap = Blockchain.SAME_MINER_MIN_GAP
    Blockchain.BLOCK_TIME_MINIMUM = 0
    Blockchain.SAME_MINER_MIN_GAP = 0
    try:
        for _ in range(count):
            blockchain.difficulty = 1
            blockchain.proof_target = "0"
            blockchain.mine_pending_transactions(miner)
    finally:
        Blockchain.BLOCK_TIME_MINIMUM = saved_min
        Blockchain.SAME_MINER_MIN_GAP = saved_gap


class AppendOnlyPersistenceTests(unittest.TestCase):
    def test_append_log_recovers_from_a_crash_mid_append(self):
        # Append 50 blocks to the log (no snapshot in between), simulate a crash
        # mid-append by truncating the log mid-line, and confirm the chain reloads
        # cleanly from the last valid entry.
        with tempfile.TemporaryDirectory() as temp_dir:
            storage = Storage(temp_dir)
            storage.snapshot_block_interval = 10_000  # no snapshot during the run
            storage.snapshot_time_seconds = 10_000
            blockchain = Blockchain()
            storage.save_chain(blockchain)  # genesis snapshot; resets the log

            saved_min, saved_gap = Blockchain.BLOCK_TIME_MINIMUM, Blockchain.SAME_MINER_MIN_GAP
            Blockchain.BLOCK_TIME_MINIMUM = 0
            Blockchain.SAME_MINER_MIN_GAP = 0
            try:
                for _ in range(50):
                    blockchain.difficulty = 1
                    blockchain.proof_target = "0"
                    blockchain.mine_pending_transactions("miner")
                    snapshotted = storage.persist_new_block(blockchain)
                    self.assertFalse(snapshotted)  # interval is huge → append only
            finally:
                Blockchain.BLOCK_TIME_MINIMUM = saved_min
                Blockchain.SAME_MINER_MIN_GAP = saved_gap

            log_lines = storage.blocks_log_file.read_text(encoding="utf-8").splitlines()
            self.assertEqual(len(log_lines), 50)

            # Simulate a crash mid-append: a partial, unterminated final line.
            with storage.blocks_log_file.open("a", encoding="utf-8") as handle:
                handle.write('{"index": 51, "timestamp": 1234567890.0, "transac')

            restored = Storage(temp_dir).load_chain()
            self.assertIsNotNone(restored)
            # genesis (from snapshot) + 50 valid log blocks; the partial 51st skipped
            self.assertEqual(len(restored.chain), 51)
            self.assertEqual(restored.chain[-1].index, 50)
            self.assertTrue(restored.is_chain_valid(enforce_block_spacing=False))

    def test_loads_from_legacy_chain_json_with_no_log(self):
        # A node upgrading from the old format has chain.json and NO blocks.log.
        with tempfile.TemporaryDirectory() as temp_dir:
            storage = Storage(temp_dir)
            blockchain = Blockchain()
            _mine_fast(blockchain, "miner", 3)
            storage.save_chain(blockchain)
            # Remove the log entirely to look exactly like a pre-upgrade node.
            if storage.blocks_log_file.exists():
                storage.blocks_log_file.unlink()
            self.assertFalse(storage.blocks_log_file.exists())

            restored = Storage(temp_dir).load_chain()
            self.assertIsNotNone(restored)
            self.assertEqual(len(restored.chain), 4)  # genesis + 3
            self.assertTrue(restored.is_chain_valid(enforce_block_spacing=False))

    def test_snapshot_resets_log_and_chain_survives_restart(self):
        # With a small interval, a snapshot is written mid-run; the log is reset
        # and the full chain still reloads correctly across a restart.
        with tempfile.TemporaryDirectory() as temp_dir:
            storage = Storage(temp_dir)
            storage.snapshot_block_interval = 5
            storage.snapshot_time_seconds = 10_000
            blockchain = Blockchain()
            storage.save_chain(blockchain)

            saved_min, saved_gap = Blockchain.BLOCK_TIME_MINIMUM, Blockchain.SAME_MINER_MIN_GAP
            Blockchain.BLOCK_TIME_MINIMUM = 0
            Blockchain.SAME_MINER_MIN_GAP = 0
            snapshots = 0
            try:
                for _ in range(12):
                    blockchain.difficulty = 1
                    blockchain.proof_target = "0"
                    blockchain.mine_pending_transactions("miner")
                    if storage.persist_new_block(blockchain):
                        snapshots += 1
            finally:
                Blockchain.BLOCK_TIME_MINIMUM = saved_min
                Blockchain.SAME_MINER_MIN_GAP = saved_gap

            self.assertGreaterEqual(snapshots, 2)  # at least 2 snapshots over 12 blocks
            restored = Storage(temp_dir).load_chain()
            self.assertEqual(len(restored.chain), 13)  # genesis + 12
            self.assertTrue(restored.is_chain_valid(enforce_block_spacing=False))


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

    def test_save_chain_refuses_invalid_in_memory_chain_without_replacing_valid_file(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            storage = Storage(temp_dir)
            blockchain = Blockchain()
            blockchain.mine_pending_transactions("miner")
            storage.save_chain(blockchain)
            saved_payload = (Path(temp_dir) / "chain.json").read_text(encoding="utf-8")

            blockchain.chain[1].previous_hash = "invalid"

            with self.assertRaises(StorageCorruptionError):
                storage.save_chain(blockchain)

            self.assertTrue(storage.chain_write_protected)
            self.assertEqual((Path(temp_dir) / "chain.json").read_text(encoding="utf-8"), saved_payload)

    def test_save_chain_refuses_invalid_serialized_payload(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            storage = Storage(temp_dir)
            blockchain = Blockchain()
            blockchain.mine_pending_transactions("miner")

            original_to_dict = blockchain.chain[1].to_dict

            def invalid_payload():
                payload = original_to_dict()
                payload["hash"] = "invalid"
                return payload

            with patch.object(blockchain.chain[1], "to_dict", side_effect=invalid_payload):
                with self.assertRaises(StorageCorruptionError):
                    storage.save_chain(blockchain)

            self.assertTrue(storage.chain_write_protected)
            self.assertFalse((Path(temp_dir) / "chain.json").exists())

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
