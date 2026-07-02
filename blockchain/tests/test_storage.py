import json
import os
import tempfile
import threading
import time
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

    def test_chain_valid_fast_is_consistent_and_maintained_incrementally(self):
        # After a load the memoised validity is seeded True; every mined block keeps
        # it True in O(1) and it agrees with the full is_chain_valid result.
        with tempfile.TemporaryDirectory() as temp_dir:
            storage = Storage(temp_dir)
            blockchain = Blockchain()
            storage.save_chain(blockchain)
            loaded = Storage(temp_dir).load_chain()
            self.assertTrue(loaded.chain_valid_fast())  # seeded True on load
            before_height = loaded.get_block_height()
            _mine_fast(loaded, "miner", 5)
            # Tip advanced; fast check still True and matches the authoritative one.
            self.assertGreater(loaded.get_block_height(), before_height)
            self.assertTrue(loaded.chain_valid_fast())
            self.assertEqual(loaded.chain_valid_fast(), loaded.is_chain_valid(enforce_block_spacing=False))

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


class FileLockStaleBreakTests(unittest.TestCase):
    """A lock left by a hard-killed holder must not wedge persistence forever.

    This is the durability bug that stalled production mining: an orphaned
    *.lock file made every subsequent acquisition time out, so the node mined in
    memory but could never persist, and a restart lost the unpersisted blocks.
    The lock now breaks a provably-stale orphan and proceeds.
    """

    def _lock_path(self, storage, name="chain.json"):
        return (storage.data_dir / name).with_suffix(".json.lock")

    def test_stale_lock_with_dead_holder_is_broken(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            storage = Storage(temp_dir)
            target = storage.data_dir / "chain.json"
            lock_path = self._lock_path(storage)
            lock_path.write_text("424242", encoding="ascii")  # a dead pid

            # With the holder reported dead, the lock is broken and acquired
            # quickly rather than timing out.
            with patch.object(Storage, "_pid_is_alive", staticmethod(lambda pid: False)):
                start = time.monotonic()
                with storage._file_lock(target, timeout=5.0):
                    elapsed = time.monotonic() - start
                    self.assertTrue(lock_path.exists())  # our own lock is held
            self.assertLess(elapsed, 2.0)
            self.assertFalse(lock_path.exists())  # released cleanly

    def test_live_lock_is_not_broken(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            storage = Storage(temp_dir)
            target = storage.data_dir / "chain.json"
            lock_path = self._lock_path(storage)
            lock_path.write_text("424242", encoding="ascii")

            # With the holder reported alive, the lock is respected and the wait
            # times out instead of preempting a live writer.
            with patch.object(Storage, "_pid_is_alive", staticmethod(lambda pid: True)):
                with self.assertRaises(TimeoutError):
                    with storage._file_lock(target, timeout=0.3):
                        pass
            self.assertTrue(lock_path.exists())  # the other holder's lock survives

    def test_empty_orphan_lock_is_broken_after_grace_period(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            storage = Storage(temp_dir)
            target = storage.data_dir / "chain.json"
            lock_path = self._lock_path(storage)
            lock_path.write_text("", encoding="ascii")  # empty: died before pid write
            old = time.time() - 120
            os.utime(lock_path, (old, old))  # sat untouched well past the grace period

            with storage._file_lock(target, timeout=5.0):
                self.assertTrue(lock_path.exists())
            self.assertFalse(lock_path.exists())


class LedgerRoundTripTests(unittest.TestCase):
    """Every ledger's save/load pair must round-trip real data from disk, and a
    structurally wrong file must be refused with a clear error rather than
    silently loading an empty or corrupted ledger."""

    def setUp(self):
        self._temp = tempfile.TemporaryDirectory()
        self.addCleanup(self._temp.cleanup)
        self.storage = Storage(self._temp.name)

    def test_every_ledger_round_trips_saved_data(self):
        from achievements import Achievements
        from exchange import Exchange
        from faucet import Faucet
        from forum import Forum
        from governance import Governance
        from notifications import Notifications
        from price import PriceDiscovery
        from profiles import Profiles
        from registry import NodeRegistry
        from treasury import Treasury

        exchange = Exchange()
        exchange.offers = {"offer-1": {"creator_address": "VLQa", "status": "open", "amount": 5}}
        forum = Forum()
        forum.posts = {"post-1": {"title": "Hello", "replies": []}}
        governance = Governance()
        governance.proposals = {"prop-1": {"title": "Raise quorum", "status": "active"}}
        governance.rule_changes = [{"rule_change_id": "rc-1"}]
        treasury = Treasury()
        treasury.proposals = {"tp-1": {"amount": 10, "status": "active"}}
        faucet = Faucet()
        faucet.claims = {"claim-1": {"wallet_address": "VLQa", "status": "pending"}}
        price = PriceDiscovery()
        profiles = Profiles()
        profiles.profiles = {"VLQa": {"display_name": "Member A"}}
        achievements = Achievements()
        achievements.earned = {"VLQa": {"first_wallet": {"earned_at": 1.0}}}
        registry = NodeRegistry()
        registry.registered_nodes = {"https://node.example.org": {"display_name": "Node"}}
        notifications = Notifications()
        notifications.set_preferences("VLQa", email="member@example.org", events={"vlq_received": True})
        notifications.queue = [{"id": "q1", "status": "queued", "email": "member@example.org"}]

        cases = [
            ("exchange", exchange, self.storage.save_exchange, self.storage.load_exchange, "offers"),
            ("forum", forum, self.storage.save_forum, self.storage.load_forum, "posts"),
            ("governance", governance, self.storage.save_governance, self.storage.load_governance, "proposals"),
            ("treasury", treasury, self.storage.save_treasury, self.storage.load_treasury, "proposals"),
            ("faucet", faucet, self.storage.save_faucet, self.storage.load_faucet, "claims"),
            ("price", price, self.storage.save_price_discovery, self.storage.load_price_discovery, "signals"),
            ("profiles", profiles, self.storage.save_profiles, self.storage.load_profiles, "profiles"),
            ("achievements", achievements, self.storage.save_achievements, self.storage.load_achievements, "earned"),
            ("registry", registry, self.storage.save_registry, self.storage.load_registry, "registered_nodes"),
        ]
        for name, ledger, save, load, attr in cases:
            with self.subTest(ledger=name):
                save(ledger)
                loaded = load()
                self.assertEqual(getattr(loaded, attr), getattr(ledger, attr))

        # Notifications keep both halves and re-filter event toggles on load.
        self.storage.save_notifications(notifications)
        loaded = self.storage.load_notifications()
        self.assertEqual(loaded.preferences["VLQa"]["email"], "member@example.org")
        self.assertTrue(loaded.preferences["VLQa"]["events"]["vlq_received"])
        self.assertEqual(loaded.queue[0]["id"], "q1")
        # Governance rule changes ride along with proposals.
        self.assertEqual(self.storage.load_governance().rule_changes, [{"rule_change_id": "rc-1"}])
        # Peers round-trip as a set through a sorted list on disk.
        self.storage.save_peers({"https://b.example.org", "https://a.example.org"})
        self.assertEqual(self.storage.load_peers(), {"https://a.example.org", "https://b.example.org"})

    def test_structurally_wrong_ledger_files_are_refused(self):
        cases = [
            (self.storage.exchange_file, {"offers": []}, self.storage.load_exchange),
            (self.storage.forum_file, {"posts": []}, self.storage.load_forum),
            (self.storage.governance_file, {"proposals": []}, self.storage.load_governance),
            (self.storage.treasury_file, {"proposals": []}, self.storage.load_treasury),
            (self.storage.faucet_file, {"claims": []}, self.storage.load_faucet),
            (self.storage.price_file, {"signals": []}, self.storage.load_price_discovery),
            (self.storage.profiles_file, {"profiles": []}, self.storage.load_profiles),
            (self.storage.achievements_file, {"earned": []}, self.storage.load_achievements),
            (self.storage.registry_file, {"registered_nodes": []}, self.storage.load_registry),
            (self.storage.peers_file, {"not": "a list"}, self.storage.load_peers),
        ]
        for path, wrong_payload, load in cases:
            with self.subTest(file=path.name):
                path.write_text(json.dumps(wrong_payload), encoding="utf-8")
                with self.assertRaises(ValueError):
                    load()


class AuthorityNonceTests(unittest.TestCase):
    def setUp(self):
        self._temp = tempfile.TemporaryDirectory()
        self.addCleanup(self._temp.cleanup)
        self.storage = Storage(self._temp.name)

    def test_a_nonce_is_consumed_once_and_replay_is_refused(self):
        self.assertTrue(self.storage.consume_authority_nonce("n1", expires_at=1_000, now=100))
        self.assertFalse(self.storage.consume_authority_nonce("n1", expires_at=1_000, now=200))

    def test_expired_nonces_are_pruned_and_reusable(self):
        self.assertTrue(self.storage.consume_authority_nonce("n1", expires_at=150, now=100))
        # Past its expiry the old entry is dropped, so the same key is fresh again.
        self.assertTrue(self.storage.consume_authority_nonce("n1", expires_at=400, now=200))

    def test_a_corrupt_nonce_registry_refuses_authority_writes(self):
        self.storage.authority_nonces_file.write_text("not json", encoding="utf-8")
        with self.assertRaises(StorageCorruptionError):
            self.storage.consume_authority_nonce("n1", expires_at=1_000, now=100)
        self.storage.authority_nonces_file.write_text(json.dumps(["a", "list"]), encoding="utf-8")
        with self.assertRaises(StorageCorruptionError):
            self.storage.consume_authority_nonce("n1", expires_at=1_000, now=100)


class LockStalenessTests(unittest.TestCase):
    def setUp(self):
        self._temp = tempfile.TemporaryDirectory()
        self.addCleanup(self._temp.cleanup)
        self.storage = Storage(self._temp.name)
        self.lock_path = Path(self._temp.name) / "some.json.lock"

    def test_our_own_lock_is_never_stale(self):
        self.lock_path.write_text(str(os.getpid()), encoding="ascii")
        self.assertFalse(self.storage._lock_is_stale(self.lock_path))

    def test_a_dead_holders_lock_is_stale(self):
        self.lock_path.write_text("12345", encoding="ascii")
        with patch.object(Storage, "_pid_is_alive", return_value=False):
            self.assertTrue(self.storage._lock_is_stale(self.lock_path))

    def test_a_live_holders_lock_is_respected(self):
        self.lock_path.write_text("12345", encoding="ascii")
        with patch.object(Storage, "_pid_is_alive", return_value=True):
            self.assertFalse(self.storage._lock_is_stale(self.lock_path))

    def test_a_garbage_lock_is_only_broken_after_the_grace_period(self):
        self.lock_path.write_text("not-a-pid", encoding="ascii")
        self.assertFalse(self.storage._lock_is_stale(self.lock_path))  # fresh: respected
        old = time.time() - 60
        os.utime(self.lock_path, (old, old))
        self.assertTrue(self.storage._lock_is_stale(self.lock_path))  # abandoned: broken

    def test_a_missing_lock_file_is_not_stale(self):
        self.assertFalse(self.storage._lock_is_stale(self.lock_path))

    def test_pid_liveness_basics(self):
        self.assertTrue(Storage._pid_is_alive(os.getpid()))
        self.assertFalse(Storage._pid_is_alive(0))
        self.assertFalse(Storage._pid_is_alive(-5))


if __name__ == "__main__":
    unittest.main()
