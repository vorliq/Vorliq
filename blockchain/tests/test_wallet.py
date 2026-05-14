import unittest

from wallet import Wallet


class WalletTests(unittest.TestCase):
    def test_new_wallet_generates_keys_and_address(self):
        wallet = Wallet()

        self.assertIsNotNone(wallet.private_key)
        self.assertIsNotNone(wallet.public_key)
        self.assertIsInstance(wallet.address, str)
        self.assertGreater(len(wallet.address), 0)

    def test_signing_and_verifying_message(self):
        wallet = Wallet()
        message = "Vorliq test message"

        signature = wallet.sign(message)

        self.assertTrue(signature)
        self.assertTrue(wallet.verify_signature(message, signature, wallet.public_key_pem()))

    def test_verifying_signature_with_different_public_key_fails(self):
        wallet = Wallet()
        other_wallet = Wallet()
        message = "Vorliq test message"
        signature = wallet.sign(message)

        self.assertFalse(wallet.verify_signature(message, signature, other_wallet.public_key_pem()))


if __name__ == "__main__":
    unittest.main()
