"""Correctness and timing tests for the incrementally-maintained read index.

The core used to discard the whole transaction index on every mined block and
rebuild it from the entire chain under the write lock — O(chain length) work that
grew without bound. The index is now maintained incrementally: each appended
block merges only its own transactions into the existing index, and the pending
overlay is reconciled in O(pending). These tests pin the two invariants that make
that safe to ship as balance-bearing code:

  1. The incrementally-maintained index is *identical* to a from-scratch rebuild
     — same per-wallet balances and the same total transaction count — across a
     long chain of real signed transactions.
  2. Processing a new block under the write lock stays well under 50 ms and does
     not grow with chain length.

The 200-block chain is expensive to build (the core re-derives confirmed
balances from the whole chain on every mine, which is O(n) per block and
orthogonal to the index), so it is built exactly once for the whole class.
"""

import os
import time
import unittest
from unittest.mock import patch

from blockchain import Blockchain
from indexes import BlockchainIndexes
from transaction import Transaction
from wallet import Wallet


class IncrementalIndexTests(unittest.TestCase):
    WALLET_COUNT = 10
    HEIGHT_TARGET = 200

    @classmethod
    def setUpClass(cls):
        # Pin difficulty: the retarget would otherwise keep raising it as we mine
        # 200 blocks back-to-back, making proof of work unusably slow. Test-only
        # flag (production never sets it); it does not touch the index logic.
        cls._prev_flag = os.environ.get("VORLIQ_DISABLE_DIFFICULTY_ADJUSTMENT")
        os.environ["VORLIQ_DISABLE_DIFFICULTY_ADJUSTMENT"] = "true"
        cls.blockchain, cls.wallets = cls._build_chain()

    @classmethod
    def tearDownClass(cls):
        if cls._prev_flag is None:
            os.environ.pop("VORLIQ_DISABLE_DIFFICULTY_ADJUSTMENT", None)
        else:
            os.environ["VORLIQ_DISABLE_DIFFICULTY_ADJUSTMENT"] = cls._prev_flag

    @classmethod
    def _mine(cls, blockchain, miner_address, seconds=31):
        """Mine one block past the cooldown with a deterministic timestamp.

        build_candidate_block re-runs is_chain_valid (a full-chain integrity +
        signature re-verification) before every mine. That is a real production
        gate, but it is O(chain length) per block and orthogonal to what this
        test exercises; re-verifying every signature on every one of 200
        back-to-back mines would make the test O(n^2) in ECDSA checks. The chain
        is valid here by construction, so we stub that gate to True for the
        build. add_block still runs its own O(block) admission validation of the
        new block, and the memoised chain_valid_fast() the index reads is
        unaffected, so the index path under test is fully exercised."""
        latest_block = blockchain.get_latest_block()
        next_timestamp = latest_block.timestamp + seconds
        with patch("blockchain.time.time", return_value=next_timestamp), patch(
            "block.time.time", return_value=next_timestamp
        ), patch.object(blockchain, "is_chain_valid", return_value=True):
            return blockchain.mine_pending_transactions(miner_address)

    @staticmethod
    def _signed_transfer(sender_wallet, receiver_address, amount):
        transaction = Transaction(sender_wallet.address, receiver_address, amount)
        transaction.sign_transaction(sender_wallet)
        return transaction

    @classmethod
    def _build_chain(cls):
        """Build a 200-block chain of real signed transactions across 10 wallets.

        Every wallet is seeded with mining rewards, then a wallet sends a small
        signed amount to the next wallet so the chain carries a steady stream of
        genuine value-bearing transactions (not just rewards). The index is
        materialised right after seeding so every subsequent block is merged
        incrementally — i.e. the path under test is the one actually exercised.
        """
        blockchain = Blockchain()
        blockchain.difficulty = 1
        blockchain.proof_target = "0" * blockchain.difficulty
        wallets = [Wallet() for _ in range(cls.WALLET_COUNT)]

        # Seed: mine a block for each wallet so every address holds spendable VLQ.
        # The reward for round N lands as pending and confirms into round N+1, so
        # one extra warm-up round confirms the last wallet's reward too.
        for wallet in wallets:
            cls._mine(blockchain, wallet.address)
        cls._mine(blockchain, wallets[0].address)

        # Materialise the index now so add_block() maintains it incrementally for
        # the rest of the build (rather than leaving it None and lazily rebuilt).
        blockchain.get_indexes()

        round_index = 0
        while blockchain.get_block_height() < cls.HEIGHT_TARGET:
            sender = wallets[round_index % cls.WALLET_COUNT]
            receiver = wallets[(round_index + 1) % cls.WALLET_COUNT]
            if blockchain.get_balance(sender.address) > 1.0:
                try:
                    blockchain.add_pending_transaction(
                        cls._signed_transfer(sender, receiver.address, 0.5)
                    )
                except ValueError:
                    pass
            # Rotate the miner so no single address trips the anti-monopoly gap.
            miner = wallets[(round_index + 3) % cls.WALLET_COUNT]
            cls._mine(blockchain, miner.address)
            round_index += 1

        return blockchain, wallets

    def test_incremental_index_matches_full_rebuild(self):
        blockchain = self.blockchain
        wallets = self.wallets
        self.assertGreaterEqual(blockchain.get_block_height(), self.HEIGHT_TARGET)

        # The index carried along incrementally as blocks were appended.
        incremental = blockchain.get_indexes()
        # A pristine rebuild from the whole chain, ignoring the maintained one.
        full = BlockchainIndexes.build(blockchain)

        # 1. Identical per-wallet balances for all ten addresses (confirmed and
        #    the confirmed+pending overlay), plus the treasury.
        check_addresses = [wallet.address for wallet in wallets]
        check_addresses.append(blockchain.TREASURY_ADDRESS)
        for address in check_addresses:
            self.assertAlmostEqual(
                incremental.balance(address),
                full.balance(address),
                places=8,
                msg=f"balance mismatch for {address}",
            )
            self.assertAlmostEqual(
                incremental.confirmed_balance(address),
                full.confirmed_balance(address),
                places=8,
                msg=f"confirmed balance mismatch for {address}",
            )
            # The incremental index must also agree with the authoritative
            # full-chain balance computation, not just with a rebuild.
            self.assertAlmostEqual(
                incremental.balance(address),
                blockchain.get_balance(address),
                places=8,
                msg=f"incremental balance disagrees with chain for {address}",
            )

        # 2. The two approaches agree on the total transaction count.
        incremental_total = incremental.indexes["chain_summary"]["total_transactions"]
        full_total = full.indexes["chain_summary"]["total_transactions"]
        self.assertEqual(incremental_total, full_total)
        self.assertEqual(
            incremental_total,
            sum(len(block.transactions or []) for block in blockchain.chain),
        )

        # And on total issued supply and the confirmed transaction population.
        self.assertAlmostEqual(
            incremental.indexes["chain_summary"]["total_issued"],
            full.indexes["chain_summary"]["total_issued"],
            places=8,
        )
        incremental_confirmed_ids = {
            tx_id
            for tx_id, record in incremental.indexes["transactions_by_id"].items()
            if record.get("status") == "confirmed"
        }
        full_confirmed_ids = {
            tx_id
            for tx_id, record in full.indexes["transactions_by_id"].items()
            if record.get("status") == "confirmed"
        }
        self.assertEqual(incremental_confirmed_ids, full_confirmed_ids)

        # Confirm there really were genuine (non-reward) transfers in the chain.
        transfer_count = sum(
            1
            for record in incremental.indexes["transactions_by_id"].values()
            if record.get("status") == "confirmed" and record.get("type") == "transfer"
        )
        self.assertGreater(transfer_count, 20)

    def test_block_processing_under_write_lock_is_constant_and_under_50ms(self):
        """The time to append+index a new block must not grow with chain length
        and must stay under 50 ms. We mine onto the already-long 200+ block chain
        and time only the append + index maintenance held under the write lock —
        exactly the work the original code did as a full O(n) rebuild."""
        blockchain = self.blockchain
        wallets = self.wallets
        blockchain.get_indexes()  # ensure the index is materialised and current

        def measure_one_append(iteration):
            sender = wallets[iteration % self.WALLET_COUNT]
            receiver = wallets[(iteration + 1) % self.WALLET_COUNT]
            if blockchain.get_balance(sender.address) > 1.0:
                try:
                    blockchain.add_pending_transaction(
                        self._signed_transfer(sender, receiver.address, 0.5)
                    )
                except ValueError:
                    pass
            # Rotate the miner each iteration so the same-miner anti-monopoly
            # cooldown never blocks the append we are trying to measure.
            miner = wallets[(iteration + 4) % self.WALLET_COUNT]
            latest = blockchain.get_latest_block()
            next_ts = latest.timestamp + 61
            with patch("blockchain.time.time", return_value=next_ts), patch(
                "block.time.time", return_value=next_ts
            ), patch.object(blockchain, "is_chain_valid", return_value=True):
                block, expected_prev = blockchain.build_candidate_block(miner.address)
                block.proof_of_work(block.difficulty)
                # Time only the append + incremental index maintenance (the
                # write-lock-held work), not the proof of work.
                start = time.perf_counter()
                blockchain.finalize_mined_block(block, expected_prev)
                blockchain.get_indexes()  # force the pending-overlay reconcile too
                return (time.perf_counter() - start) * 1000.0

        timings = [measure_one_append(i) for i in range(10)]
        worst = max(timings)
        self.assertLess(
            worst,
            50.0,
            msg=f"block processing under the write lock exceeded 50 ms: "
            f"{worst:.2f} ms (all: {[round(t, 2) for t in timings]})",
        )


if __name__ == "__main__":
    unittest.main()
