import unittest

from blockchain import Blockchain
from lending import LendingPool
from transaction import SYSTEM_ADDRESS, Transaction


def mine_now(blockchain, miner="miner"):
    blockchain.chain[-1].timestamp -= blockchain.BLOCK_TIME_MINIMUM + 1
    return blockchain.mine_pending_transactions(miner)


class LendingPoolTests(unittest.TestCase):
    def test_loan_request_starts_pending_vote(self):
        lending_pool = LendingPool(Blockchain())
        loan_id = lending_pool.create_loan_request("requester", 500, "community garden")

        loan = lending_pool.get_loan(loan_id)

        self.assertTrue(loan_id)
        self.assertEqual(loan["status"], "pending_vote")
        self.assertEqual(loan["repayment_amount"], 550)
        self.assertEqual(loan["status_history"][0]["status"], "pending_vote")

    def test_zero_amount_is_rejected(self):
        lending_pool = LendingPool(Blockchain())

        with self.assertRaises(ValueError):
            lending_pool.create_loan_request("requester", 0, "reason")

    def test_amount_greater_than_limit_is_rejected(self):
        lending_pool = LendingPool(Blockchain())

        with self.assertRaises(ValueError):
            lending_pool.create_loan_request("requester", 10001, "reason")

    def test_duplicate_active_loan_is_rejected(self):
        lending_pool = LendingPool(Blockchain())
        lending_pool.create_loan_request("requester", 500, "first")

        with self.assertRaises(ValueError):
            lending_pool.create_loan_request("requester", 250, "second")

    def test_yes_vote_moves_to_approved_pending_issue_and_records_tx_id(self):
        blockchain = Blockchain()
        lending_pool = LendingPool(blockchain)
        loan_id = lending_pool.create_loan_request("requester", 500, "reason")

        loan = lending_pool.vote_on_loan(loan_id, "voter", "yes", 150)

        self.assertEqual(loan["status"], "approved_pending_issue")
        self.assertTrue(loan["issuance_tx_id"])
        self.assertEqual(blockchain.pending_transactions[0].metadata["loan_id"], loan_id)
        self.assertEqual(blockchain.pending_transactions[0].transaction_type, "loan_issuance")

    def test_sync_moves_confirmed_issuance_to_active(self):
        blockchain = Blockchain()
        lending_pool = LendingPool(blockchain)
        loan_id = lending_pool.create_loan_request("requester", 500, "reason")
        lending_pool.vote_on_loan(loan_id, "voter", "yes", 150)

        mine_now(blockchain, "miner-a")
        changed = lending_pool.sync_loan_statuses(blockchain)
        loan = lending_pool.get_loan(loan_id)

        self.assertTrue(changed)
        self.assertEqual(loan["status"], "active")
        self.assertIsNotNone(loan["issued_at"])
        self.assertEqual(loan["issued_block"], 1)

    def test_repay_records_pending_tx_and_sync_confirms_repaid(self):
        blockchain = Blockchain()
        lending_pool = LendingPool(blockchain)
        loan_id = lending_pool.create_loan_request("requester", 500, "reason")
        lending_pool.vote_on_loan(loan_id, "voter", "yes", 150)
        mine_now(blockchain, "miner-a")
        lending_pool.sync_loan_statuses(blockchain)
        blockchain.add_pending_transaction(Transaction(SYSTEM_ADDRESS, "requester", 100))
        mine_now(blockchain, "miner-b")

        loan = lending_pool.repay_loan(loan_id, "requester", blockchain)

        self.assertEqual(loan["status"], "repayment_pending")
        self.assertTrue(loan["repayment_tx_id"])
        self.assertEqual(blockchain.pending_transactions[-1].transaction_type, "loan_repayment")
        self.assertEqual(blockchain.pending_transactions[-1].metadata["loan_id"], loan_id)

        mine_now(blockchain, "miner-c")
        lending_pool.sync_loan_statuses(blockchain)

        self.assertEqual(lending_pool.get_loan(loan_id)["status"], "repaid")

    def test_overdue_status_after_due_block(self):
        blockchain = Blockchain()
        lending_pool = LendingPool(blockchain)
        loan_id = lending_pool.create_loan_request("requester", 500, "reason")
        lending_pool.vote_on_loan(loan_id, "voter", "yes", 150)
        mine_now(blockchain, "miner-a")
        lending_pool.sync_loan_statuses(blockchain)

        lending_pool.loan_requests[loan_id]["due_block"] = 0
        lending_pool.sync_loan_statuses(blockchain)

        self.assertEqual(lending_pool.get_loan(loan_id)["status"], "overdue")
        self.assertTrue(lending_pool.get_loan(loan_id)["is_overdue"])

    def test_old_status_compatibility(self):
        lending_pool = LendingPool(Blockchain())
        statuses = {
            "legacy-pending": "pending",
            "legacy-approved": "approved",
            "legacy-rejected": "rejected",
            "legacy-repaid": "repaid",
        }
        for loan_id, status in statuses.items():
            lending_pool.loan_requests[loan_id] = {
                "loan_id": loan_id,
                "requester_address": "requester",
                "amount": 10,
                "reason": "legacy",
                "timestamp": 1,
                "status": status,
            }

        self.assertEqual(lending_pool.get_loan("legacy-pending")["status"], "pending_vote")
        self.assertEqual(lending_pool.get_loan("legacy-approved")["status"], "approved_pending_issue")
        self.assertEqual(lending_pool.get_loan("legacy-rejected")["status"], "rejected")
        self.assertEqual(lending_pool.get_loan("legacy-repaid")["status"], "repaid")

    def test_no_vote_with_enough_weight_auto_rejects_loan(self):
        lending_pool = LendingPool(Blockchain())
        loan_id = lending_pool.create_loan_request("requester", 500, "reason")

        loan = lending_pool.vote_on_loan(loan_id, "voter", "no", 150)

        self.assertEqual(loan["status"], "rejected")

    def test_zero_balance_voter_cannot_vote(self):
        lending_pool = LendingPool(Blockchain())
        loan_id = lending_pool.create_loan_request("requester", 500, "reason")

        with self.assertRaises(ValueError):
            lending_pool.vote_on_loan(loan_id, "voter", "yes", 0)


if __name__ == "__main__":
    unittest.main()
