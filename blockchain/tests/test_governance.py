import tempfile
import time
import unittest
from unittest.mock import patch

from blockchain import Blockchain
from governance import Governance
from storage import Storage
from transaction import SYSTEM_ADDRESS, Transaction


def mine_now(blockchain, miner="miner"):
    next_timestamp = blockchain.get_latest_block().timestamp + blockchain.BLOCK_TIME_MINIMUM + 1
    with patch("blockchain.time.time", return_value=next_timestamp), patch("block.time.time", return_value=next_timestamp):
        return blockchain.mine_pending_transactions(miner)


def fund(blockchain, address, amount=1000):
    blockchain.add_pending_transaction(Transaction(SYSTEM_ADDRESS, address, amount))
    mine_now(blockchain)


class GovernanceLifecycleTests(unittest.TestCase):
    def test_proposal_starts_active(self):
        blockchain = Blockchain()
        fund(blockchain, "proposer")
        governance = Governance()

        proposal_id = governance.create_proposal(
            "proposer",
            "Lower reward",
            "Reduce the reward so emissions slow down in the test network.",
            "mining_reward",
            25,
            blockchain,
        )

        proposal = governance.get_proposal(proposal_id)
        self.assertEqual(proposal["status"], "active")
        self.assertEqual(proposal["status_history"][0]["status"], "active")

    def test_passing_vote_moves_to_pending_then_executed_when_safe(self):
        blockchain = Blockchain()
        fund(blockchain, "proposer")
        governance = Governance()
        proposal_id = governance.create_proposal(
            "proposer",
            "Reward update",
            "Change the mining reward to a safer test value.",
            "mining_reward",
            20,
            blockchain,
        )

        proposal = governance.vote_on_proposal(proposal_id, "voter", "yes", 600, blockchain)

        self.assertEqual(proposal["status"], "executed")
        self.assertEqual(blockchain.mining_reward, 20)
        self.assertTrue(
            any(entry["status"] == "passed_pending_execution" for entry in proposal["status_history"])
        )
        self.assertTrue(proposal["rule_change_id"])

    def test_rule_change_record_is_created(self):
        blockchain = Blockchain()
        fund(blockchain, "proposer")
        governance = Governance()
        proposal_id = governance.create_proposal(
            "proposer",
            "Difficulty update",
            "Change difficulty within the allowed range.",
            "difficulty",
            3,
            blockchain,
        )

        governance.vote_on_proposal(proposal_id, "voter", "yes", 600, blockchain)
        rule_change = governance.get_rule_changes()[0]

        self.assertEqual(rule_change["proposal_id"], proposal_id)
        self.assertEqual(rule_change["category"], "difficulty")
        self.assertEqual(rule_change["old_value"], 4)
        self.assertEqual(rule_change["new_value"], 3)

    def test_mining_reward_validation_rejects_unsafe_values(self):
        blockchain = Blockchain()
        fund(blockchain, "proposer")
        governance = Governance()

        with self.assertRaises(ValueError):
            governance.create_proposal(
                "proposer",
                "Unsafe reward",
                "This reward is intentionally outside the safe configured range.",
                "mining_reward",
                5000,
                blockchain,
            )

    def test_difficulty_validation_rejects_unsafe_values(self):
        blockchain = Blockchain()
        fund(blockchain, "proposer")
        governance = Governance()

        with self.assertRaises(ValueError):
            governance.create_proposal(
                "proposer",
                "Unsafe difficulty",
                "This difficulty is intentionally outside the safe configured range.",
                "difficulty",
                20,
                blockchain,
            )

    def test_general_proposal_does_not_auto_change_settings(self):
        blockchain = Blockchain()
        fund(blockchain, "proposer")
        governance = Governance()
        proposal_id = governance.create_proposal(
            "proposer",
            "Community guidance",
            "Ask the community to discuss an advisory direction only.",
            "general",
            "Advisory discussion",
            blockchain,
        )

        proposal = governance.vote_on_proposal(proposal_id, "voter", "yes", 600, blockchain)

        self.assertEqual(proposal["status"], "executed")
        self.assertFalse(proposal["execution_result"]["changed"])
        self.assertEqual(governance.get_rule_changes(), [])

    def test_cancel_only_proposer_before_votes(self):
        blockchain = Blockchain()
        fund(blockchain, "proposer")
        governance = Governance()
        proposal_id = governance.create_proposal(
            "proposer",
            "Cancel me",
            "This proposal should be cancellable before any vote is cast.",
            "exchange_limit",
            8,
            blockchain,
        )

        with self.assertRaises(ValueError):
            governance.cancel_proposal(proposal_id, "other")

        proposal = governance.cancel_proposal(proposal_id, "proposer")
        self.assertEqual(proposal["status"], "cancelled")

    def test_cancel_rejects_after_votes(self):
        blockchain = Blockchain()
        fund(blockchain, "proposer")
        governance = Governance()
        proposal_id = governance.create_proposal(
            "proposer",
            "Do not cancel after voting",
            "This proposal receives a vote below quorum and then cannot be cancelled.",
            "exchange_limit",
            8,
            blockchain,
        )
        governance.vote_on_proposal(proposal_id, "voter", "yes", 100, blockchain)

        with self.assertRaises(ValueError):
            governance.cancel_proposal(proposal_id, "proposer")

    def test_expired_proposals_are_marked_expired(self):
        blockchain = Blockchain()
        fund(blockchain, "proposer")
        governance = Governance()
        proposal_id = governance.create_proposal(
            "proposer",
            "Expire me",
            "This proposal is intentionally aged past its voting deadline.",
            "exchange_limit",
            8,
            blockchain,
        )
        governance.proposals[proposal_id]["voting_deadline"] = time.time() - 1

        changed = governance.expire_proposals()

        self.assertTrue(changed)
        self.assertEqual(governance.get_proposal(proposal_id)["status"], "expired")

    def test_legacy_passed_proposal_compatibility(self):
        governance = Governance()
        governance.proposals["legacy"] = {
            "proposal_id": "legacy",
            "proposer_address": "proposer",
            "title": "Legacy",
            "description": "Legacy proposal",
            "category": "mining_reward",
            "parameter": 25,
            "timestamp": 1,
            "status": "passed",
            "votes": {},
        }

        proposal = governance.get_proposal("legacy")

        self.assertEqual(proposal["status"], "passed_pending_execution")

    def test_rule_changes_persist_and_reload(self):
        blockchain = Blockchain()
        fund(blockchain, "proposer")
        governance = Governance()
        proposal_id = governance.create_proposal(
            "proposer",
            "Reward persistence",
            "Change the reward and make sure the rule change is saved.",
            "mining_reward",
            15,
            blockchain,
        )
        governance.vote_on_proposal(proposal_id, "voter", "yes", 600, blockchain)

        with tempfile.TemporaryDirectory() as data_dir:
            storage = Storage(data_dir)
            storage.save_governance(governance)
            loaded = storage.load_governance()

        self.assertEqual(len(loaded.get_rule_changes()), 1)
        self.assertEqual(loaded.get_proposal(proposal_id)["status"], "executed")


if __name__ == "__main__":
    unittest.main()
