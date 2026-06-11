import json
import unittest
from unittest.mock import patch

from blockchain import Blockchain
from transaction import Transaction


def make_chain():
    blockchain = Blockchain()
    blockchain.difficulty = 1
    blockchain.proof_target = "0"
    return blockchain


def mine_after_cooldown(blockchain, miner, seconds=None):
    latest = blockchain.get_latest_block()
    next_timestamp = latest.timestamp + (seconds or blockchain.BLOCK_TIME_MINIMUM + 1)
    with patch("blockchain.time.time", return_value=next_timestamp), patch("block.time.time", return_value=next_timestamp):
        return blockchain.mine_pending_transactions(miner)


class MiningStatusTests(unittest.TestCase):
    def test_mining_status_returns_cooldown_correctly(self):
        blockchain = make_chain()
        blockchain.mine_pending_transactions("VLQ_MINER")

        status = blockchain.get_mining_status()

        self.assertFalse(status["can_mine_now"])
        self.assertGreater(status["seconds_until_next_allowed_block"], 0)
        self.assertEqual(status["reason_if_not"].startswith("Next block is allowed"), True)

    def test_mining_history_derives_seconds_since_previous_block(self):
        blockchain = make_chain()
        blockchain.mine_pending_transactions("VLQ_MINER_A")
        mine_after_cooldown(blockchain, "VLQ_MINER_B", 45)

        history = blockchain.get_mining_history(limit=10, offset=0)

        self.assertEqual(history["total"], 2)
        self.assertEqual(history["history"][0]["block_index"], 2)
        self.assertGreaterEqual(history["history"][0]["seconds_since_previous_block"], 30)

    def test_reward_split_values_are_public_and_correct(self):
        blockchain = make_chain()
        status = blockchain.get_mining_status()

        self.assertEqual(status["current_mining_reward"], 50)
        self.assertEqual(status["miner_reward_after_treasury"], 47.5)
        self.assertEqual(status["treasury_reward_per_block"], 2.5)

    def test_mining_status_does_not_expose_private_fields(self):
        blockchain = make_chain()
        blockchain.add_pending_transaction(
            Transaction(
                "SYSTEM",
                "VLQ_PUBLIC",
                1,
                metadata={"private_key": "hidden", "message": "safe"},
            )
        )

        payload = json.dumps(blockchain.get_mining_status()).lower()

        self.assertNotIn("private_key", payload)
        self.assertNotIn("hidden", payload)


if __name__ == "__main__":
    unittest.main()
