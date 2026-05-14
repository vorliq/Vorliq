import unittest
from unittest.mock import patch

from wallet import Wallet, ripemd160


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

    def test_ripemd160_fallback_matches_known_vector(self):
        def unsupported_hash(name):
            if name == "ripemd160":
                raise ValueError("unsupported hash type ripemd160")
            raise AssertionError(f"unexpected hash requested: {name}")

        with patch("hashlib.new", side_effect=unsupported_hash):
            digest = ripemd160(b"abc")

        self.assertEqual(digest.hex(), "8eb208f7e05d987a9b044a8e98c6b087f15a0bfc")


if __name__ == "__main__":
    unittest.main()
