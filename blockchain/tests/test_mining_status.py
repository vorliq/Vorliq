import json
import time
import unittest

from blockchain import Blockchain
from transaction import Transaction


def make_chain():
    blockchain = Blockchain()
    blockchain.difficulty = 1
    blockchain.proof_target = "0"
    return blockchain


def make_ready(blockchain, seconds=None):
    latest = blockchain.get_latest_block()
    latest.timestamp = time.time() - (seconds or blockchain.BLOCK_TIME_MINIMUM + 1)
    latest.nonce = 0
    latest.proof_of_work(latest.difficulty)


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
        make_ready(blockchain, 45)
        blockchain.mine_pending_transactions("VLQ_MINER_B")

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
