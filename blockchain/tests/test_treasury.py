import unittest
from unittest.mock import patch

from blockchain import Blockchain
from transaction import SYSTEM_ADDRESS, TREASURY_ADDRESS, Transaction
from treasury import Treasury


def make_chain():
    blockchain = Blockchain()
    blockchain.difficulty = 1
    blockchain.proof_target = "0"
    return blockchain


def mine_now(blockchain, miner="miner"):
    next_timestamp = blockchain.get_latest_block().timestamp + blockchain.BLOCK_TIME_MINIMUM + 1
    with patch("blockchain.time.time", return_value=next_timestamp), patch("block.time.time", return_value=next_timestamp):
        return blockchain.mine_pending_transactions(miner)


def fund_address(blockchain, address, amount=1000, miner="miner-a"):
    blockchain.add_pending_transaction(Transaction(SYSTEM_ADDRESS, address, amount))
    mine_now(blockchain, miner)


def fund_treasury(blockchain, amount=500, miner="miner-t"):
    blockchain.add_pending_transaction(Transaction(SYSTEM_ADDRESS, TREASURY_ADDRESS, amount))
    mine_now(blockchain, miner)


class TreasuryLifecycleTests(unittest.TestCase):
    def test_treasury_proposal_starts_active(self):
        blockchain = make_chain()
        fund_address(blockchain, "proposer")
        fund_treasury(blockchain)
        treasury = Treasury(blockchain)

        proposal_id = treasury.create_proposal("proposer", "Docs", "Fund documentation work.", "development", 100, "recipient")

        proposal = treasury.get_proposal(proposal_id)
        self.assertEqual(proposal["status"], "active")
        self.assertEqual(proposal["status_history"][0]["status"], "active")

    def test_vote_passing_moves_to_payout_pending_after_tx_creation(self):
        blockchain = make_chain()
        fund_address(blockchain, "proposer")
        fund_treasury(blockchain, miner="miner-b")
        treasury = Treasury(blockchain)
        proposal_id = treasury.create_proposal("proposer", "Security", "Fund a security review.", "security", 100, "recipient")

        proposal = treasury.vote_on_proposal(proposal_id, "voter", "yes", 250)

        self.assertEqual(proposal["status"], "payout_pending")
        self.assertTrue(proposal["payout_tx_id"])
        self.assertEqual(blockchain.pending_transactions[-1].metadata["proposal_id"], proposal_id)
        self.assertEqual(blockchain.pending_transactions[-1].transaction_type, "treasury_payout")
        self.assertTrue(any(entry["status"] == "passed_pending_payout" for entry in proposal["status_history"]))

    def test_sync_moves_confirmed_payout_to_paid(self):
        blockchain = make_chain()
        fund_address(blockchain, "proposer")
        fund_treasury(blockchain, miner="miner-b")
        treasury = Treasury(blockchain)
        proposal_id = treasury.create_proposal("proposer", "Education", "Fund education material.", "education", 100, "recipient")
        proposal = treasury.vote_on_proposal(proposal_id, "voter", "yes", 250)
        payout_tx_id = proposal["payout_tx_id"]

        mine_now(blockchain, "miner-c")
        changed = treasury.sync_treasury_statuses(blockchain)
        proposal = treasury.get_proposal(proposal_id)

        self.assertTrue(changed)
        self.assertEqual(proposal["status"], "paid")
        self.assertEqual(proposal["payout_tx_id"], payout_tx_id)
        self.assertIsNotNone(proposal["payout_block_index"])
        self.assertIsNotNone(proposal["payout_block_hash"])

    def test_ledger_includes_reward_inflow_and_payout_outflow(self):
        blockchain = make_chain()
        fund_address(blockchain, "proposer")
        fund_treasury(blockchain, miner="miner-b")
        treasury = Treasury(blockchain)
        proposal_id = treasury.create_proposal("proposer", "Community", "Fund community work.", "community", 100, "recipient")
        treasury.vote_on_proposal(proposal_id, "voter", "yes", 250)
        mine_now(blockchain, "miner-c")
        treasury.sync_treasury_statuses(blockchain)

        ledger = treasury.get_treasury_ledger(blockchain, limit=25, offset=0)["entries"]

        self.assertTrue(any(entry["type"] == "reward_in" for entry in ledger))
        self.assertTrue(any(entry["type"] == "payout_paid" and entry["proposal_id"] == proposal_id for entry in ledger))

    def test_proposal_cannot_request_more_than_treasury_balance(self):
        blockchain = make_chain()
        fund_address(blockchain, "proposer")
        fund_treasury(blockchain, amount=50)
        treasury = Treasury(blockchain)

        with self.assertRaises(ValueError):
            treasury.create_proposal("proposer", "Too much", "Request too much.", "development", 100, "recipient")

    def test_cancel_only_works_for_proposer_before_votes(self):
        blockchain = make_chain()
        fund_address(blockchain, "proposer")
        fund_treasury(blockchain)
        treasury = Treasury(blockchain)
        proposal_id = treasury.create_proposal("proposer", "Cancel", "Cancel this request.", "development", 100, "recipient")

        with self.assertRaises(ValueError):
            treasury.cancel_proposal(proposal_id, "other")

        proposal = treasury.cancel_proposal(proposal_id, "proposer")
        self.assertEqual(proposal["status"], "cancelled")

    def test_cancel_rejected_after_votes(self):
        blockchain = make_chain()
        fund_address(blockchain, "proposer")
        fund_treasury(blockchain)
        treasury = Treasury(blockchain)
        proposal_id = treasury.create_proposal("proposer", "Vote first", "Vote before cancel.", "development", 100, "recipient")
        treasury.vote_on_proposal(proposal_id, "voter", "yes", 10)

        with self.assertRaises(ValueError):
            treasury.cancel_proposal(proposal_id, "proposer")

    def test_duplicate_vote_rejected(self):
        blockchain = make_chain()
        fund_address(blockchain, "proposer")
        fund_treasury(blockchain)
        treasury = Treasury(blockchain)
        proposal_id = treasury.create_proposal("proposer", "Vote once", "Duplicate vote test.", "development", 100, "recipient")
        treasury.vote_on_proposal(proposal_id, "voter", "yes", 10)

        with self.assertRaises(ValueError):
            treasury.vote_on_proposal(proposal_id, "voter", "no", 10)

    def test_legacy_passed_compatibility(self):
        treasury = Treasury(make_chain())
        treasury.proposals["legacy"] = {
            "proposal_id": "legacy",
            "proposer_address": "proposer",
            "title": "Legacy",
            "description": "Legacy passed proposal",
            "category": "development",
            "requested_amount": 10,
            "recipient_address": "recipient",
            "timestamp": 1,
            "status": "passed",
            "votes": {},
        }

        proposal = treasury.get_proposal("legacy")

        self.assertEqual(proposal["status"], "passed_pending_payout")


if __name__ == "__main__":
    unittest.main()
