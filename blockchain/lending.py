from __future__ import annotations

from hashlib import sha256
import time
from typing import Any

from blockchain import Blockchain
from logger import vorliq_logger
from transaction import LENDING_POOL_ADDRESS, Transaction


class LendingPool:
    maximum_loan_amount = 10_000.0
    voting_threshold = 100.0
    repayment_interest_rate = 0.10
    repayment_blocks = 1_000

    def __init__(self, blockchain: Blockchain | None = None) -> None:
        self.blockchain = blockchain
        self.loan_requests: dict[str, dict[str, Any]] = {}

    def create_loan_request(self, requester_address: str, amount: float, reason: str) -> str:
        requester_address = self._require_text(requester_address, "requester address")
        reason = self._require_text(reason, "reason")
        amount = float(amount)

        if amount <= 0:
            raise ValueError("loan amount must be greater than zero")

        if amount > self.maximum_loan_amount:
            raise ValueError("loan amount cannot be greater than 10000 VLQ")

        for loan in self.loan_requests.values():
            if loan["requester_address"] == requester_address and loan["status"] in {"pending", "approved"}:
                raise ValueError("requester already has an active pending or approved loan")

        timestamp = time.time()
        loan_id = sha256(f"{requester_address}:{timestamp}".encode()).hexdigest()
        current_height = self.blockchain.get_block_height() if self.blockchain else 0

        self.loan_requests[loan_id] = {
            "loan_id": loan_id,
            "requester_address": requester_address,
            "amount": amount,
            "reason": reason,
            "timestamp": timestamp,
            "status": "pending",
            "votes": {},
            "yes_vote_weight": 0.0,
            "no_vote_weight": 0.0,
            "repayment_amount": round(amount * (1 + self.repayment_interest_rate), 8),
            "due_block": current_height + self.repayment_blocks,
        }

        vorliq_logger.info(
            "Loan request created by %s for %s VLQ with loan ID %s",
            requester_address,
            amount,
            loan_id,
        )
        return loan_id

    def vote_on_loan(
        self,
        loan_id: str,
        voter_address: str,
        vote: str,
        voter_vlq_balance: float,
    ) -> dict[str, Any]:
        loan = self._get_existing_loan(loan_id)
        voter_address = self._require_text(voter_address, "voter address")
        vote = self._require_text(vote, "vote").lower()
        voter_vlq_balance = float(voter_vlq_balance)

        if loan["status"] != "pending":
            raise ValueError("loan is no longer pending")

        if vote not in {"yes", "no"}:
            raise ValueError("vote must be yes or no")

        if voter_address in loan["votes"]:
            raise ValueError("voter has already voted on this loan")

        if voter_vlq_balance <= 0:
            raise ValueError("only VLQ holders with a positive balance can vote")

        loan["votes"][voter_address] = vote
        vorliq_logger.info(
            "Loan vote cast on %s by %s: %s with weight %s",
            loan_id,
            voter_address,
            vote,
            voter_vlq_balance,
        )

        if vote == "yes":
            loan["yes_vote_weight"] += voter_vlq_balance
        else:
            loan["no_vote_weight"] += voter_vlq_balance

        if self.blockchain:
            self.check_loan_outcome(loan_id, self.blockchain)

        return loan

    def check_loan_outcome(self, loan_id: str, current_blockchain: Blockchain) -> dict[str, Any]:
        loan = self._get_existing_loan(loan_id)

        if loan["status"] != "pending":
            return loan

        yes_weight = float(loan["yes_vote_weight"])
        no_weight = float(loan["no_vote_weight"])
        total_weight = yes_weight + no_weight

        if total_weight < self.voting_threshold:
            return loan

        if yes_weight > no_weight:
            return self.approve_loan(loan_id, current_blockchain)

        if no_weight > yes_weight:
            loan["status"] = "rejected"
            vorliq_logger.info("Loan %s rejected with yes weight %s and no weight %s", loan_id, yes_weight, no_weight)

        return loan

    def approve_loan(self, loan_id: str, current_blockchain: Blockchain) -> dict[str, Any]:
        loan = self._get_existing_loan(loan_id)

        if loan["status"] != "pending":
            return loan

        loan["status"] = "approved"
        vorliq_logger.info("Loan %s approved for %s VLQ", loan_id, loan["amount"])
        issuance_transaction = Transaction(
            sender_address=LENDING_POOL_ADDRESS,
            receiver_address=loan["requester_address"],
            amount=loan["amount"],
        )
        current_blockchain.add_pending_transaction(issuance_transaction)
        return loan

    def repay_loan(
        self,
        loan_id: str,
        repayer_address: str,
        current_blockchain: Blockchain,
    ) -> dict[str, Any]:
        loan = self._get_existing_loan(loan_id)
        repayer_address = self._require_text(repayer_address, "repayer address")

        if loan["status"] != "approved":
            raise ValueError("loan must be approved before it can be repaid")

        if repayer_address != loan["requester_address"]:
            raise ValueError("only the original requester can repay this loan")

        repayment_transaction = Transaction(
            sender_address=repayer_address,
            receiver_address=LENDING_POOL_ADDRESS,
            amount=loan["repayment_amount"],
        )
        current_blockchain.add_pending_transaction(repayment_transaction)
        loan["status"] = "repaid"
        vorliq_logger.info("Loan %s repaid by %s for %s VLQ", loan_id, repayer_address, loan["repayment_amount"])
        return loan

    def get_all_loans(self) -> list[dict[str, Any]]:
        return sorted(
            self.loan_requests.values(),
            key=lambda loan: loan["timestamp"],
            reverse=True,
        )

    def get_loan(self, loan_id: str) -> dict[str, Any] | None:
        return self.loan_requests.get(loan_id)

    def _get_existing_loan(self, loan_id: str) -> dict[str, Any]:
        loan_id = self._require_text(loan_id, "loan ID")
        loan = self.get_loan(loan_id)
        if not loan:
            raise ValueError("loan does not exist")
        return loan

    def _require_text(self, value: str, field_name: str) -> str:
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"{field_name} is required")
        return value.strip()
