from __future__ import annotations

import hashlib
import time
from typing import Any

from logger import vorliq_logger
from transaction import TREASURY_ADDRESS, Transaction


class Treasury:
    VALID_CATEGORIES = {"development", "marketing", "community", "infrastructure"}
    QUORUM = 200.0
    APPROVAL_THRESHOLD = 0.60
    VOTING_PERIOD_SECONDS = 14 * 24 * 60 * 60

    def __init__(self, blockchain: Any | None = None) -> None:
        self.blockchain = blockchain
        self.proposals: dict[str, dict[str, Any]] = {}

    def create_proposal(
        self,
        proposer_address: str,
        title: str,
        description: str,
        category: str,
        requested_amount: float,
        recipient_address: str,
        current_blockchain: Any | None = None,
    ) -> str:
        blockchain = self._blockchain(current_blockchain)
        proposer_address = self._require_text(proposer_address, "proposer address")
        title = self._require_text(title, "title")
        description = self._require_text(description, "description")
        category = self._normalize_category(category)
        recipient_address = self._require_text(recipient_address, "recipient address")
        requested_amount = float(requested_amount)

        if requested_amount <= 0:
            raise ValueError("requested amount must be greater than zero")
        if requested_amount > self.get_treasury_balance(blockchain):
            raise ValueError("requested amount exceeds the current treasury balance")
        if blockchain.get_balance(proposer_address) <= 0:
            raise ValueError("only VLQ holders can create treasury proposals")

        timestamp = time.time()
        proposal_id = hashlib.sha256(
            f"{proposer_address}{title}{recipient_address}{timestamp}".encode("utf-8")
        ).hexdigest()
        self.proposals[proposal_id] = {
            "proposal_id": proposal_id,
            "proposer_address": proposer_address,
            "title": title,
            "description": description,
            "category": category,
            "requested_amount": requested_amount,
            "recipient_address": recipient_address,
            "timestamp": timestamp,
            "voting_deadline": timestamp + self.VOTING_PERIOD_SECONDS,
            "status": "active",
            "yes_vote_weight": 0.0,
            "no_vote_weight": 0.0,
            "votes": {},
            "quorum": self.QUORUM,
            "approval_threshold": self.APPROVAL_THRESHOLD,
        }
        vorliq_logger.info("Treasury proposal %s created for %s VLQ", proposal_id, requested_amount)
        return proposal_id

    def vote_on_proposal(
        self,
        proposal_id: str,
        voter_address: str,
        vote: str,
        voter_balance: float,
        current_blockchain: Any | None = None,
    ) -> dict[str, Any]:
        proposal = self._get_active_proposal(proposal_id)
        voter_address = self._require_text(voter_address, "voter address")
        vote = self._normalize_vote(vote)
        voter_balance = float(voter_balance)

        if time.time() > proposal["voting_deadline"]:
            proposal["status"] = "expired"
            raise ValueError("treasury proposal voting period has expired")
        if voter_address in proposal["votes"]:
            raise ValueError("voter has already voted on this treasury proposal")
        if voter_balance <= 0:
            raise ValueError("only VLQ holders can vote on treasury proposals")

        proposal["votes"][voter_address] = vote
        if vote == "yes":
            proposal["yes_vote_weight"] += voter_balance
        else:
            proposal["no_vote_weight"] += voter_balance

        vorliq_logger.info("Treasury proposal %s received %s vote from %s", proposal_id, vote, voter_address)
        self.check_proposal_outcome(proposal_id, current_blockchain)
        return proposal

    def check_proposal_outcome(self, proposal_id: str, current_blockchain: Any | None = None) -> dict[str, Any]:
        proposal = self._get_existing_proposal(proposal_id)
        if proposal["status"] != "active":
            return proposal

        total_weight = proposal["yes_vote_weight"] + proposal["no_vote_weight"]
        if total_weight < proposal["quorum"]:
            return proposal

        if proposal["yes_vote_weight"] / total_weight >= proposal["approval_threshold"]:
            return self.execute_proposal(proposal_id, current_blockchain)

        if proposal["no_vote_weight"] / total_weight > (1 - proposal["approval_threshold"]):
            proposal["status"] = "rejected"
            vorliq_logger.info("Treasury proposal %s was rejected", proposal_id)

        return proposal

    def execute_proposal(self, proposal_id: str, current_blockchain: Any | None = None) -> dict[str, Any]:
        blockchain = self._blockchain(current_blockchain)
        proposal = self._get_existing_proposal(proposal_id)
        if proposal["status"] != "active":
            raise ValueError("only active treasury proposals can be executed")
        if proposal["requested_amount"] > self.get_treasury_balance(blockchain):
            raise ValueError("treasury no longer has enough VLQ for this proposal")

        transaction = Transaction(
            sender_address=TREASURY_ADDRESS,
            receiver_address=proposal["recipient_address"],
            amount=proposal["requested_amount"],
        )
        blockchain.add_pending_transaction(transaction)
        proposal["status"] = "passed"
        proposal["executed_timestamp"] = time.time()
        vorliq_logger.info("Treasury proposal %s passed and queued %s VLQ", proposal_id, proposal["requested_amount"])
        return proposal

    def expire_proposals(self, current_timestamp: float | None = None) -> bool:
        current_timestamp = time.time() if current_timestamp is None else current_timestamp
        changed = False
        for proposal in self.proposals.values():
            if proposal.get("status") == "active" and current_timestamp > proposal.get("voting_deadline", 0):
                proposal["status"] = "expired"
                changed = True
        return changed

    def get_all_proposals(self) -> list[dict[str, Any]]:
        return sorted(self.proposals.values(), key=lambda proposal: proposal.get("timestamp", 0), reverse=True)

    def get_active_proposals(self) -> list[dict[str, Any]]:
        self.expire_proposals()
        return [proposal for proposal in self.get_all_proposals() if proposal.get("status") == "active"]

    def get_treasury_balance(self, blockchain: Any | None = None) -> float:
        return self._blockchain(blockchain).get_treasury_balance()

    def get_proposal(self, proposal_id: str) -> dict[str, Any] | None:
        return self.proposals.get(proposal_id)

    def _blockchain(self, blockchain: Any | None = None) -> Any:
        blockchain = blockchain or self.blockchain
        if blockchain is None:
            raise ValueError("blockchain is required")
        return blockchain

    def _get_existing_proposal(self, proposal_id: str) -> dict[str, Any]:
        proposal_id = self._require_text(proposal_id, "proposal ID")
        proposal = self.proposals.get(proposal_id)
        if not proposal:
            raise ValueError("treasury proposal does not exist")
        return proposal

    def _get_active_proposal(self, proposal_id: str) -> dict[str, Any]:
        proposal = self._get_existing_proposal(proposal_id)
        if proposal.get("status") != "active":
            raise ValueError("treasury proposal is not active")
        return proposal

    def _normalize_category(self, category: str) -> str:
        category = self._require_text(category, "category").lower()
        if category not in self.VALID_CATEGORIES:
            raise ValueError("category must be development, marketing, community, or infrastructure")
        return category

    def _normalize_vote(self, vote: str) -> str:
        vote = self._require_text(vote, "vote").lower()
        if vote not in {"yes", "no"}:
            raise ValueError("vote must be yes or no")
        return vote

    def _require_text(self, value: str, field_name: str) -> str:
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"{field_name} must be a non-empty string")
        return value.strip()
