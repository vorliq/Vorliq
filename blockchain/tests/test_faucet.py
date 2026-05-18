import unittest

from blockchain import Blockchain
from faucet import Faucet
from transaction import SYSTEM_ADDRESS, TREASURY_ADDRESS, Transaction


def make_chain():
    blockchain = Blockchain()
    blockchain.difficulty = 1
    blockchain.proof_target = "0"
    return blockchain


def mine_now(blockchain, miner="miner"):
    blockchain.chain[-1].timestamp -= blockchain.BLOCK_TIME_MINIMUM + 1
    return blockchain.mine_pending_transactions(miner)


def fund_treasury(blockchain, amount=50, miner="miner-a"):
    blockchain.add_pending_transaction(Transaction(SYSTEM_ADDRESS, TREASURY_ADDRESS, amount))
    mine_now(blockchain, miner)


class FaucetTests(unittest.TestCase):
    def test_claim_rejected_when_treasury_balance_is_zero(self):
        blockchain = make_chain()
        faucet = Faucet()

        claim = faucet.request_claim("VLQ_NEW", blockchain.get_treasury_balance(), blockchain)

        self.assertEqual(claim["status"], "treasury_empty")
        self.assertEqual(len(blockchain.pending_transactions), 0)

    def test_claim_creates_pending_treasury_transaction_when_funded(self):
        blockchain = make_chain()
        fund_treasury(blockchain)
        faucet = Faucet()

        claim = faucet.request_claim("VLQ_NEW", blockchain.get_treasury_balance(), blockchain, "abc123")

        self.assertEqual(claim["status"], "pending")
        self.assertTrue(claim["tx_id"])
        self.assertEqual(blockchain.pending_transactions[-1].sender_address, TREASURY_ADDRESS)
        self.assertEqual(blockchain.pending_transactions[-1].receiver_address, "VLQ_NEW")
        self.assertEqual(blockchain.pending_transactions[-1].transaction_type, "faucet_starter")
        self.assertEqual(blockchain.pending_transactions[-1].metadata["claim_id"], claim["claim_id"])

    def test_sync_claim_statuses_moves_pending_to_confirmed(self):
        blockchain = make_chain()
        fund_treasury(blockchain)
        faucet = Faucet()
        claim = faucet.request_claim("VLQ_NEW", blockchain.get_treasury_balance(), blockchain)

        mine_now(blockchain, "miner-b")
        changed = faucet.sync_claim_statuses(blockchain)
        claims = faucet.get_claims_for_address("VLQ_NEW")

        self.assertTrue(changed)
        self.assertEqual(claims[0]["claim_id"], claim["claim_id"])
        self.assertEqual(claims[0]["status"], "confirmed")
        self.assertIsNotNone(claims[0]["block_index"])
        self.assertIsNotNone(claims[0]["block_hash"])

    def test_wallet_cooldown_blocks_repeat_claim(self):
        blockchain = make_chain()
        fund_treasury(blockchain)
        faucet = Faucet()
        faucet.request_claim("VLQ_NEW", blockchain.get_treasury_balance(), blockchain)

        repeat = faucet.request_claim("VLQ_NEW", blockchain.get_treasury_balance(), blockchain)

        self.assertEqual(repeat["status"], "rate_limited")
        self.assertIn("24 hours", repeat["reason"])

    def test_fingerprint_cooldown_blocks_excessive_claims(self):
        blockchain = make_chain()
        fund_treasury(blockchain, amount=100)
        faucet = Faucet()

        for index in range(3):
            claim = faucet.request_claim(f"VLQ_NEW_{index}", blockchain.get_treasury_balance(), blockchain, "samehash")
            self.assertEqual(claim["status"], "pending")

        blocked = faucet.request_claim("VLQ_NEW_4", blockchain.get_treasury_balance(), blockchain, "samehash")

        self.assertEqual(blocked["status"], "rate_limited")

    def test_system_addresses_rejected(self):
        blockchain = make_chain()
        fund_treasury(blockchain)
        faucet = Faucet()

        with self.assertRaises(ValueError):
            faucet.request_claim(TREASURY_ADDRESS, blockchain.get_treasury_balance(), blockchain)

    def test_summary_returns_safe_data(self):
        blockchain = make_chain()
        fund_treasury(blockchain)
        faucet = Faucet()
        faucet.request_claim("VLQ_NEW", blockchain.get_treasury_balance(), blockchain, "private-hash")

        summary = faucet.get_faucet_summary(blockchain)
        recent = faucet.get_recent_claims()["claims"][0]

        self.assertTrue(summary["enabled"])
        self.assertEqual(summary["starter_amount"], 1.0)
        self.assertNotIn("fingerprint_hash", recent)


if __name__ == "__main__":
    unittest.main()
