from __future__ import annotations

from hashlib import sha256
import time
from typing import Any

from blockchain import Blockchain
from logger import vorliq_logger


class Governance:
    valid_categories = {
        "mining_reward",
        "difficulty",
        "loan_limit",
        "loan_interest",
        "exchange_limit",
        "general",
    }
    quorum = 500.0
    approval_threshold = 0.60
    voting_period_seconds = 7 * 24 * 60 * 60

    def __init__(self) -> None:
        self.proposals: dict[str, dict[str, Any]] = {}
        self.governance_settings: dict[str, dict[str, Any]] = {
            "mining_reward": {"default": 50.0, "current": 50.0, "changed": False},
            "difficulty": {"default": 4, "current": 4, "changed": False},
            "loan_limit": {"default": 10000.0, "current": 10000.0, "changed": False},
            "loan_interest": {"default": 0.10, "current": 0.10, "changed": False},
            "exchange_limit": {"default": 5, "current": 5, "changed": False},
        }

    def create_proposal(
        self,
        proposer_address: str,
        title: str,
        description: str,
        category: str,
        parameter_value: Any,
        current_blockchain: Blockchain,
    ) -> str:
        proposer_address = self._require_text(proposer_address, "proposer address")
        title = self._require_text(title, "title")
        description = self._require_text(description, "description")
        category = self._require_text(category, "category").lower()

        if category not in self.valid_categories:
            raise ValueError("proposal category is not valid")

        if current_blockchain.get_balance(proposer_address) <= 0:
            raise ValueError("only VLQ holders can create governance proposals")

        active_count = sum(
            1
            for proposal in self.proposals.values()
            if proposal["proposer_address"] == proposer_address and proposal["status"] == "active"
        )
        if active_count >= 3:
            raise ValueError("proposer cannot have more than three active proposals")

        timestamp = time.time()
        proposal_id = sha256(f"{proposer_address}:{title}:{timestamp}".encode("utf-8")).hexdigest()
        current_value = self._current_value_for_category(category, current_blockchain)

        self.proposals[proposal_id] = {
            "proposal_id": proposal_id,
            "proposer_address": proposer_address,
            "title": title[:100],
            "description": description,
            "category": category,
            "parameter": self._normalize_parameter(category, parameter_value),
            "current_value": current_value,
            "timestamp": timestamp,
            "voting_deadline": timestamp + self.voting_period_seconds,
            "status": "active",
            "votes": {},
            "yes_vote_weight": 0.0,
            "no_vote_weight": 0.0,
            "quorum": self.quorum,
            "approval_threshold": self.approval_threshold,
            "passed_timestamp": None,
        }

        vorliq_logger.info("Governance proposal %s created by %s", proposal_id, proposer_address)
        return proposal_id

    def vote_on_proposal(
        self,
        proposal_id: str,
        voter_address: str,
        vote: str,
        voter_vlq_balance: float,
        current_blockchain: Blockchain,
    ) -> dict[str, Any]:
        proposal = self._get_existing_proposal(proposal_id)
        voter_address = self._require_text(voter_address, "voter address")
        vote = self._require_text(vote, "vote").lower()
        voter_vlq_balance = float(voter_vlq_balance)

        if proposal["status"] != "active":
            raise ValueError("proposal is no longer active")

        if time.time() >= proposal["voting_deadline"]:
            proposal["status"] = "expired"
            raise ValueError("proposal voting deadline has passed")

        if vote not in {"yes", "no"}:
            raise ValueError("vote must be yes or no")

        if voter_address in proposal["votes"]:
            raise ValueError("voter has already voted on this proposal")

        if voter_vlq_balance <= 0:
            raise ValueError("only VLQ holders with a positive balance can vote")

        proposal["votes"][voter_address] = vote
        if vote == "yes":
            proposal["yes_vote_weight"] += voter_vlq_balance
        else:
            proposal["no_vote_weight"] += voter_vlq_balance

        vorliq_logger.info(
            "Governance vote cast on %s by %s: %s with weight %s",
            proposal_id,
            voter_address,
            vote,
            voter_vlq_balance,
        )
        self.check_proposal_outcome(proposal_id, current_blockchain)
        return proposal

    def check_proposal_outcome(self, proposal_id: str, current_blockchain: Blockchain) -> dict[str, Any]:
        proposal = self._get_existing_proposal(proposal_id)

        if proposal["status"] != "active":
            return proposal

        yes_weight = float(proposal["yes_vote_weight"])
        no_weight = float(proposal["no_vote_weight"])
        total_weight = yes_weight + no_weight

        if total_weight < float(proposal["quorum"]):
            return proposal

        yes_ratio = yes_weight / total_weight
        no_ratio = no_weight / total_weight

        if yes_ratio >= float(proposal["approval_threshold"]):
            return self.apply_proposal(proposal_id, current_blockchain)

        if no_ratio > (1 - float(proposal["approval_threshold"])):
            proposal["status"] = "rejected"
            vorliq_logger.info("Governance proposal %s rejected", proposal_id)

        return proposal

    def apply_proposal(self, proposal_id: str, current_blockchain: Blockchain) -> dict[str, Any]:
        proposal = self._get_existing_proposal(proposal_id)

        if proposal["status"] != "active":
            return proposal

        category = proposal["category"]
        parameter = proposal["parameter"]
        proposal["status"] = "passed"
        proposal["passed_timestamp"] = time.time()

        if category == "mining_reward":
            current_blockchain.mining_reward = float(parameter)
            current_blockchain.initial_mining_reward = float(parameter)
            self._update_setting("mining_reward", float(parameter))
            vorliq_logger.info("Governance applied mining reward change to %s VLQ", parameter)
        elif category == "difficulty":
            current_blockchain.difficulty = int(parameter)
            current_blockchain.proof_target = "0" * int(parameter)
            self._update_setting("difficulty", int(parameter))
            vorliq_logger.info("Governance applied difficulty change to %s", parameter)
        elif category == "loan_limit":
            self._update_setting("loan_limit", float(parameter))
            vorliq_logger.info("Governance applied loan limit setting change to %s", parameter)
        elif category == "loan_interest":
            self._update_setting("loan_interest", float(parameter))
            vorliq_logger.info("Governance applied loan interest setting change to %s", parameter)
        elif category == "exchange_limit":
            self._update_setting("exchange_limit", int(parameter))
            vorliq_logger.info("Governance applied exchange limit setting change to %s", parameter)
        else:
            vorliq_logger.info("Governance general proposal %s passed", proposal_id)

        return proposal

    def expire_proposals(self, current_timestamp: float | None = None) -> bool:
        current_timestamp = current_timestamp or time.time()
        changed = False

        for proposal in self.proposals.values():
            if proposal["status"] == "active" and current_timestamp >= proposal["voting_deadline"]:
                proposal["status"] = "expired"
                changed = True
                vorliq_logger.info("Governance proposal %s expired", proposal["proposal_id"])

        return changed

    def get_active_proposals(self) -> list[dict[str, Any]]:
        return sorted(
            [proposal for proposal in self.proposals.values() if proposal["status"] == "active"],
            key=lambda proposal: proposal["timestamp"],
            reverse=True,
        )

    def get_all_proposals(self) -> list[dict[str, Any]]:
        return sorted(
            self.proposals.values(),
            key=lambda proposal: proposal["timestamp"],
            reverse=True,
        )

    def get_proposal(self, proposal_id: str) -> dict[str, Any] | None:
        return self.proposals.get(proposal_id)

    def get_governance_settings(self) -> dict[str, dict[str, Any]]:
        return self.governance_settings

    def _get_existing_proposal(self, proposal_id: str) -> dict[str, Any]:
        proposal_id = self._require_text(proposal_id, "proposal ID")
        proposal = self.get_proposal(proposal_id)
        if not proposal:
            raise ValueError("proposal does not exist")
        return proposal

    def _current_value_for_category(self, category: str, current_blockchain: Blockchain) -> Any:
        if category == "mining_reward":
            return float(getattr(current_blockchain, "mining_reward", current_blockchain.initial_mining_reward))
        if category == "difficulty":
            return int(current_blockchain.difficulty)
        if category in self.governance_settings:
            return self.governance_settings[category]["current"]
        return "general"

    def _normalize_parameter(self, category: str, parameter_value: Any) -> Any:
        if category in {"mining_reward", "loan_limit", "loan_interest"}:
            return float(parameter_value)
        if category in {"difficulty", "exchange_limit"}:
            value = int(parameter_value)
            if value <= 0:
                raise ValueError("parameter value must be greater than zero")
            return value
        return self._require_text(str(parameter_value), "parameter")

    def _update_setting(self, category: str, value: Any) -> None:
        if category not in self.governance_settings:
            return
        self.governance_settings[category]["current"] = value
        self.governance_settings[category]["changed"] = (
            self.governance_settings[category]["current"] != self.governance_settings[category]["default"]
        )

    def _require_text(self, value: str, field_name: str) -> str:
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"{field_name} is required")
        return value.strip()
