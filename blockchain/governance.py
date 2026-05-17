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
    lifecycle_statuses = {
        "active",
        "passed_pending_execution",
        "executed",
        "rejected",
        "expired",
        "cancelled",
    }
    quorum = 500.0
    approval_threshold = 0.60
    voting_period_seconds = 7 * 24 * 60 * 60

    def __init__(self) -> None:
        self.proposals: dict[str, dict[str, Any]] = {}
        self.rule_changes: list[dict[str, Any]] = []
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
        proposer_address = self._require_text(proposer_address, "proposer address", 160)
        title = self._require_text(title, "title", 160)
        description = self._require_text(description, "description", 3000)
        category = self._require_text(category, "category", 80).lower()

        if category not in self.valid_categories:
            raise ValueError("proposal category is not valid")

        if current_blockchain.get_balance(proposer_address) <= 0:
            raise ValueError("only VLQ holders can create governance proposals")

        active_count = sum(
            1
            for proposal in self.proposals.values()
            if self._normalize_proposal(proposal).get("proposer_address") == proposer_address
            and proposal.get("status") == "active"
        )
        if active_count >= 3:
            raise ValueError("proposer cannot have more than three active proposals")

        timestamp = time.time()
        proposal_id = sha256(f"{proposer_address}:{title}:{timestamp}".encode("utf-8")).hexdigest()
        current_value = self._current_value_for_category(category, current_blockchain)
        parameter = self._normalize_parameter(category, parameter_value)

        self.proposals[proposal_id] = {
            "proposal_id": proposal_id,
            "proposer_address": proposer_address,
            "title": title[:160],
            "description": description,
            "category": category,
            "parameter": parameter,
            "current_value": current_value,
            "created_at": timestamp,
            "timestamp": timestamp,
            "voting_deadline": timestamp + self.voting_period_seconds,
            "executed_at": None,
            "cancelled_at": None,
            "expired_at": None,
            "status": "active",
            "status_history": [
                {"status": "active", "timestamp": timestamp, "note": "Proposal opened for voting."}
            ],
            "votes": {},
            "yes_vote_weight": 0.0,
            "no_vote_weight": 0.0,
            "quorum": self.quorum,
            "approval_threshold": self.approval_threshold,
            "execution_result": None,
            "execution_error": None,
            "executed_by_system": False,
            "rule_change_id": None,
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
        voter_address = self._require_text(voter_address, "voter address", 160)
        vote = self._require_text(vote, "vote", 8).lower()
        voter_vlq_balance = float(voter_vlq_balance)

        if proposal["status"] != "active":
            raise ValueError("proposal is no longer active")

        if time.time() >= float(proposal["voting_deadline"]):
            self._set_status(proposal, "expired", "Voting deadline passed.", "expired_at")
            raise ValueError("proposal voting deadline has passed")

        if vote not in {"yes", "no"}:
            raise ValueError("vote must be yes or no")

        if voter_address in proposal["votes"]:
            raise ValueError("voter has already voted on this proposal")

        if voter_vlq_balance <= 0:
            raise ValueError("only VLQ holders with a positive balance can vote")

        proposal["votes"][voter_address] = {
            "vote": vote,
            "weight": voter_vlq_balance,
            "timestamp": time.time(),
        }
        if vote == "yes":
            proposal["yes_vote_weight"] = float(proposal.get("yes_vote_weight", 0)) + voter_vlq_balance
        else:
            proposal["no_vote_weight"] = float(proposal.get("no_vote_weight", 0)) + voter_vlq_balance

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
            self._set_status(
                proposal,
                "passed_pending_execution",
                "Voting threshold reached; execution will be attempted.",
            )
            return self.execute_proposal(proposal_id, current_blockchain)

        if no_ratio > (1 - float(proposal["approval_threshold"])):
            self._set_status(proposal, "rejected", "No vote weight exceeded the rejection threshold.")
            vorliq_logger.info("Governance proposal %s rejected", proposal_id)

        return proposal

    def apply_proposal(self, proposal_id: str, current_blockchain: Blockchain) -> dict[str, Any]:
        """Backward-compatible alias for older callers."""
        proposal = self._get_existing_proposal(proposal_id)
        if proposal["status"] == "active":
            self._set_status(proposal, "passed_pending_execution", "Execution requested.")
        return self.execute_proposal(proposal_id, current_blockchain)

    def execute_proposal(self, proposal_id: str, current_blockchain: Blockchain) -> dict[str, Any]:
        proposal = self._get_existing_proposal(proposal_id)

        if proposal["status"] not in {"passed_pending_execution"}:
            return proposal

        try:
            category = proposal["category"]
            parameter = proposal["parameter"]

            if category == "general":
                proposal["execution_result"] = {
                    "message": "General proposal passed. No automatic setting was changed.",
                    "changed": False,
                }
                proposal["executed_by_system"] = True
                self._set_status(proposal, "executed", "General proposal recorded as executed.", "executed_at")
                return proposal

            old_value = self._current_value_for_category(category, current_blockchain)
            new_value = self._execution_value(category, parameter)

            if category == "mining_reward":
                current_blockchain.mining_reward = float(new_value)
                current_blockchain.initial_mining_reward = float(new_value)
            elif category == "difficulty":
                current_blockchain.difficulty = int(new_value)
                current_blockchain.proof_target = "0" * int(new_value)

            self._update_setting(category, new_value)
            rule_change = self._record_rule_change(proposal, old_value, new_value, current_blockchain)

            proposal["rule_change_id"] = rule_change["rule_change_id"]
            proposal["execution_result"] = {
                "message": f"{category} changed from {old_value} to {new_value}.",
                "category": category,
                "old_value": old_value,
                "new_value": new_value,
                "rule_change_id": rule_change["rule_change_id"],
            }
            proposal["execution_error"] = None
            proposal["executed_by_system"] = True
            self._set_status(proposal, "executed", "Proposal executed and rule change recorded.", "executed_at")
            vorliq_logger.info("Governance proposal %s executed for %s", proposal_id, category)
        except Exception as exc:
            proposal["execution_error"] = str(exc)[:500]
            proposal["execution_result"] = None
            self._append_history(proposal, "passed_pending_execution", f"Execution failed: {proposal['execution_error']}")
            vorliq_logger.error("Governance proposal %s execution failed: %s", proposal_id, exc)

        return proposal

    def cancel_proposal(self, proposal_id: str, proposer_address: str) -> dict[str, Any]:
        proposal = self._get_existing_proposal(proposal_id)
        proposer_address = self._require_text(proposer_address, "proposer address", 160)

        if proposal["proposer_address"] != proposer_address:
            raise ValueError("only the proposer can cancel this proposal")
        if proposal["status"] != "active":
            raise ValueError("only active proposals can be cancelled")
        if proposal.get("votes"):
            raise ValueError("proposal cannot be cancelled after votes have been cast")

        self._set_status(proposal, "cancelled", "Proposal cancelled by proposer.", "cancelled_at")
        return proposal

    def expire_proposals(self, current_timestamp: float | None = None) -> bool:
        current_timestamp = current_timestamp or time.time()
        changed = False

        for proposal in self.proposals.values():
            proposal = self._normalize_proposal(proposal)
            if proposal["status"] == "active" and current_timestamp >= float(proposal["voting_deadline"]):
                self._set_status(proposal, "expired", "Voting deadline passed.", "expired_at", current_timestamp)
                changed = True
                vorliq_logger.info("Governance proposal %s expired", proposal["proposal_id"])

        return changed

    def get_active_proposals(self) -> list[dict[str, Any]]:
        return self.get_proposals(status="active")

    def get_all_proposals(self) -> list[dict[str, Any]]:
        return self.get_proposals()

    def get_proposals(
        self,
        status: str | None = None,
        category: str | None = None,
        address: str | None = None,
    ) -> list[dict[str, Any]]:
        if status:
            status = self._require_text(status, "status", 40).lower()
            if status not in self.lifecycle_statuses:
                raise ValueError("proposal status is not valid")
        if category:
            category = self._require_text(category, "category", 80).lower()
            if category not in self.valid_categories:
                raise ValueError("proposal category is not valid")
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
                if proposal.get("proposer_address") == address or address in proposal.get("votes", {})
            ]

        return sorted(proposals, key=self._proposal_sort_timestamp, reverse=True)

    def get_proposal(self, proposal_id: str) -> dict[str, Any] | None:
        proposal = self.proposals.get(proposal_id)
        return self._normalize_proposal(proposal) if proposal else None

    def get_my_governance(self, address: str) -> dict[str, list[dict[str, Any]]]:
        address = self._require_text(address, "address", 160)
        proposals = self.get_proposals(address=address)
        created = [proposal for proposal in proposals if proposal.get("proposer_address") == address]
        voted = [proposal for proposal in proposals if address in proposal.get("votes", {})]
        return {"created": created, "voted": voted, "proposals": proposals}

    def get_summary(self) -> dict[str, Any]:
        proposals = self.get_all_proposals()
        status_counts = {status: 0 for status in self.lifecycle_statuses}
        for proposal in proposals:
            status = proposal.get("status")
            if status in status_counts:
                status_counts[status] += 1

        latest_rule_change = self.get_rule_changes(limit=1)
        total_votes = sum(len(proposal.get("votes", {})) for proposal in proposals)
        return {
            "active_count": status_counts["active"],
            "passed_pending_execution_count": status_counts["passed_pending_execution"],
            "executed_count": status_counts["executed"],
            "rejected_count": status_counts["rejected"],
            "expired_count": status_counts["expired"],
            "cancelled_count": status_counts["cancelled"],
            "total_proposals": len(proposals),
            "total_votes": total_votes,
            "latest_executed_rule_change": latest_rule_change[0] if latest_rule_change else None,
            "current_governable_settings": self.get_governance_settings(),
        }

    def get_rule_changes(self, limit: int | None = None, offset: int = 0) -> list[dict[str, Any]]:
        records = sorted(
            list(self.rule_changes),
            key=lambda record: float(record.get("applied_at", 0)),
            reverse=True,
        )
        if limit is None:
            return records[offset:]
        return records[offset : offset + limit]

    def get_settings_history(self) -> list[dict[str, Any]]:
        return self.get_rule_changes()

    def get_governance_settings(self) -> dict[str, dict[str, Any]]:
        for key, setting in self.governance_settings.items():
            setting["changed"] = setting.get("current") != setting.get("default")
        return self.governance_settings

    def _get_existing_proposal(self, proposal_id: str) -> dict[str, Any]:
        proposal_id = self._require_text(proposal_id, "proposal ID", 128)
        proposal = self.get_proposal(proposal_id)
        if not proposal:
            raise ValueError("proposal does not exist")
        return proposal

    def _normalize_proposal(self, proposal: dict[str, Any]) -> dict[str, Any]:
        created_at = float(proposal.get("created_at", proposal.get("timestamp", time.time())))
        proposal.setdefault("proposal_id", "")
        proposal.setdefault("created_at", created_at)
        proposal.setdefault("timestamp", created_at)
        proposal.setdefault("voting_deadline", created_at + self.voting_period_seconds)
        proposal.setdefault("executed_at", proposal.get("passed_timestamp"))
        proposal.setdefault("cancelled_at", None)
        proposal.setdefault("expired_at", None)
        proposal.setdefault("votes", {})
        proposal.setdefault("yes_vote_weight", 0.0)
        proposal.setdefault("no_vote_weight", 0.0)
        proposal.setdefault("quorum", self.quorum)
        proposal.setdefault("approval_threshold", self.approval_threshold)
        proposal.setdefault("execution_result", None)
        proposal.setdefault("execution_error", None)
        proposal.setdefault("executed_by_system", False)
        proposal.setdefault("rule_change_id", None)

        status = str(proposal.get("status", "active")).lower()
        if status == "passed":
            status = self._legacy_passed_status(proposal)
        elif status not in self.lifecycle_statuses:
            status = "active"
            proposal["compatibility_note"] = "Unknown legacy governance status treated as active."
        proposal["status"] = status

        if "status_history" not in proposal or not isinstance(proposal["status_history"], list):
            proposal["status_history"] = [
                {"status": status, "timestamp": created_at, "note": "Legacy proposal imported."}
            ]

        # Older proposals stored votes as address -> "yes"/"no".
        normalized_votes = {}
        for voter, value in (proposal.get("votes") or {}).items():
            if isinstance(value, dict):
                normalized_votes[voter] = value
            else:
                normalized_votes[voter] = {"vote": str(value), "weight": None, "timestamp": None}
        proposal["votes"] = normalized_votes
        return proposal

    def _legacy_passed_status(self, proposal: dict[str, Any]) -> str:
        category = proposal.get("category")
        parameter = proposal.get("parameter")
        if category == "general":
            return "executed"
        if proposal.get("rule_change_id") or proposal.get("executed_at"):
            return "executed"
        if category in self.governance_settings and self.governance_settings[category].get("current") == parameter:
            return "executed"
        return "passed_pending_execution"

    def _proposal_sort_timestamp(self, proposal: dict[str, Any]) -> float:
        return float(proposal.get("created_at", proposal.get("timestamp", 0)) or 0)

    def _current_value_for_category(self, category: str, current_blockchain: Blockchain) -> Any:
        if category == "mining_reward":
            return float(getattr(current_blockchain, "mining_reward", current_blockchain.initial_mining_reward))
        if category == "difficulty":
            return int(current_blockchain.difficulty)
        if category in self.governance_settings:
            return self.governance_settings[category]["current"]
        return "advisory"

    def _normalize_parameter(self, category: str, parameter_value: Any) -> Any:
        if category == "mining_reward":
            value = float(parameter_value)
            if value <= 0 or value > 1000:
                raise ValueError("mining reward must be greater than 0 and no more than 1000 VLQ")
            return value
        if category == "difficulty":
            value = int(parameter_value)
            if value < 2 or value > 8:
                raise ValueError("difficulty must be an integer between 2 and 8")
            return value
        if category == "loan_limit":
            value = float(parameter_value)
            if value <= 0 or value > 1_000_000:
                raise ValueError("loan limit must be greater than 0 and no more than 1000000 VLQ")
            return value
        if category == "loan_interest":
            value = float(parameter_value)
            if value < 0 or value > 100:
                raise ValueError("loan interest must be between 0 and 100 percent")
            # Preserve existing decimal setting shape while accepting percent-style input.
            return value / 100 if value > 1 else value
        if category == "exchange_limit":
            value = int(parameter_value)
            if value <= 0 or value > 1000:
                raise ValueError("exchange limit must be between 1 and 1000")
            return value
        return self._require_text(str(parameter_value), "parameter", 500)

    def _execution_value(self, category: str, parameter: Any) -> Any:
        return self._normalize_parameter(category, parameter)

    def _update_setting(self, category: str, value: Any) -> None:
        if category not in self.governance_settings:
            return
        self.governance_settings[category]["current"] = value
        self.governance_settings[category]["changed"] = (
            self.governance_settings[category]["current"] != self.governance_settings[category]["default"]
        )

    def _record_rule_change(
        self,
        proposal: dict[str, Any],
        old_value: Any,
        new_value: Any,
        current_blockchain: Blockchain,
    ) -> dict[str, Any]:
        timestamp = time.time()
        rule_change_id = sha256(
            f"{proposal['proposal_id']}:{proposal['category']}:{old_value}:{new_value}:{timestamp}".encode("utf-8")
        ).hexdigest()
        record = {
            "rule_change_id": rule_change_id,
            "proposal_id": proposal["proposal_id"],
            "category": proposal["category"],
            "old_value": old_value,
            "new_value": new_value,
            "applied_at": timestamp,
            "applied_block_height": max(len(getattr(current_blockchain, "chain", [])) - 1, 0),
            "description": proposal.get("title", ""),
            "status": "executed",
        }
        self.rule_changes.append(record)
        return record

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
        timestamp = timestamp or time.time()
        proposal.setdefault("status_history", [])
        proposal["status_history"].append({"status": status, "timestamp": timestamp, "note": note})

    def _require_text(self, value: Any, field_name: str, max_length: int | None = None) -> str:
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"{field_name} is required")
        value = value.replace("\x00", "").strip()
        if max_length and len(value) > max_length:
            raise ValueError(f"{field_name} must be {max_length} characters or fewer")
        return value
