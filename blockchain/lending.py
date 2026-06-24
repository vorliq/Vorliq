from __future__ import annotations

from hashlib import sha256
import os
import time
from typing import Any

from blockchain import Blockchain
from logger import vorliq_logger
from transaction import LENDING_POOL_ADDRESS, Transaction


def _vote_threshold_default() -> float:
    # The total VLQ-weighted votes a loan must gather before it is decided. A fixed
    # high value makes lending unusable on a young network where wallets hold tiny
    # balances (no loan can ever reach the threshold, so none is ever approved —
    # which is exactly why production saw zero lending activity). Making it
    # configurable lets an operator tune it to the network's stage without a code
    # change; the default stays at the original 100 VLQ.
    try:
        return max(0.0, float(os.environ.get("VORLIQ_LENDING_VOTE_THRESHOLD", "100")))
    except (TypeError, ValueError):
        return 100.0


class LendingPool:
    maximum_loan_amount = 10_000.0
    voting_threshold = _vote_threshold_default()
    repayment_interest_rate = 0.10
    repayment_blocks = 1_000
    lifecycle_statuses = {
        "pending_vote",
        "rejected",
        "approved_pending_issue",
        "active",
        "repayment_pending",
        "repaid",
        "overdue",
    }

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
            self.normalize_loan(loan)
            if loan["requester_address"] == requester_address and loan["status"] in {
                "pending_vote",
                "approved_pending_issue",
                "active",
                "repayment_pending",
                "overdue",
            }:
                raise ValueError("requester already has an active loan lifecycle")

        timestamp = time.time()
        loan_id = sha256(f"{requester_address}:{timestamp}".encode()).hexdigest()
        current_height = self.blockchain.get_block_height() if self.blockchain else 0

        self.loan_requests[loan_id] = {
            "loan_id": loan_id,
            "requester_address": requester_address,
            "amount": amount,
            "reason": reason,
            "timestamp": timestamp,
            "created_at": timestamp,
            "approved_at": None,
            "issued_at": None,
            "status": "pending_vote",
            "votes": {},
            "voters": {},
            "yes_vote_weight": 0.0,
            "no_vote_weight": 0.0,
            "repayment_amount": round(amount * (1 + self.repayment_interest_rate), 8),
            "due_block": current_height + self.repayment_blocks,
            "issuance_tx_id": None,
            "repayment_tx_id": None,
            "status_history": [
                {
                    "status": "pending_vote",
                    "timestamp": timestamp,
                    "message": "Loan request opened for community voting.",
                }
            ],
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

        if loan["status"] != "pending_vote":
            raise ValueError("loan is no longer open for voting")

        if vote not in {"yes", "no"}:
            raise ValueError("vote must be yes or no")

        if voter_address in loan["votes"]:
            raise ValueError("voter has already voted on this loan")

        if voter_vlq_balance <= 0:
            raise ValueError("only VLQ holders with a positive balance can vote")

        vote_record = {
            "vote": vote,
            "weight": voter_vlq_balance,
            "timestamp": time.time(),
        }
        loan["votes"][voter_address] = vote
        loan["voters"][voter_address] = vote_record
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

        return self.public_loan(loan)

    def check_loan_outcome(self, loan_id: str, current_blockchain: Blockchain) -> dict[str, Any]:
        loan = self._get_existing_loan(loan_id)

        if loan["status"] != "pending_vote":
            return self.public_loan(loan)

        yes_weight = float(loan["yes_vote_weight"])
        no_weight = float(loan["no_vote_weight"])
        total_weight = yes_weight + no_weight

        if total_weight < self.voting_threshold:
            return self.public_loan(loan)

        if yes_weight > no_weight:
            return self.approve_loan(loan_id, current_blockchain)

        if no_weight > yes_weight:
            self._set_status(loan, "rejected", "Loan rejected by community vote.")
            vorliq_logger.info("Loan %s rejected with yes weight %s and no weight %s", loan_id, yes_weight, no_weight)

        return self.public_loan(loan)

    def approve_loan(self, loan_id: str, current_blockchain: Blockchain) -> dict[str, Any]:
        loan = self._get_existing_loan(loan_id)

        if loan["status"] != "pending_vote":
            return self.public_loan(loan)

        approved_at = time.time()
        loan["approved_at"] = approved_at
        self._set_status(loan, "approved_pending_issue", "Loan approved. Issuance transaction is pending mining.", approved_at)
        issuance_transaction = Transaction(
            sender_address=LENDING_POOL_ADDRESS,
            receiver_address=loan["requester_address"],
            amount=loan["amount"],
            transaction_type="loan_issuance",
            category="lending",
            metadata={"loan_id": loan_id, "message": "Loan issuance"},
        )
        current_blockchain.add_pending_transaction(issuance_transaction)
        loan["issuance_tx_id"] = issuance_transaction.tx_id
        vorliq_logger.info("Loan %s approved pending issuance transaction %s", loan_id, issuance_transaction.tx_id)
        return self.public_loan(loan)

    def repay_loan(
        self,
        loan_id: str,
        repayer_address: str,
        current_blockchain: Blockchain,
    ) -> dict[str, Any]:
        loan = self._get_existing_loan(loan_id)
        repayer_address = self._require_text(repayer_address, "repayer address")
        self.sync_loan_statuses(current_blockchain)
        loan = self._get_existing_loan(loan_id)

        if loan["status"] not in {"active", "overdue"}:
            raise ValueError("loan must be active or overdue before it can be repaid")

        if loan.get("repayment_tx_id"):
            raise ValueError("loan already has a repayment transaction pending or confirmed")

        if repayer_address != loan["requester_address"]:
            raise ValueError("only the original requester can repay this loan")

        repayment_transaction = Transaction(
            sender_address=repayer_address,
            receiver_address=LENDING_POOL_ADDRESS,
            amount=loan["repayment_amount"],
            transaction_type="loan_repayment",
            category="lending",
            metadata={"loan_id": loan_id, "message": "Loan repayment"},
        )
        current_blockchain.add_pending_transaction(repayment_transaction)
        loan["repayment_tx_id"] = repayment_transaction.tx_id
        self._set_status(loan, "repayment_pending", "Repayment transaction submitted and waiting for mining.")
        vorliq_logger.info("Loan %s repayment submitted by %s for %s VLQ", loan_id, repayer_address, loan["repayment_amount"])
        return self.public_loan(loan)

    def sync_loan_statuses(self, blockchain: Blockchain | None = None) -> bool:
        chain = blockchain or self.blockchain
        if chain is None:
            for loan in self.loan_requests.values():
                self.normalize_loan(loan)
            return False

        changed = False
        current_height = chain.get_block_height()
        for loan in self.loan_requests.values():
            before = (
                loan.get("status"),
                loan.get("issued_at"),
                loan.get("repayment_confirmed_at"),
                loan.get("due_block"),
            )
            self.normalize_loan(loan)

            issuance_tx_id = loan.get("issuance_tx_id")
            if loan["status"] == "approved_pending_issue" and issuance_tx_id:
                issuance = chain.get_transaction_detail(issuance_tx_id)
                if issuance and issuance.get("status") == "confirmed":
                    loan["issued_at"] = issuance.get("timestamp") or time.time()
                    loan["issued_block"] = issuance.get("block_index")
                    loan["due_block"] = int(issuance.get("block_index") or current_height) + self.repayment_blocks
                    self._set_status(loan, "active", "Issuance transaction confirmed. Loan is active.")

            repayment_tx_id = loan.get("repayment_tx_id")
            if loan["status"] in {"repayment_pending", "overdue"} and repayment_tx_id:
                repayment = chain.get_transaction_detail(repayment_tx_id)
                if repayment and repayment.get("status") == "confirmed":
                    loan["repaid_at"] = repayment.get("timestamp") or time.time()
                    loan["repayment_confirmed_at"] = loan["repaid_at"]
                    loan["repaid_block"] = repayment.get("block_index")
                    self._set_status(loan, "repaid", "Repayment transaction confirmed.")

            if loan["status"] in {"active", "repayment_pending"} and loan.get("due_block") is not None:
                if current_height > int(loan["due_block"]):
                    self._set_status(loan, "overdue", "Loan is past its due block.")

            self._decorate_loan(loan, current_height)
            after = (
                loan.get("status"),
                loan.get("issued_at"),
                loan.get("repayment_confirmed_at"),
                loan.get("due_block"),
            )
            changed = changed or before != after

        return changed

    def get_all_loans(
        self,
        status: str | None = None,
        address: str | None = None,
        limit: int | None = None,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        self.sync_loan_statuses()
        status = status.strip().lower() if isinstance(status, str) and status.strip() else None
        address = address.strip() if isinstance(address, str) and address.strip() else None
        if status and status not in self.lifecycle_statuses:
            raise ValueError("status is not valid")
        loans = [self.public_loan(loan) for loan in self.loan_requests.values()]
        if status:
            loans = [loan for loan in loans if loan["status"] == status]
        if address:
            loans = [
                loan for loan in loans
                if loan.get("requester_address") == address or address in loan.get("votes", {})
            ]
        loans = sorted(loans, key=lambda loan: float(loan.get("timestamp") or 0), reverse=True)
        if limit is None:
            return loans
        return loans[offset : offset + limit]

    def count_loans(self, status: str | None = None, address: str | None = None) -> int:
        return len(self.get_all_loans(status=status, address=address))

    def get_loan(self, loan_id: str) -> dict[str, Any] | None:
        loan = self.loan_requests.get(loan_id)
        if not loan:
            return None
        return self.public_loan(loan)

    def get_my_loans(self, address: str) -> dict[str, Any]:
        address = self._require_text(address, "address")
        loans = self.get_all_loans(address=address)
        return {
            "borrowed": [loan for loan in loans if loan.get("requester_address") == address],
            "voted": [loan for loan in loans if address in loan.get("votes", {})],
            "loans": loans,
        }

    def get_summary(self) -> dict[str, Any]:
        loans = self.get_all_loans()
        counts = {status: len([loan for loan in loans if loan["status"] == status]) for status in self.lifecycle_statuses}
        return {
            "total_loans": len(loans),
            "voting_threshold": self.voting_threshold,
            "repayment_interest_rate": self.repayment_interest_rate,
            "pending_vote_count": counts["pending_vote"],
            "approved_pending_issue_count": counts["approved_pending_issue"],
            "active_count": counts["active"],
            "repaid_count": counts["repaid"],
            "overdue_count": counts["overdue"],
            "rejected_count": counts["rejected"],
            "repayment_pending_count": counts["repayment_pending"],
            "total_vlq_requested": sum(float(loan.get("amount") or 0) for loan in loans),
            "total_vlq_active": sum(float(loan.get("amount") or 0) for loan in loans if loan["status"] in {"active", "overdue", "repayment_pending"}),
            "total_vlq_repaid": sum(float(loan.get("repayment_amount") or 0) for loan in loans if loan["status"] == "repaid"),
            "upcoming_due_loans_count": len([
                loan for loan in loans
                if loan["status"] in {"active", "repayment_pending"} and not loan.get("is_overdue") and (loan.get("blocks_until_due") or 0) <= 100
            ]),
        }

    def public_loan(self, loan: dict[str, Any]) -> dict[str, Any]:
        self.normalize_loan(loan)
        current_height = self.blockchain.get_block_height() if self.blockchain else 0
        self._decorate_loan(loan, current_height)
        return dict(loan)

    def normalize_loan(self, loan: dict[str, Any]) -> dict[str, Any]:
        loan_id = loan.get("loan_id")
        old_status = str(loan.get("status") or "pending_vote")
        mapped_status = self._map_status(loan)
        loan["status"] = mapped_status
        timestamp = float(loan.get("timestamp") or loan.get("created_at") or time.time())
        loan.setdefault("timestamp", timestamp)
        loan.setdefault("created_at", timestamp)
        loan.setdefault("approved_at", loan.get("approved_timestamp"))
        loan.setdefault("issued_at", loan.get("issued_timestamp"))
        loan.setdefault("issuance_tx_id", loan.get("issue_tx_id"))
        loan.setdefault("repayment_tx_id", loan.get("repay_tx_id"))
        loan.setdefault("votes", {})
        loan.setdefault("voters", {})
        loan.setdefault("yes_vote_weight", 0.0)
        loan.setdefault("no_vote_weight", 0.0)
        loan.setdefault("repayment_amount", round(float(loan.get("amount") or 0) * (1 + self.repayment_interest_rate), 8))
        current_height = self.blockchain.get_block_height() if self.blockchain else 0
        loan.setdefault("due_block", current_height + self.repayment_blocks)
        if "status_history" not in loan or not isinstance(loan.get("status_history"), list):
            loan["status_history"] = [
                {
                    "status": mapped_status,
                    "timestamp": timestamp,
                    "message": f"Legacy loan status {old_status} normalized to {mapped_status}.",
                }
            ]
        loan["loan_id"] = loan_id
        return loan

    def _map_status(self, loan: dict[str, Any]) -> str:
        status = str(loan.get("status") or "pending_vote").lower()
        if status == "pending":
            return "pending_vote"
        if status == "approved":
            return "active" if loan.get("issuance_tx_id") or loan.get("issued_at") else "approved_pending_issue"
        if status in self.lifecycle_statuses:
            return status
        return "pending_vote"

    def _decorate_loan(self, loan: dict[str, Any], current_height: int) -> None:
        due_block = loan.get("due_block")
        if due_block is not None:
            blocks_until_due = int(due_block) - int(current_height)
            loan["blocks_until_due"] = blocks_until_due
            loan["is_overdue"] = blocks_until_due < 0 and loan["status"] in {"active", "overdue", "repayment_pending"}
        else:
            loan["blocks_until_due"] = None
            loan["is_overdue"] = False
        loan["repayment_due_status"] = (
            "repaid" if loan["status"] == "repaid"
            else "overdue" if loan.get("is_overdue")
            else "pending_confirmation" if loan["status"] == "repayment_pending"
            else "not_due"
        )
        loan["repayment_progress"] = 100 if loan["status"] == "repaid" else (50 if loan.get("repayment_tx_id") else 0)

    def _set_status(self, loan: dict[str, Any], status: str, message: str, timestamp: float | None = None) -> None:
        timestamp = time.time() if timestamp is None else timestamp
        if loan.get("status") != status:
            loan["status"] = status
            loan.setdefault("status_history", []).append(
                {"status": status, "timestamp": timestamp, "message": message}
            )

    def _get_existing_loan(self, loan_id: str) -> dict[str, Any]:
        loan_id = self._require_text(loan_id, "loan ID")
        loan = self.loan_requests.get(loan_id)
        if not loan:
            raise ValueError("loan does not exist")
        return self.normalize_loan(loan)

    def _require_text(self, value: str, field_name: str) -> str:
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"{field_name} is required")
        return value.strip()
