import hashlib
import json
import unittest

from block import Block


class BlockTests(unittest.TestCase):
    def test_block_calculates_hash_correctly(self):
        block = Block(
            index=1,
            transactions=[],
            previous_hash="previous-hash",
            timestamp=1234567890.0,
            nonce=7,
        )
        expected_data = {
            "index": 1,
            "timestamp": 1234567890.0,
            "transactions": [],
            "previous_hash": "previous-hash",
            "nonce": 7,
        }
        expected_hash = hashlib.sha256(
            json.dumps(expected_data, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()

        self.assertEqual(block.calculate_hash(), expected_hash)

    def test_changing_any_field_changes_hash(self):
        block = Block(
            index=1,
            transactions=[],
            previous_hash="previous-hash",
            timestamp=1234567890.0,
            nonce=7,
        )
        original_hash = block.calculate_hash()

        block.index = 2
        self.assertNotEqual(block.calculate_hash(), original_hash)
        block.index = 1

        block.timestamp = 1234567891.0
        self.assertNotEqual(block.calculate_hash(), original_hash)
        block.timestamp = 1234567890.0

        block.transactions = [{"sender_address": "a", "receiver_address": "b", "amount": 1}]
        self.assertNotEqual(block.calculate_hash(), original_hash)
        block.transactions = []

        block.previous_hash = "changed"
        self.assertNotEqual(block.calculate_hash(), original_hash)
        block.previous_hash = "previous-hash"

        block.nonce = 8
        self.assertNotEqual(block.calculate_hash(), original_hash)

    def test_proof_of_work_starts_with_four_zeros(self):
        block = Block(index=1, transactions=[], previous_hash="previous-hash")
        block.proof_of_work(4)

        self.assertTrue(block.hash.startswith("0000"))
        self.assertTrue(block.has_valid_proof(4))

    def test_identical_blocks_produce_identical_hashes(self):
        first = Block(
            index=3,
            transactions=[],
            previous_hash="same",
            timestamp=1000.0,
            nonce=12,
        )
        second = Block(
            index=3,
            transactions=[],
            previous_hash="same",
            timestamp=1000.0,
            nonce=12,
        )

        self.assertEqual(first.calculate_hash(), second.calculate_hash())


if __name__ == "__main__":
    unittest.main()
