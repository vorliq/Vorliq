import unittest

from transaction import SYSTEM_ADDRESS, Transaction
from wallet import Wallet


class TransactionTests(unittest.TestCase):
    def test_transaction_can_be_created(self):
        transaction = Transaction("sender", "receiver", 100)

        self.assertEqual(transaction.sender_address, "sender")
        self.assertEqual(transaction.receiver_address, "receiver")
        self.assertEqual(transaction.amount, 100)

    def test_signing_transaction_produces_signature(self):
        wallet = Wallet()
        transaction = Transaction(wallet.address, "receiver", 10)
        transaction.sign_transaction(wallet)

        self.assertTrue(transaction.signature)

    def test_signed_transaction_passes_verification(self):
        wallet = Wallet()
        transaction = Transaction(wallet.address, "receiver", 10)
        transaction.sign_transaction(wallet)

        self.assertTrue(transaction.verify_transaction())

    def test_tampered_amount_fails_verification(self):
        wallet = Wallet()
        transaction = Transaction(wallet.address, "receiver", 10)
        transaction.sign_transaction(wallet)
        transaction.amount = 20

        self.assertFalse(transaction.verify_transaction())

    def test_system_transaction_without_signature_is_valid(self):
        transaction = Transaction(SYSTEM_ADDRESS, "receiver", 50)

        self.assertTrue(transaction.verify_transaction())


if __name__ == "__main__":
    unittest.main()
