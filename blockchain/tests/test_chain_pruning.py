"""Tests for configurable chain pruning.

Pruning drops all but the most recent N blocks and replaces the pruned history
with a cryptographic, balance-bearing commitment (the prune-point hash plus a
UTXO-style snapshot of every wallet's confirmed balance). The retained chain must
stay fully verifiable and produce exactly the same balances as the full chain,
and mining must continue correctly afterwards.

The headline test builds a 150-block chain of real signed transactions, prunes to
50, and verifies: every wallet balance is unchanged, the chain validates from the
prune point, the commitment verifies, new blocks append and validate, and the
pruned chain survives a save/load round trip.
"""

import os
import tempfile
import unittest
from unittest.mock import patch

from blockchain import Blockchain
from storage import Storage
from transaction import Transaction
from wallet import Wallet


class ChainPruningTests(unittest.TestCase):
    WALLET_COUNT = 10

    def setUp(self):
        self._prev_flag = os.environ.get("VORLIQ_DISABLE_DIFFICULTY_ADJUSTMENT")
        os.environ["VORLIQ_DISABLE_DIFFICULTY_ADJUSTMENT"] = "true"

    def tearDown(self):
        if self._prev_flag is None:
            os.environ.pop("VORLIQ_DISABLE_DIFFICULTY_ADJUSTMENT", None)
        else:
            os.environ["VORLIQ_DISABLE_DIFFICULTY_ADJUSTMENT"] = self._prev_flag

    def _mine(self, blockchain, miner_address, seconds=61):
        latest = blockchain.get_latest_block()
        ts = latest.timestamp + seconds
        with patch("blockchain.time.time", return_value=ts), patch(
            "block.time.time", return_value=ts
        ), patch.object(blockchain, "is_chain_valid", return_value=True):
            return blockchain.mine_pending_transactions(miner_address)

    @staticmethod
    def _signed_transfer(sender_wallet, receiver_address, amount):
        tx = Transaction(sender_wallet.address, receiver_address, amount)
        tx.sign_transaction(sender_wallet)
        return tx

    def _build_chain(self, target_height):
        blockchain = Blockchain()
        blockchain.difficulty = 1
        blockchain.proof_target = "0"
        wallets = [Wallet() for _ in range(self.WALLET_COUNT)]
        for wallet in wallets:
            self._mine(blockchain, wallet.address)
        self._mine(blockchain, wallets[0].address)
        blockchain.get_indexes()
        round_index = 0
        while blockchain.get_block_height() < target_height:
            sender = wallets[round_index % self.WALLET_COUNT]
            receiver = wallets[(round_index + 1) % self.WALLET_COUNT]
            if blockchain.get_balance(sender.address) > 1.0:
                try:
                    blockchain.add_pending_transaction(
                        self._signed_transfer(sender, receiver.address, 0.5)
                    )
                except ValueError:
                    pass
            self._mine(blockchain, wallets[(round_index + 3) % self.WALLET_COUNT].address)
            round_index += 1
        return blockchain, wallets

    def test_prune_150_to_50_preserves_balances_validity_and_appendability(self):
        blockchain, wallets = self._build_chain(150)
        self.assertGreaterEqual(blockchain.get_block_height(), 150)

        addresses = [w.address for w in wallets] + [blockchain.TREASURY_ADDRESS]
        before = {a: blockchain.get_balance(a) for a in addresses}
        before_confirmed = {a: blockchain.get_indexes().confirmed_balance(a) for a in addresses}
        before_height = blockchain.get_block_height()
        before_total_issued = blockchain.get_total_issued()

        result = blockchain.prune_chain(50)

        # 1. Structure: only the most recent 50 blocks are retained, the recorded
        #    height is unchanged, and a prune point now exists.
        self.assertTrue(result["pruned"])
        self.assertEqual(len(blockchain.chain), 50)
        self.assertEqual(blockchain.get_block_height(), before_height)
        self.assertIsNotNone(blockchain.prune_point)
        self.assertEqual(blockchain.chain[0].previous_hash, blockchain.prune_point["block_hash"])

        # 2. Every wallet balance is exactly preserved (confirmed and total).
        for address in addresses:
            self.assertAlmostEqual(blockchain.get_balance(address), before[address], places=8,
                                   msg=f"balance changed for {address}")
            self.assertAlmostEqual(blockchain.get_indexes().confirmed_balance(address),
                                   before_confirmed[address], places=8,
                                   msg=f"confirmed balance changed for {address}")
        self.assertAlmostEqual(blockchain.get_total_issued(), before_total_issued, places=8)

        # 3. The chain validates from the prune point, and the commitment verifies.
        self.assertTrue(blockchain.prune_commitment_is_valid())
        self.assertTrue(blockchain.is_chain_valid(enforce_block_spacing=False))

        # 4. A tampered snapshot is rejected.
        saved = dict(blockchain.prune_point)
        blockchain.prune_point = dict(saved, total_issued=saved["total_issued"] + 1.0)
        self.assertFalse(blockchain.prune_commitment_is_valid())
        self.assertFalse(blockchain.is_chain_valid(enforce_block_spacing=False))
        blockchain.prune_point = saved  # restore

        # 5. New blocks append, get the correct next index, and validate.
        new_block = self._mine(blockchain, wallets[5].address)
        self.assertEqual(new_block.index, before_height + 1)
        self.assertEqual(len(blockchain.chain), 51)
        self.assertTrue(blockchain.is_chain_valid(enforce_block_spacing=False))
        # Balances remain consistent after appending (reward credited to miner).
        for address in addresses:
            self.assertAlmostEqual(
                blockchain.get_balance(address),
                blockchain.get_indexes().balance(address),
                places=8,
            )

    def test_pruned_chain_survives_save_and_load(self):
        blockchain, wallets = self._build_chain(120)
        addresses = [w.address for w in wallets] + [blockchain.TREASURY_ADDRESS]
        blockchain.prune_chain(40)
        # Compare CONFIRMED balances across the reload: save_chain persists the
        # chain and prune point but not the pending pool (that is pending.json),
        # so the confirmed ledger is the apples-to-apples invariant here.
        before = {a: blockchain.get_indexes().confirmed_balance(a) for a in addresses}

        with tempfile.TemporaryDirectory() as temp_dir:
            storage = Storage(temp_dir)
            storage.save_chain(blockchain)
            storage.save_indexes(blockchain.get_indexes())

            reloaded = storage.load_chain()
            self.assertIsNotNone(reloaded)
            # Prune point restored, chain valid from it, balances identical.
            self.assertIsNotNone(reloaded.prune_point)
            self.assertEqual(reloaded.prune_point["block_hash"], blockchain.prune_point["block_hash"])
            self.assertTrue(reloaded.is_chain_valid(enforce_block_spacing=False))
            self.assertEqual(reloaded.get_block_height(), blockchain.get_block_height())
            for address in addresses:
                self.assertAlmostEqual(reloaded.get_indexes().confirmed_balance(address), before[address],
                                       places=8, msg=f"confirmed balance changed across reload for {address}")

    def test_prune_noop_when_chain_below_keep_target(self):
        blockchain, _ = self._build_chain(30)
        result = blockchain.prune_chain(100)
        self.assertFalse(result["pruned"])
        self.assertIsNone(blockchain.prune_point)
        self.assertTrue(blockchain.is_chain_valid(enforce_block_spacing=False))


if __name__ == "__main__":
    unittest.main()
