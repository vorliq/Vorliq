import unittest

from blockchain import Blockchain
from lending import LendingPool


class LendingPoolTests(unittest.TestCase):
    def test_loan_request_can_be_created(self):
        lending_pool = LendingPool(Blockchain())
        loan_id = lending_pool.create_loan_request("requester", 500, "community garden")

        self.assertTrue(loan_id)
        self.assertEqual(lending_pool.get_loan(loan_id)["status"], "pending")

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

    def test_yes_vote_with_enough_weight_auto_approves_loan(self):
        blockchain = Blockchain()
        lending_pool = LendingPool(blockchain)
        loan_id = lending_pool.create_loan_request("requester", 500, "reason")

        loan = lending_pool.vote_on_loan(loan_id, "voter", "yes", 150)

        self.assertEqual(loan["status"], "approved")

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
