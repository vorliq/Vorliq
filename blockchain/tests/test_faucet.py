import unittest
from unittest.mock import patch

from blockchain import Blockchain
from faucet import Faucet
from transaction import SYSTEM_ADDRESS, TREASURY_ADDRESS, Transaction

VALID_WALLET = "3MNQE1X7T4Bz9kLmNpQrStUvWx"
OTHER_VALID_WALLET = "7YWHMfk9JZe9LMQaPq2X3B4C5D"
THIRD_VALID_WALLET = "9ABcDefGhJKLMNPQrSTUvwxYZ12345"
FOURTH_VALID_WALLET = "4GmP9nQ8rStUvWxYzABcDeFghJKL"


def make_chain():
    blockchain = Blockchain()
    blockchain.difficulty = 1
    blockchain.proof_target = "0"
    return blockchain


def mine_now(blockchain, miner="miner"):
    next_timestamp = blockchain.get_latest_block().timestamp + blockchain.BLOCK_TIME_MINIMUM + 1
    with patch("blockchain.time.time", return_value=next_timestamp), patch("block.time.time", return_value=next_timestamp):
        return blockchain.mine_pending_transactions(miner)


def fund_treasury(blockchain, amount=50, miner="miner-a"):
    blockchain.add_pending_transaction(Transaction(SYSTEM_ADDRESS, TREASURY_ADDRESS, amount))
    mine_now(blockchain, miner)


class FaucetTests(unittest.TestCase):
    def test_claim_rejected_when_treasury_balance_is_zero(self):
        blockchain = make_chain()
        faucet = Faucet()

        claim = faucet.request_claim(VALID_WALLET, blockchain.get_treasury_balance(), blockchain)

        self.assertEqual(claim["status"], "treasury_empty")
        self.assertEqual(len(blockchain.pending_transactions), 0)

    def test_claim_creates_pending_treasury_transaction_when_funded(self):
        blockchain = make_chain()
        fund_treasury(blockchain)
        faucet = Faucet()

        claim = faucet.request_claim(VALID_WALLET, blockchain.get_treasury_balance(), blockchain, "abc123")

        self.assertEqual(claim["status"], "pending")
        self.assertTrue(claim["tx_id"])
        self.assertEqual(blockchain.pending_transactions[-1].sender_address, TREASURY_ADDRESS)
        self.assertEqual(blockchain.pending_transactions[-1].receiver_address, VALID_WALLET)
        self.assertEqual(blockchain.pending_transactions[-1].transaction_type, "faucet_starter")
        self.assertEqual(blockchain.pending_transactions[-1].metadata["claim_id"], claim["claim_id"])

    def test_sync_claim_statuses_moves_pending_to_confirmed(self):
        blockchain = make_chain()
        fund_treasury(blockchain)
        faucet = Faucet()
        claim = faucet.request_claim(VALID_WALLET, blockchain.get_treasury_balance(), blockchain)

        mine_now(blockchain, "miner-b")
        changed = faucet.sync_claim_statuses(blockchain)
        claims = faucet.get_claims_for_address(VALID_WALLET)

        self.assertTrue(changed)
        self.assertEqual(claims[0]["claim_id"], claim["claim_id"])
        self.assertEqual(claims[0]["status"], "confirmed")
        self.assertIsNotNone(claims[0]["block_index"])
        self.assertIsNotNone(claims[0]["block_hash"])

    def test_wallet_cooldown_blocks_repeat_claim(self):
        blockchain = make_chain()
        fund_treasury(blockchain)
        faucet = Faucet()
        faucet.request_claim(VALID_WALLET, blockchain.get_treasury_balance(), blockchain)

        repeat = faucet.request_claim(VALID_WALLET, blockchain.get_treasury_balance(), blockchain)

        self.assertEqual(repeat["status"], "rate_limited")
        self.assertIn("24 hours", repeat["reason"])

    def test_fingerprint_cooldown_blocks_second_device_claim(self):
        # A device fingerprint may claim at most once per cooldown window
        # (FINGERPRINT_LIMIT == 1). The first claim succeeds; a second claim from
        # the SAME device but a DIFFERENT wallet is rejected with the same message
        # as the per-wallet cooldown, so it never reveals fingerprinting is used.
        blockchain = make_chain()
        fund_treasury(blockchain, amount=100)
        faucet = Faucet()

        first = faucet.request_claim(VALID_WALLET, blockchain.get_treasury_balance(), blockchain, "samehash")
        self.assertEqual(first["status"], "pending")

        blocked = faucet.request_claim(OTHER_VALID_WALLET, blockchain.get_treasury_balance(), blockchain, "samehash")
        self.assertEqual(blocked["status"], "rate_limited")
        self.assertEqual(blocked["reason"], Faucet.COOLDOWN_MESSAGE)

    def test_system_addresses_rejected(self):
        blockchain = make_chain()
        fund_treasury(blockchain)
        faucet = Faucet()

        with self.assertRaises(ValueError):
            faucet.request_claim(TREASURY_ADDRESS, blockchain.get_treasury_balance(), blockchain)

    def test_malformed_wallet_address_is_rejected_before_pending_transaction(self):
        blockchain = make_chain()
        fund_treasury(blockchain)
        faucet = Faucet()

        with self.assertRaises(ValueError):
            faucet.request_claim("not_an_address!", blockchain.get_treasury_balance(), blockchain)

        self.assertEqual(len(blockchain.pending_transactions), 2)

    def test_summary_returns_safe_data(self):
        blockchain = make_chain()
        fund_treasury(blockchain)
        faucet = Faucet()
        faucet.request_claim(VALID_WALLET, blockchain.get_treasury_balance(), blockchain, "private-hash")

        summary = faucet.get_faucet_summary(blockchain)
        recent = faucet.get_recent_claims()["claims"][0]

        self.assertTrue(summary["enabled"])
        self.assertEqual(summary["starter_amount"], 1.0)
        self.assertNotIn("fingerprint_hash", recent)


if __name__ == "__main__":
    unittest.main()
