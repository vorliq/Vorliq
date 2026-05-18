from __future__ import annotations

import hashlib
import time
from typing import Any

from logger import vorliq_logger
from transaction import SYSTEM_ADDRESS, TREASURY_ADDRESS, Transaction


class Treasury:
    VALID_CATEGORIES = {
        "development",
        "marketing",
        "community",
        "infrastructure",
        "security",
        "education",
        "other",
    }
    LIFECYCLE_STATUSES = {
        "active",
        "passed_pending_payout",
        "payout_pending",
        "paid",
        "rejected",
        "expired",
        "cancelled",
    }
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
        proposer_address = self._require_text(proposer_address, "proposer address", 160)
        title = self._require_text(title, "title", 160)
        description = self._require_text(description, "description", 3000)
        category = self._normalize_category(category)
        recipient_address = self._require_text(recipient_address, "recipient address", 160)
        requested_amount = float(requested_amount)

        if requested_amount <= 0:
            raise ValueError("requested amount must be greater than zero")
        if requested_amount > self.get_treasury_balance(blockchain):
            raise ValueError("requested amount exceeds the current treasury balance")
        if blockchain.get_balance(proposer_address) <= 0:
            raise ValueError("only VLQ holders can create treasury proposals")

        timestamp = time.time()
        proposal_id = hashlib.sha256(
            f"{proposer_address}:{title}:{recipient_address}:{timestamp}".encode("utf-8")
        ).hexdigest()
        self.proposals[proposal_id] = {
            "proposal_id": proposal_id,
            "proposer_address": proposer_address,
            "title": title,
            "description": description,
            "category": category,
            "requested_amount": requested_amount,
            "recipient_address": recipient_address,
            "created_at": timestamp,
            "timestamp": timestamp,
            "voting_deadline": timestamp + self.VOTING_PERIOD_SECONDS,
            "passed_at": None,
            "payout_created_at": None,
            "paid_at": None,
            "cancelled_at": None,
            "expired_at": None,
            "status": "active",
            "status_history": [
                {"status": "active", "timestamp": timestamp, "note": "Treasury proposal opened for voting."}
            ],
            "yes_vote_weight": 0.0,
            "no_vote_weight": 0.0,
            "votes": {},
            "quorum": self.QUORUM,
            "approval_threshold": self.APPROVAL_THRESHOLD,
            "payout_tx_id": None,
            "payout_block_index": None,
            "payout_block_hash": None,
            "execution_result": None,
            "execution_error": None,
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
        voter_address = self._require_text(voter_address, "voter address", 160)
        vote = self._normalize_vote(vote)
        voter_balance = float(voter_balance)

        if time.time() > float(proposal["voting_deadline"]):
            self._set_status(proposal, "expired", "Voting period expired.", "expired_at")
            raise ValueError("treasury proposal voting period has expired")
        if voter_address in proposal["votes"]:
            raise ValueError("voter has already voted on this treasury proposal")
        if voter_balance <= 0:
            raise ValueError("only VLQ holders can vote on treasury proposals")

        proposal["votes"][voter_address] = {
            "vote": vote,
            "weight": voter_balance,
            "timestamp": time.time(),
        }
        if vote == "yes":
            proposal["yes_vote_weight"] = float(proposal.get("yes_vote_weight", 0)) + voter_balance
        else:
            proposal["no_vote_weight"] = float(proposal.get("no_vote_weight", 0)) + voter_balance

        vorliq_logger.info("Treasury proposal %s received %s vote from %s", proposal_id, vote, voter_address)
        self.check_proposal_outcome(proposal_id, current_blockchain)
        return proposal

    def check_proposal_outcome(self, proposal_id: str, current_blockchain: Any | None = None) -> dict[str, Any]:
        proposal = self._get_existing_proposal(proposal_id)
        if proposal["status"] != "active":
            return proposal

        total_weight = float(proposal["yes_vote_weight"]) + float(proposal["no_vote_weight"])
        if total_weight < float(proposal["quorum"]):
            return proposal

        if float(proposal["yes_vote_weight"]) / total_weight >= float(proposal["approval_threshold"]):
            self._set_status(
                proposal,
                "passed_pending_payout",
                "Voting threshold reached; treasury payout will be created.",
                "passed_at",
            )
            return self.execute_proposal(proposal_id, current_blockchain)

        if float(proposal["no_vote_weight"]) / total_weight > (1 - float(proposal["approval_threshold"])):
            self._set_status(proposal, "rejected", "No vote weight exceeded the rejection threshold.")
            vorliq_logger.info("Treasury proposal %s was rejected", proposal_id)

        return proposal

    def execute_proposal(self, proposal_id: str, current_blockchain: Any | None = None) -> dict[str, Any]:
        blockchain = self._blockchain(current_blockchain)
        proposal = self._get_existing_proposal(proposal_id)
        if proposal["status"] not in {"passed_pending_payout"}:
            raise ValueError("only passed treasury proposals can trigger payout")
        if float(proposal["requested_amount"]) > self.get_treasury_balance(blockchain):
            raise ValueError("treasury no longer has enough VLQ for this proposal")

        try:
            transaction = Transaction(
                sender_address=TREASURY_ADDRESS,
                receiver_address=proposal["recipient_address"],
                amount=float(proposal["requested_amount"]),
                transaction_type="treasury_payout",
                category="treasury_payout",
                metadata={
                    "proposal_id": proposal["proposal_id"],
                    "treasury_category": proposal["category"],
                    "title": proposal["title"],
                },
            )
            blockchain.add_pending_transaction(transaction)
            proposal["payout_tx_id"] = transaction.tx_id
            proposal["payout_created_at"] = time.time()
            proposal["execution_error"] = None
            proposal["execution_result"] = {
                "message": "Treasury payout transaction created and waiting for mining confirmation.",
                "payout_tx_id": transaction.tx_id,
            }
            self._set_status(proposal, "payout_pending", "Payout transaction added to pending pool.")
            vorliq_logger.info("Treasury proposal %s queued payout %s", proposal_id, transaction.tx_id)
        except Exception as exc:
            proposal["execution_error"] = str(exc)[:500]
            proposal["execution_result"] = None
            self._append_history(proposal, proposal["status"], f"Payout creation failed: {proposal['execution_error']}")
            raise

        return proposal

    def cancel_proposal(self, proposal_id: str, proposer_address: str) -> dict[str, Any]:
        proposal = self._get_existing_proposal(proposal_id)
        proposer_address = self._require_text(proposer_address, "proposer address", 160)
        if proposal["proposer_address"] != proposer_address:
            raise ValueError("only the proposer can cancel this treasury proposal")
        if proposal["status"] != "active":
            raise ValueError("only active treasury proposals can be cancelled")
        if proposal.get("votes"):
            raise ValueError("proposal cannot be cancelled after votes have been cast")
        self._set_status(proposal, "cancelled", "Treasury proposal cancelled by proposer.", "cancelled_at")
        return proposal

    def sync_treasury_statuses(self, blockchain: Any | None = None) -> bool:
        blockchain = self._blockchain(blockchain)
        changed = self.expire_proposals()
        tx_lookup = self._transaction_lookup(blockchain)
        for proposal in self.proposals.values():
            proposal = self._normalize_proposal(proposal)
            tx_id = proposal.get("payout_tx_id")
            if proposal["status"] == "passed_pending_payout":
                try:
                    self.execute_proposal(proposal["proposal_id"], blockchain)
                    changed = True
                except Exception:
                    changed = True
            if proposal["status"] == "payout_pending" and tx_id:
                record = tx_lookup.get(tx_id)
                if record and record.get("status") == "confirmed":
                    proposal["payout_block_index"] = record.get("block_index")
                    proposal["payout_block_hash"] = record.get("block_hash")
                    proposal["paid_at"] = record.get("block_timestamp") or time.time()
                    proposal["execution_result"] = {
                        "message": "Treasury payout confirmed on chain.",
                        "payout_tx_id": tx_id,
                        "block_index": record.get("block_index"),
                    }
                    self._set_status(proposal, "paid", "Payout transaction confirmed on chain.", "paid_at", proposal["paid_at"])
                    changed = True
        return changed

    def expire_proposals(self, current_timestamp: float | None = None) -> bool:
        current_timestamp = time.time() if current_timestamp is None else current_timestamp
        changed = False
        for proposal in self.proposals.values():
            proposal = self._normalize_proposal(proposal)
            if proposal.get("status") == "active" and current_timestamp > float(proposal.get("voting_deadline", 0)):
                self._set_status(proposal, "expired", "Voting period expired.", "expired_at", current_timestamp)
                changed = True
        return changed

    def get_all_proposals(self) -> list[dict[str, Any]]:
        return self.get_proposals()

    def get_active_proposals(self) -> list[dict[str, Any]]:
        self.expire_proposals()
        return self.get_proposals(status="active")

    def get_proposals(
        self,
        status: str | None = None,
        category: str | None = None,
        address: str | None = None,
    ) -> list[dict[str, Any]]:
        if status:
            status = self._require_text(status, "status", 40).lower()
            if status not in self.LIFECYCLE_STATUSES:
                raise ValueError("treasury status is not valid")
        if category:
            category = self._normalize_category(category)
        address = address.strip() if isinstance(address, str) and address.strip() else None
        proposals = [self._normalize_proposal(proposal) for proposal in self.proposals.values()]
        if status:
            proposals = [proposal for proposal in proposals if proposal.get("status") == status]
        if category:
            proposals = [proposal for proposal in proposals if proposal.get("category") == category]
        if address:
            proposals = [
                proposal
                for proposal in proposals
                if proposal.get("proposer_address") == address
                or proposal.get("recipient_address") == address
                or address in proposal.get("votes", {})
            ]
        return sorted(proposals, key=lambda proposal: float(proposal.get("created_at", proposal.get("timestamp", 0)) or 0), reverse=True)

    def get_my_treasury(self, address: str) -> dict[str, list[dict[str, Any]]]:
        address = self._require_text(address, "address", 160)
        proposals = self.get_proposals(address=address)
        created = [proposal for proposal in proposals if proposal.get("proposer_address") == address]
        voted = [proposal for proposal in proposals if address in proposal.get("votes", {})]
        received = [proposal for proposal in proposals if proposal.get("recipient_address") == address and proposal.get("status") in {"payout_pending", "paid"}]
        return {"created": created, "voted": voted, "received": received, "proposals": proposals}

    def get_treasury_balance(self, blockchain: Any | None = None) -> float:
        return self._blockchain(blockchain).get_treasury_balance()

    def get_treasury_ledger(self, blockchain: Any | None = None, limit: int = 25, offset: int = 0) -> dict[str, Any]:
        blockchain = self._blockchain(blockchain)
        entries = self._ledger_entries(blockchain)
        total = len(entries)
        return {
            "entries": entries[offset : offset + limit],
            "total": total,
            "limit": limit,
            "offset": offset,
            "has_more": offset + limit < total,
        }

    def get_treasury_summary(self, blockchain: Any | None = None) -> dict[str, Any]:
        blockchain = self._blockchain(blockchain)
        self.sync_treasury_statuses(blockchain)
        proposals = self.get_all_proposals()
        ledger = self._ledger_entries(blockchain)
        paid_entries = [entry for entry in ledger if entry["type"] == "payout_paid"]
        reward_entries = [entry for entry in ledger if entry["type"] == "reward_in"]
        pending_payouts = [
            proposal for proposal in proposals if proposal.get("status") in {"passed_pending_payout", "payout_pending"}
        ]
        return {
            "current_balance": self.get_treasury_balance(blockchain),
            "balance": self.get_treasury_balance(blockchain),
            "treasury_percentage": getattr(blockchain, "TREASURY_PERCENTAGE", 0.05),
            "treasury_address": TREASURY_ADDRESS,
            "total_received": sum(float(entry["amount"]) for entry in reward_entries),
            "total_paid": sum(float(entry["amount"]) for entry in paid_entries),
            "pending_payouts": sum(float(proposal.get("requested_amount", 0)) for proposal in pending_payouts),
            "pending_payout_count": len(pending_payouts),
            "paid_proposal_count": len([proposal for proposal in proposals if proposal.get("status") == "paid"]),
            "active_proposal_count": len([proposal for proposal in proposals if proposal.get("status") == "active"]),
            "rejected_proposal_count": len([proposal for proposal in proposals if proposal.get("status") == "rejected"]),
            "expired_proposal_count": len([proposal for proposal in proposals if proposal.get("status") == "expired"]),
            "cancelled_proposal_count": len([proposal for proposal in proposals if proposal.get("status") == "cancelled"]),
            "latest_ledger_entries": ledger[:5],
        }

    def get_proposal(self, proposal_id: str) -> dict[str, Any] | None:
        proposal = self.proposals.get(proposal_id)
        return self._normalize_proposal(proposal) if proposal else None

    def _ledger_entries(self, blockchain: Any) -> list[dict[str, Any]]:
        proposal_by_tx = {
            proposal.get("payout_tx_id"): proposal
            for proposal in (self._normalize_proposal(proposal) for proposal in self.proposals.values())
            if proposal.get("payout_tx_id")
        }
        entries: list[dict[str, Any]] = []
        for block in getattr(blockchain, "chain", []):
            for transaction in block.transactions or []:
                tx = blockchain._coerce_transaction(transaction)
                if tx.sender_address != TREASURY_ADDRESS and tx.receiver_address != TREASURY_ADDRESS:
                    continue
                proposal = proposal_by_tx.get(tx.tx_id)
                entry_type = "reward_in" if tx.receiver_address == TREASURY_ADDRESS else "payout_paid"
                entries.append(
                    self._ledger_record(
                        entry_type,
                        tx,
                        block.index,
                        block.hash,
                        proposal,
                        "Treasury mining reward" if entry_type == "reward_in" else f"Treasury payout for {proposal.get('title', 'proposal') if proposal else 'proposal'}",
                    )
                )
        for transaction in getattr(blockchain, "pending_transactions", []) or []:
            tx = blockchain._coerce_transaction(transaction)
            if tx.sender_address != TREASURY_ADDRESS:
                continue
            proposal = proposal_by_tx.get(tx.tx_id)
            entries.append(
                self._ledger_record(
                    "payout_pending",
                    tx,
                    None,
                    None,
                    proposal,
                    f"Pending treasury payout for {proposal.get('title', 'proposal') if proposal else 'proposal'}",
                )
            )
        entries.sort(key=lambda entry: float(entry.get("timestamp") or 0), reverse=True)
        return entries

    def _ledger_record(
        self,
        entry_type: str,
        tx: Transaction,
        block_index: int | None,
        block_hash: str | None,
        proposal: dict[str, Any] | None,
        description: str,
    ) -> dict[str, Any]:
        seed = f"{entry_type}:{tx.tx_id}:{block_index}:{proposal.get('proposal_id') if proposal else ''}"
        return {
            "ledger_id": hashlib.sha256(seed.encode("utf-8")).hexdigest(),
            "type": entry_type,
            "amount": tx.amount,
            "from_address": tx.sender_address,
            "to_address": tx.receiver_address,
            "tx_id": tx.tx_id,
            "block_index": block_index,
            "block_hash": block_hash,
            "timestamp": tx.timestamp,
            "proposal_id": proposal.get("proposal_id") if proposal else tx.metadata.get("proposal_id"),
            "description": description,
        }

    def _transaction_lookup(self, blockchain: Any) -> dict[str, dict[str, Any]]:
        records: dict[str, dict[str, Any]] = {}
        for block in getattr(blockchain, "chain", []):
            for index, transaction in enumerate(block.transactions or []):
                tx = blockchain._coerce_transaction(transaction)
                records[tx.tx_id] = blockchain.safe_transaction_record(
                    tx,
                    status="confirmed",
                    block=block,
                    transaction_index=index,
                )
        return records

    def _normalize_proposal(self, proposal: dict[str, Any]) -> dict[str, Any]:
        created_at = float(proposal.get("created_at", proposal.get("timestamp", time.time())) or time.time())
        proposal.setdefault("proposal_id", "")
        proposal.setdefault("created_at", created_at)
        proposal.setdefault("timestamp", created_at)
        proposal.setdefault("voting_deadline", created_at + self.VOTING_PERIOD_SECONDS)
        proposal.setdefault("passed_at", proposal.get("executed_timestamp"))
        proposal.setdefault("payout_created_at", proposal.get("executed_timestamp"))
        proposal.setdefault("paid_at", None)
        proposal.setdefault("cancelled_at", None)
        proposal.setdefault("expired_at", None)
        proposal.setdefault("yes_vote_weight", 0.0)
        proposal.setdefault("no_vote_weight", 0.0)
        proposal.setdefault("votes", {})
        proposal.setdefault("quorum", self.QUORUM)
        proposal.setdefault("approval_threshold", self.APPROVAL_THRESHOLD)
        proposal.setdefault("payout_tx_id", None)
        proposal.setdefault("payout_block_index", None)
        proposal.setdefault("payout_block_hash", None)
        proposal.setdefault("execution_result", None)
        proposal.setdefault("execution_error", None)

        status = str(proposal.get("status", "active")).lower()
        if status == "passed":
            status = "paid" if proposal.get("payout_tx_id") and proposal.get("payout_block_hash") else "passed_pending_payout"
        elif status not in self.LIFECYCLE_STATUSES:
            status = "active"
            proposal["compatibility_note"] = "Unknown legacy treasury status treated as active."
        proposal["status"] = status

        normalized_votes = {}
        for voter, value in (proposal.get("votes") or {}).items():
            if isinstance(value, dict):
                normalized_votes[voter] = value
            else:
                normalized_votes[voter] = {"vote": str(value), "weight": None, "timestamp": None}
        proposal["votes"] = normalized_votes

        if "status_history" not in proposal or not isinstance(proposal["status_history"], list):
            proposal["status_history"] = [
                {"status": status, "timestamp": created_at, "note": "Legacy treasury proposal imported."}
            ]
        return proposal

    def _blockchain(self, blockchain: Any | None = None) -> Any:
        blockchain = blockchain or self.blockchain
        if blockchain is None:
            raise ValueError("blockchain is required")
        return blockchain

    def _get_existing_proposal(self, proposal_id: str) -> dict[str, Any]:
        proposal_id = self._require_text(proposal_id, "proposal ID", 128)
        proposal = self.get_proposal(proposal_id)
        if not proposal:
            raise ValueError("treasury proposal does not exist")
        return proposal

    def _get_active_proposal(self, proposal_id: str) -> dict[str, Any]:
        proposal = self._get_existing_proposal(proposal_id)
        if proposal.get("status") != "active":
            raise ValueError("treasury proposal is not active")
        return proposal

    def _normalize_category(self, category: str) -> str:
        category = self._require_text(category, "category", 80).lower()
        if category not in self.VALID_CATEGORIES:
            raise ValueError("category must be development, marketing, community, infrastructure, security, education, or other")
        return category

    def _normalize_vote(self, vote: str) -> str:
        vote = self._require_text(vote, "vote", 8).lower()
        if vote not in {"yes", "no"}:
            raise ValueError("vote must be yes or no")
        return vote

    def _set_status(
        self,
        proposal: dict[str, Any],
        status: str,
        note: str,
        timestamp_field: str | None = None,
        timestamp: float | None = None,
    ) -> None:
        timestamp = timestamp or time.time()
        proposal["status"] = status
        if timestamp_field:
            proposal[timestamp_field] = timestamp
        self._append_history(proposal, status, note, timestamp)

    def _append_history(
        self,
        proposal: dict[str, Any],
        status: str,
        note: str,
        timestamp: float | None = None,
    ) -> None:
        proposal.setdefault("status_history", [])
        proposal["status_history"].append({"status": status, "timestamp": timestamp or time.time(), "note": note})

    def _require_text(self, value: Any, field_name: str, max_length: int | None = None) -> str:
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"{field_name} must be a non-empty string")
        value = value.replace("\x00", "").strip()
        if max_length and len(value) > max_length:
            raise ValueError(f"{field_name} must be {max_length} characters or fewer")
        return value
