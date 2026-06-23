from __future__ import annotations

import os
import json
import shutil
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from achievements import Achievements
from block import Block
from blockchain import Blockchain
from exchange import Exchange
from faucet import Faucet
from forum import Forum
from governance import Governance
from lending import LendingPool
from logger import vorliq_logger
from notifications import EVENT_TYPES, Notifications
from price import PriceDiscovery
from profiles import Profiles
from registry import NodeRegistry
from transaction import Transaction
from treasury import Treasury


CRITICAL_JSON_FILES = [
    "chain.json",
    "indexes.json",
    "pending.json",
    "peers.json",
    "registry.json",
    "lending.json",
    "exchange.json",
    "governance.json",
    "treasury.json",
    "price.json",
    "forum.json",
    "achievements.json",
    "profiles.json",
    "faucet.json",
]


class StorageCorruptionError(RuntimeError):
    pass


class Storage:
    def __init__(self, data_dir: str | Path | None = None) -> None:
        self.data_dir = Path(data_dir) if data_dir else Path(__file__).resolve().parent / "data"
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.chain_file = self.data_dir / "chain.json"
        self.indexes_file = self.data_dir / "indexes.json"
        self.pending_file = self.data_dir / "pending.json"
        self.lending_file = self.data_dir / "lending.json"
        self.exchange_file = self.data_dir / "exchange.json"
        self.forum_file = self.data_dir / "forum.json"
        self.governance_file = self.data_dir / "governance.json"
        self.treasury_file = self.data_dir / "treasury.json"
        self.faucet_file = self.data_dir / "faucet.json"
        self.price_file = self.data_dir / "price.json"
        self.profiles_file = self.data_dir / "profiles.json"
        self.achievements_file = self.data_dir / "achievements.json"
        self.peers_file = self.data_dir / "peers.json"
        self.registry_file = self.data_dir / "registry.json"
        self.authority_nonces_file = self.data_dir / "authority_nonces.json"
        self.notifications_file = self.data_dir / "notifications.json"
        self.chain_storage_error: str | None = None
        self.chain_write_protected = False
        # Append-only persistence: every confirmed block is appended as one JSON
        # line here (a fixed-cost write), and the full chain.json is written only
        # as a periodic snapshot. chain.json is the recovery baseline; this log
        # holds the blocks mined since the last snapshot.
        self.blocks_log_file = self.data_dir / "blocks.log"
        self.snapshot_block_interval = int(os.environ.get("VORLIQ_SNAPSHOT_BLOCK_INTERVAL", "100"))
        self.snapshot_time_seconds = float(os.environ.get("VORLIQ_SNAPSHOT_TIME_SECONDS", str(10 * 60)))
        self._last_snapshot_height = -1
        self._last_snapshot_time = 0.0

    def append_block(self, block: Any) -> None:
        """Append one block to the blocks log as a single JSON line, fsynced. This
        is the hot path on block confirmation: it is O(1) in the chain length, so
        it costs the same whether the chain has 50 blocks or 50,000. A crash mid
        write can leave at most a partial trailing line, which load_chain skips."""
        block_dict = block.to_dict() if hasattr(block, "to_dict") else dict(block)
        line = json.dumps(block_dict, sort_keys=True, separators=(",", ":"))
        self.blocks_log_file.parent.mkdir(parents=True, exist_ok=True)
        with self._file_lock(self.blocks_log_file):
            with self.blocks_log_file.open("a", encoding="utf-8") as handle:
                handle.write(line + "\n")
                handle.flush()
                os.fsync(handle.fileno())

    def _should_snapshot(self, blockchain: Blockchain) -> bool:
        # Snapshot every N blocks or every T seconds, whichever comes first. A
        # negative last-height means no snapshot has been taken this session yet.
        if self._last_snapshot_height < 0:
            return True
        height = blockchain.get_block_height()
        if height - self._last_snapshot_height >= self.snapshot_block_interval:
            return True
        if time.time() - self._last_snapshot_time >= self.snapshot_time_seconds:
            return True
        return False

    def persist_new_block(self, blockchain: Blockchain) -> bool:
        """Persist a newly confirmed block: append it to the log, and write a full
        chain.json snapshot when one is due. Returns True iff a snapshot was
        written, so callers can persist derived state (indexes) only on snapshots
        rather than on every block."""
        self.append_block(blockchain.get_latest_block())
        if self._should_snapshot(blockchain):
            self.save_chain(blockchain)
            return True
        return False

    def _truncate_blocks_log(self) -> None:
        # After a full snapshot, the log's blocks are all captured in chain.json,
        # so reset it. Done as an atomic replace with an empty file; even if it is
        # interrupted, load_chain only replays log blocks with an index beyond the
        # snapshot, so stale entries are ignored.
        try:
            if not self.blocks_log_file.exists():
                return
            tmp_path = self.blocks_log_file.with_name(
                f".{self.blocks_log_file.name}.{os.getpid()}.{int(time.time() * 1000)}.tmp"
            )
            tmp_path.write_text("", encoding="utf-8")
            self._atomic_replace(tmp_path, self.blocks_log_file)
            self._fsync_directory(self.blocks_log_file.parent)
        except Exception as error:  # noqa: BLE001 - never let log reset break a snapshot
            vorliq_logger.warning("Could not reset blocks log after snapshot: %s", error)

    def save_chain(self, blockchain: Blockchain) -> None:
        if self.chain_write_protected:
            raise StorageCorruptionError(
                "chain.json is corrupt and no valid backup was available; refusing to overwrite chain state"
            )
        # Persistence guards against structural corruption (bad hashes, broken
        # links, invalid PoW or ledger), not against the spacing of historical
        # blocks — that is admission policy, already enforced when each block was
        # mined, and re-checking it here would refuse to save a perfectly intact
        # chain whenever the spacing parameter changed.
        if not blockchain.is_chain_valid(enforce_block_spacing=False):
            self.chain_write_protected = True
            self.chain_storage_error = "refusing to save a blockchain that failed structural chain validation"
            vorliq_logger.critical(self.chain_storage_error)
            raise StorageCorruptionError(self.chain_storage_error)
        chain_data = {
            "coin": "VLQ",
            "difficulty": blockchain.difficulty,
            "mining_reward": getattr(blockchain, "mining_reward", blockchain.initial_mining_reward),
            "initial_mining_reward": blockchain.initial_mining_reward,
            "maximum_supply": blockchain.maximum_supply,
            "halving_interval": blockchain.halving_interval,
            "chain": [block.to_dict() for block in blockchain.chain],
        }
        serialized_blockchain = self._blockchain_from_chain_data(chain_data)
        if serialized_blockchain is None or not serialized_blockchain.is_chain_valid(enforce_block_spacing=False):
            self.chain_write_protected = True
            self.chain_storage_error = "refusing to save serialized blockchain payload that failed structural chain validation"
            vorliq_logger.critical(self.chain_storage_error)
            raise StorageCorruptionError(self.chain_storage_error)
        self._write_json(self.chain_file, chain_data)
        # A full chain.json write IS the snapshot/recovery point: the append log is
        # now redundant, so reset it and remember when/where we snapshotted.
        self._truncate_blocks_log()
        self._last_snapshot_height = blockchain.get_block_height()
        self._last_snapshot_time = time.time()
        vorliq_logger.info("Saved blockchain snapshot to disk with %s blocks", len(blockchain.chain))

    def load_chain(self) -> Blockchain | None:
        # Load the snapshot baseline (chain.json) if present, then replay any
        # blocks appended to the log since the snapshot. A node upgrading from the
        # old format has chain.json and no log: it simply loads the snapshot, which
        # keeps the migration fully backward compatible. A node with no chain.json
        # but a log (unusual) replays from genesis.
        snapshot_blockchain: Blockchain | None = None
        snapshot_count = 0
        if self.chain_file.exists():
            data = self._read_json(self.chain_file, default=None, critical_chain=True)
            if data is None:
                self.chain_write_protected = True
                self.chain_storage_error = "chain.json is corrupt and no valid backup is available"
                vorliq_logger.critical(self.chain_storage_error)
                return None
            snapshot_blockchain = self._blockchain_from_chain_data(data)
            if snapshot_blockchain is not None:
                snapshot_count = len(snapshot_blockchain.chain)

        log_count, skipped = 0, 0
        blockchain = snapshot_blockchain
        if self.blocks_log_file.exists():
            if blockchain is None:
                # No snapshot: rebuild from a fresh genesis chain and the log.
                blockchain = Blockchain()
            max_index = blockchain.chain[-1].index if blockchain.chain else -1
            try:
                with self.blocks_log_file.open("r", encoding="utf-8") as handle:
                    for lineno, raw in enumerate(handle, start=1):
                        line = raw.strip()
                        if not line:
                            continue
                        block = self._parse_log_block(line, lineno)
                        if block is None:
                            skipped += 1
                            continue
                        if block.index <= max_index:
                            continue  # already in the snapshot — ignore duplicates
                        if block.index != max_index + 1:
                            skipped += 1
                            vorliq_logger.warning(
                                "Skipping out-of-sequence block in log line %s (index %s, expected %s)",
                                lineno, block.index, max_index + 1,
                            )
                            continue
                        if blockchain.chain and block.previous_hash != blockchain.chain[-1].hash:
                            skipped += 1
                            vorliq_logger.warning("Skipping block in log line %s with a broken link (index %s)", lineno, block.index)
                            continue
                        blockchain.chain.append(block)
                        max_index = block.index
                        log_count += 1
            except Exception as error:  # noqa: BLE001 - a bad log must not crash startup
                vorliq_logger.warning("Stopped replaying blocks log after an error: %s", error)

        if blockchain is None:
            vorliq_logger.info("No saved blockchain found on disk")
            return None

        # Reloading our own persisted chain: accept it on structural integrity
        # alone (spacing is grandfathered). If the snapshot-plus-log chain fails,
        # fall back to the snapshot alone (dropping a bad tail), then to the backup
        # — and if none is valid, _restore_valid_chain_backup refuses to start.
        if not blockchain.is_chain_valid(enforce_block_spacing=False):
            if snapshot_blockchain is not None and snapshot_blockchain.is_chain_valid(enforce_block_spacing=False):
                vorliq_logger.warning("Replayed chain failed validation; falling back to the snapshot alone.")
                blockchain = snapshot_blockchain
                log_count = 0
            else:
                blockchain = self._restore_valid_chain_backup()
                snapshot_count = len(blockchain.chain)
                log_count = 0

        self._last_snapshot_height = blockchain.get_block_height()
        self._last_snapshot_time = time.time()
        vorliq_logger.info(
            "Loaded blockchain: %s block(s) from snapshot, %s from the append log (%s log line(s) skipped); height %s",
            snapshot_count, log_count, skipped, blockchain.get_block_height(),
        )
        return blockchain

    def _parse_log_block(self, line: str, lineno: int) -> Block | None:
        """Parse one blocks-log line into a Block, or None if it is unparseable or
        not a valid block dict (e.g. a partial trailing line left by a crash)."""
        try:
            parsed = json.loads(line)
        except Exception as error:  # noqa: BLE001
            vorliq_logger.warning("Skipping unparseable block log line %s: %s", lineno, error)
            return None
        try:
            block = self._block_from_dict(parsed)
        except Exception as error:  # noqa: BLE001
            vorliq_logger.warning("Skipping invalid block in log line %s: %s", lineno, error)
            return None
        return block

    def _blockchain_from_chain_data(self, data: dict[str, Any]) -> Blockchain | None:
        blocks = [self._block_from_dict(block_data) for block_data in data.get("chain", [])]
        if not blocks:
            return None

        blockchain = Blockchain()
        blockchain.chain = blocks
        blockchain.difficulty = int(data.get("difficulty", blockchain.difficulty))
        blockchain.proof_target = "0" * blockchain.difficulty
        saved_reward = float(
            data.get("mining_reward", data.get("initial_mining_reward", blockchain.initial_mining_reward))
        )
        blockchain.mining_reward = saved_reward
        blockchain.initial_mining_reward = saved_reward
        return blockchain

    def _restore_valid_chain_backup(self) -> Blockchain:
        backup_path = self.chain_file.with_suffix(self.chain_file.suffix + ".bak")
        try:
            backup_data = json.loads(backup_path.read_text(encoding="utf-8"))
            backup_blockchain = self._blockchain_from_chain_data(backup_data)
            if backup_blockchain is None or not backup_blockchain.is_chain_valid(enforce_block_spacing=False):
                raise ValueError("backup chain failed validation")

            invalid_path = self.chain_file.with_suffix(self.chain_file.suffix + f".invalid.{int(time.time())}")
            shutil.copy2(self.chain_file, invalid_path)
            self._write_json(self.chain_file, backup_data, create_backup=False)
            self.chain_write_protected = False
            self.chain_storage_error = None
            vorliq_logger.warning("Restored invalid chain.json from independently validated chain.json.bak")
            return backup_blockchain
        except Exception as backup_error:
            self.chain_write_protected = True
            self.chain_storage_error = "chain.json loaded but failed chain validation and no valid backup is available"
            vorliq_logger.critical(self.chain_storage_error)
            raise ValueError("saved blockchain data is not valid") from backup_error

    def save_indexes(self, indexes: Any) -> None:
        payload = indexes.to_payload() if hasattr(indexes, "to_payload") else indexes
        self._write_json(self.indexes_file, payload)
        vorliq_logger.info(
            "Saved blockchain indexes for height %s",
            payload.get("chain_height") if isinstance(payload, dict) else "unknown",
        )

    def load_indexes(self, blockchain: Blockchain) -> Any | None:
        if not self.indexes_file.exists():
            vorliq_logger.info("No saved blockchain indexes found on disk")
            return None

        data = self._read_json(self.indexes_file, default=None)
        if data is None:
            vorliq_logger.warning("Blockchain indexes could not be read and will be rebuilt")
            return None

        try:
            from indexes import BlockchainIndexes

            indexes = BlockchainIndexes.from_payload(data, blockchain)
            vorliq_logger.info("Loaded blockchain indexes for height %s", indexes.chain_height)
            return indexes
        except Exception as error:
            vorliq_logger.warning("Saved blockchain indexes are invalid and will be rebuilt: %s", error)
            return None

    def save_pending(self, pending_transactions: list[Any]) -> None:
        pending_data = [self._transaction_to_dict(transaction) for transaction in pending_transactions]
        self._write_json(self.pending_file, pending_data)
        vorliq_logger.info("Saved %s pending transactions to disk", len(pending_data))

    def load_pending(self) -> list[dict[str, Any]]:
        if not self.pending_file.exists():
            vorliq_logger.info("No saved pending transactions found on disk")
            return []

        data = self._read_json(self.pending_file, default=[])
        if not isinstance(data, list):
            raise ValueError("pending transaction data must be a list")

        pending = [self._transaction_to_dict(transaction) for transaction in data]
        vorliq_logger.info("Loaded %s pending transactions from disk", len(pending))
        return pending

    def save_lending_pool(self, lending_pool: LendingPool) -> None:
        lending_data = {
            "loan_requests": lending_pool.loan_requests,
        }
        self._write_json(self.lending_file, lending_data)
        vorliq_logger.info("Saved lending pool with %s loan records", len(lending_pool.loan_requests))

    def load_lending_pool(self) -> LendingPool:
        lending_pool = LendingPool()

        if not self.lending_file.exists():
            vorliq_logger.info("No saved lending pool found on disk")
            return lending_pool

        data = self._read_json(self.lending_file, default={"loan_requests": {}})
        loan_requests = data.get("loan_requests", {})

        if not isinstance(loan_requests, dict):
            raise ValueError("lending pool data must contain a loan_requests object")

        lending_pool.loan_requests = loan_requests
        vorliq_logger.info("Loaded lending pool with %s loan records", len(loan_requests))
        return lending_pool

    def save_exchange(self, exchange: Exchange) -> None:
        self._write_json(self.exchange_file, {"offers": exchange.offers})
        vorliq_logger.info("Saved exchange with %s offer records", len(exchange.offers))

    def save_notifications(self, notifications: Notifications) -> None:
        # Email preferences are durable; the queue is persisted too so opted-in
        # mail isn't lost across a restart. No provider credentials are ever
        # written here — only the recipient's own saved address and toggles.
        self._write_json(
            self.notifications_file,
            {"preferences": notifications.preferences, "queue": notifications.queue[-1000:]},
            create_backup=False,
        )

    def load_notifications(self) -> Notifications:
        notifications = Notifications()
        if not self.notifications_file.exists():
            return notifications
        data = self._read_json(self.notifications_file, default={"preferences": {}, "queue": []})
        preferences = data.get("preferences", {})
        if isinstance(preferences, dict):
            # Defensively keep only the recognised event toggles.
            for wallet, entry in preferences.items():
                if not isinstance(entry, dict):
                    continue
                entry["events"] = {event: bool(entry.get("events", {}).get(event, False)) for event in EVENT_TYPES}
            notifications.preferences = preferences
        queue = data.get("queue", [])
        if isinstance(queue, list):
            notifications.queue = queue
        vorliq_logger.info("Loaded notification preferences for %s members", len(notifications.preferences))
        return notifications

    def load_exchange(self) -> Exchange:
        exchange = Exchange()

        if not self.exchange_file.exists():
            vorliq_logger.info("No saved exchange found on disk")
            return exchange

        data = self._read_json(self.exchange_file, default={"offers": {}})
        offers = data.get("offers", {})

        if not isinstance(offers, dict):
            raise ValueError("exchange data must contain an offers object")

        exchange.offers = offers
        vorliq_logger.info("Loaded exchange with %s offer records", len(offers))
        return exchange

    def save_forum(self, forum: Forum) -> None:
        self._write_json(self.forum_file, {"posts": forum.posts})
        vorliq_logger.info("Saved forum with %s post records", len(forum.posts))

    def load_forum(self) -> Forum:
        forum = Forum()

        if not self.forum_file.exists():
            vorliq_logger.info("No saved forum found on disk")
            return forum

        data = self._read_json(self.forum_file, default={"posts": {}})
        posts = data.get("posts", {})

        if not isinstance(posts, dict):
            raise ValueError("forum data must contain a posts object")

        forum.posts = posts
        vorliq_logger.info("Loaded forum with %s post records", len(posts))
        return forum

    def save_governance(self, governance: Governance) -> None:
        self._write_json(
            self.governance_file,
            {
                "proposals": governance.proposals,
                "governance_settings": governance.governance_settings,
                "rule_changes": governance.rule_changes,
            },
        )
        vorliq_logger.info("Saved governance with %s proposal records", len(governance.proposals))

    def load_governance(self) -> Governance:
        governance = Governance()

        if not self.governance_file.exists():
            vorliq_logger.info("No saved governance found on disk")
            return governance

        data = self._read_json(self.governance_file, default={"proposals": {}, "governance_settings": {}, "rule_changes": []})
        proposals = data.get("proposals", {})
        settings = data.get("governance_settings", {})
        rule_changes = data.get("rule_changes", [])

        if not isinstance(proposals, dict):
            raise ValueError("governance data must contain a proposals object")
        if settings and not isinstance(settings, dict):
            raise ValueError("governance settings data must be an object")
        if rule_changes and not isinstance(rule_changes, list):
            raise ValueError("governance rule change data must be a list")

        governance.proposals = proposals
        governance.governance_settings.update(settings)
        governance.rule_changes = rule_changes
        vorliq_logger.info("Loaded governance with %s proposal records", len(proposals))
        return governance

    def save_treasury(self, treasury: Treasury) -> None:
        self._write_json(self.treasury_file, {"proposals": treasury.proposals})
        vorliq_logger.info("Saved treasury with %s proposal records", len(treasury.proposals))

    def load_treasury(self) -> Treasury:
        treasury = Treasury()
        if not self.treasury_file.exists():
            vorliq_logger.info("No saved treasury found on disk")
            return treasury

        data = self._read_json(self.treasury_file, default={"proposals": {}})
        proposals = data.get("proposals", {})
        if not isinstance(proposals, dict):
            raise ValueError("treasury data must contain a proposals object")
        treasury.proposals = proposals
        vorliq_logger.info("Loaded treasury with %s proposal records", len(proposals))
        return treasury

    def save_faucet(self, faucet: Faucet) -> None:
        self._write_json(self.faucet_file, {"claims": faucet.claims})
        vorliq_logger.info("Saved faucet with %s claim records", len(faucet.claims))

    def load_faucet(self) -> Faucet:
        faucet = Faucet()
        if not self.faucet_file.exists():
            vorliq_logger.info("No saved faucet found on disk")
            return faucet

        data = self._read_json(self.faucet_file, default={"claims": {}})
        claims = data.get("claims", {})
        if not isinstance(claims, dict):
            raise ValueError("faucet data must contain a claims object")
        faucet.claims = claims
        vorliq_logger.info("Loaded faucet with %s claim records", len(claims))
        return faucet

    def save_price_discovery(self, price_discovery: PriceDiscovery) -> None:
        self._write_json(self.price_file, {"signals": price_discovery.signals})
        vorliq_logger.info("Saved price discovery with %s signal records", len(price_discovery.signals))

    def load_price_discovery(self) -> PriceDiscovery:
        price_discovery = PriceDiscovery()
        if not self.price_file.exists():
            vorliq_logger.info("No saved price discovery found on disk")
            return price_discovery

        data = self._read_json(self.price_file, default={"signals": {}})
        signals = data.get("signals", {})
        if not isinstance(signals, dict):
            raise ValueError("price discovery data must contain a signals object")
        price_discovery.signals = signals
        price_discovery.expire_old_signals()
        vorliq_logger.info("Loaded price discovery with %s signal records", len(price_discovery.signals))
        return price_discovery

    def save_profiles(self, profiles: Profiles) -> None:
        self._write_json(self.profiles_file, {"profiles": profiles.profiles})
        vorliq_logger.info("Saved profiles with %s records", len(profiles.profiles))

    def load_profiles(self) -> Profiles:
        profiles = Profiles()
        if not self.profiles_file.exists():
            vorliq_logger.info("No saved profiles found on disk")
            return profiles

        data = self._read_json(self.profiles_file, default={"profiles": {}})
        profile_records = data.get("profiles", {})
        if not isinstance(profile_records, dict):
            raise ValueError("profiles data must contain a profiles object")

        profiles.profiles = profile_records
        vorliq_logger.info("Loaded profiles with %s records", len(profile_records))
        return profiles

    def save_achievements(self, achievements: Achievements) -> None:
        self._write_json(self.achievements_file, {"earned": achievements.earned})
        vorliq_logger.info("Saved achievements for %s wallet records", len(achievements.earned))

    def load_achievements(self) -> Achievements:
        achievements = Achievements()
        if not self.achievements_file.exists():
            vorliq_logger.info("No saved achievements found on disk")
            return achievements

        data = self._read_json(self.achievements_file, default={"earned": {}})
        earned = data.get("earned", {})
        if not isinstance(earned, dict):
            raise ValueError("achievements data must contain an earned object")
        achievements.earned = earned
        vorliq_logger.info("Loaded achievements for %s wallet records", len(earned))
        return achievements

    def save_peers(self, peer_urls: set[str]) -> None:
        self._write_json(self.peers_file, sorted(peer_urls))
        vorliq_logger.info("Saved %s peer records to disk", len(peer_urls))

    def load_peers(self) -> set[str]:
        if not self.peers_file.exists():
            vorliq_logger.info("No saved peer list found on disk")
            return set()

        data = self._read_json(self.peers_file, default=[])
        if not isinstance(data, list):
            raise ValueError("peer data must be a list")

        peers = {str(peer) for peer in data}
        vorliq_logger.info("Loaded %s peer records from disk", len(peers))
        return peers

    def save_registry(self, registry: NodeRegistry) -> None:
        self._write_json(self.registry_file, {"registered_nodes": registry.registered_nodes})
        vorliq_logger.info("Saved node registry with %s records", len(registry.registered_nodes))

    def load_registry(self) -> NodeRegistry:
        registry = NodeRegistry()

        if not self.registry_file.exists():
            vorliq_logger.info("No saved node registry found on disk")
            return registry

        data = self._read_json(self.registry_file, default={"registered_nodes": {}})
        registered_nodes = data.get("registered_nodes", {})

        if not isinstance(registered_nodes, dict):
            raise ValueError("registry data must contain a registered_nodes object")

        registry.registered_nodes = registered_nodes
        vorliq_logger.info("Loaded node registry with %s records", len(registered_nodes))
        return registry

    def consume_authority_nonce(self, nonce_key: str, *, expires_at: int, now: int) -> bool:
        path = self.authority_nonces_file
        tmp_path = path.with_name(f".{path.name}.{os.getpid()}.{int(time.time() * 1000)}.tmp")
        with self._file_lock(path):
            try:
                data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
            except Exception as exc:
                raise StorageCorruptionError("authority nonce registry is invalid; refusing authority writes") from exc
            if not isinstance(data, dict):
                raise StorageCorruptionError("authority nonce registry must be an object")
            active = {key: value for key, value in data.items() if isinstance(value, int) and value > now}
            if nonce_key in active:
                return False
            active[nonce_key] = int(expires_at)
            payload = json.dumps(active, indent=2, sort_keys=True)
            with tmp_path.open("w", encoding="utf-8") as handle:
                handle.write(payload)
                handle.write("\n")
                handle.flush()
                os.fsync(handle.fileno())
            self._atomic_replace(tmp_path, path)
            self._fsync_directory(path.parent)
        return True

    @staticmethod
    def _atomic_replace(tmp_path: Path, path: Path) -> None:
        # os.replace is atomic on POSIX, but on Windows it raises PermissionError
        # (WinError 5/32) if the destination is momentarily held open by a
        # concurrent reader or antivirus. Retry briefly so a transient lock does
        # not surface as a failed write. No effect on POSIX, where it succeeds
        # first try.
        last_error: Exception | None = None
        for attempt in range(10):
            try:
                os.replace(tmp_path, path)
                return
            except PermissionError as exc:  # pragma: no cover - Windows-specific timing
                last_error = exc
                time.sleep(0.05 * (attempt + 1))
        raise last_error  # type: ignore[misc]

    def _write_json(self, path: Path, data: Any, create_backup: bool = True) -> None:
        payload = json.dumps(data, indent=2, sort_keys=True)
        tmp_path = path.with_name(f".{path.name}.{os.getpid()}.{int(time.time() * 1000)}.tmp")
        bak_path = path.with_suffix(path.suffix + ".bak")

        with self._file_lock(path):
            if create_backup and path.exists():
                shutil.copy2(path, bak_path)

            with tmp_path.open("w", encoding="utf-8") as handle:
                handle.write(payload)
                handle.write("\n")
                handle.flush()
                os.fsync(handle.fileno())

            self._atomic_replace(tmp_path, path)
            self._fsync_directory(path.parent)

    def _read_json(self, path: Path, default: Any = None, critical_chain: bool = False) -> Any:
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception as error:
            vorliq_logger.warning("Could not read %s: %s", path.name, error)

        bak_path = path.with_suffix(path.suffix + ".bak")
        if bak_path.exists():
            try:
                data = json.loads(bak_path.read_text(encoding="utf-8"))
                corrupt_path = path.with_suffix(path.suffix + f".corrupt.{int(time.time())}")
                try:
                    path.replace(corrupt_path)
                except OSError as move_error:
                    vorliq_logger.warning("Could not move corrupt %s aside: %s", path.name, move_error)
                self._write_json(path, data, create_backup=False)
                vorliq_logger.warning("Restored %s from valid backup %s", path.name, bak_path.name)
                return data
            except Exception as backup_error:
                vorliq_logger.critical("Backup %s is also invalid: %s", bak_path.name, backup_error)

        if critical_chain:
            return None

        vorliq_logger.critical("Returning safe default for unreadable storage file %s", path.name)
        return default

    @contextmanager
    def _file_lock(self, path: Path, timeout: float = 5.0):
        lock_path = path.with_suffix(path.suffix + ".lock")
        start = time.monotonic()
        descriptor: int | None = None
        while descriptor is None:
            try:
                descriptor = os.open(str(lock_path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                os.write(descriptor, str(os.getpid()).encode("ascii"))
            except FileExistsError:
                if time.monotonic() - start >= timeout:
                    raise TimeoutError(f"Timed out waiting for storage lock {lock_path.name}")
                time.sleep(0.05)

        try:
            yield
        finally:
            if descriptor is not None:
                os.close(descriptor)
            try:
                lock_path.unlink()
            except FileNotFoundError:
                pass

    def _fsync_directory(self, directory: Path) -> None:
        if os.name != "posix":
            return
        descriptor = os.open(str(directory), os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)

    def storage_health(self) -> dict[str, Any]:
        files = [self._file_health(self.data_dir / name) for name in CRITICAL_JSON_FILES]
        error_count = sum(1 for item in files if item["status"] == "error")
        warning_count = sum(1 for item in files if item["status"] == "warning")
        overall = "error" if error_count else "warning" if warning_count else "ok"
        return {
            "success": True,
            "overall_status": overall,
            "critical_files_ok": sum(1 for item in files if item["status"] == "ok"),
            "warnings_count": warning_count,
            "errors_count": error_count,
            "backup_available": any(item["has_backup"] for item in files),
            "files": files,
        }

    def _file_health(self, path: Path) -> dict[str, Any]:
        exists = path.exists()
        backup = path.with_suffix(path.suffix + ".bak")
        valid_json = False
        message = "file is valid"
        status = "ok"
        size_bytes = 0
        last_modified = None

        if exists:
            stats = path.stat()
            size_bytes = stats.st_size
            last_modified = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(stats.st_mtime))
            try:
                json.loads(path.read_text(encoding="utf-8"))
                valid_json = True
            except Exception as error:
                message = f"invalid JSON: {error}"
                status = "error" if path.name == "chain.json" and not backup.exists() else "warning"
        else:
            message = "file has not been created yet"
            status = "warning" if path.name == "chain.json" else "ok"

        if path.name == "chain.json" and self.chain_write_protected:
            status = "error"
            message = self.chain_storage_error or message

        return {
            "file_name": path.name,
            "exists": exists,
            "valid_json": valid_json,
            "has_backup": backup.exists(),
            "size_bytes": size_bytes,
            "last_modified": last_modified,
            "status": status,
            "message": message,
        }

    def _block_from_dict(self, data: dict[str, Any]) -> Block:
        return Block.from_dict(data)

    def _transaction_to_dict(self, transaction: Any) -> dict[str, Any]:
        if isinstance(transaction, Transaction):
            return transaction.to_dict()
        if isinstance(transaction, dict):
            return Transaction.from_dict(transaction).to_dict()
        raise TypeError(f"Unsupported transaction type: {type(transaction)!r}")
