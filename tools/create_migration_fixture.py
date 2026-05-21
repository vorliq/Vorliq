#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
BLOCKCHAIN_DIR = REPO_ROOT / "blockchain"
if str(BLOCKCHAIN_DIR) not in sys.path:
    sys.path.insert(0, str(BLOCKCHAIN_DIR))

from block import Block  # noqa: E402
from transaction import SYSTEM_ADDRESS, TREASURY_ADDRESS, Transaction  # noqa: E402


BASE_TIMESTAMP = 1_710_000_000.0


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def build_chain() -> dict[str, Any]:
    genesis = Block(index=0, transactions=[], previous_hash="0", timestamp=BASE_TIMESTAMP, difficulty=4)
    genesis.proof_of_work(4)

    transactions = [
        Transaction(
            sender_address=SYSTEM_ADDRESS,
            receiver_address="VLQ_FAKE_MINER_0001",
            amount=47.5,
            timestamp=BASE_TIMESTAMP + 60,
            tx_id="fixture-miner-reward-1",
            transaction_type="mining_reward",
        ).to_dict(),
        Transaction(
            sender_address=SYSTEM_ADDRESS,
            receiver_address=TREASURY_ADDRESS,
            amount=2.5,
            timestamp=BASE_TIMESTAMP + 61,
            tx_id="fixture-treasury-reward-1",
            transaction_type="treasury_reward",
        ).to_dict(),
    ]
    block = Block(
        index=1,
        transactions=transactions,
        previous_hash=genesis.hash,
        timestamp=BASE_TIMESTAMP + 90,
        difficulty=4,
        miner_address="VLQ_FAKE_MINER_0001",
    )
    block.proof_of_work(4)
    return {
        "coin": "VLQ",
        "difficulty": 4,
        "mining_reward": 50.0,
        "initial_mining_reward": 50.0,
        "maximum_supply": 21_000_000.0,
        "halving_interval": 210_000,
        "chain": [genesis.to_dict(), block.to_dict()],
    }


def fixture_payloads() -> dict[str, Any]:
    chain = build_chain()
    latest_block = chain["chain"][-1]
    return {
        "chain.json": chain,
        "pending.json": [
            Transaction(
                sender_address=SYSTEM_ADDRESS,
                receiver_address="VLQ_FAKE_PENDING_0001",
                amount=1.0,
                timestamp=BASE_TIMESTAMP + 120,
                tx_id="fixture-pending-1",
                transaction_type="faucet",
            ).to_dict()
        ],
        "profiles.json": {
            "profiles": {
                "VLQ_FAKE_MINER_0001": {
                    "display_name": "Fixture Miner",
                    "bio": "Deterministic fake profile for migration tests.",
                    "avatar": "fixture",
                    "reputation_score": 10,
                }
            }
        },
        "forum.json": {
            "posts": {
                "fixture-post-1": {
                    "post_id": "fixture-post-1",
                    "author_address": "VLQ_FAKE_MINER_0001",
                    "title": "Fixture discussion",
                    "body": "Fake migration rehearsal post.",
                    "moderation_status": "visible",
                    "vote_count": 1,
                    "timestamp": BASE_TIMESTAMP + 130,
                    "replies": [
                        {
                            "reply_id": "fixture-reply-1",
                            "author_address": "VLQ_FAKE_MEMBER_0001",
                            "body": "Fake reply.",
                            "moderation_status": "visible",
                            "timestamp": BASE_TIMESTAMP + 131,
                        }
                    ],
                }
            }
        },
        "governance.json": {
            "proposals": {
                "fixture-governance-1": {
                    "proposal_id": "fixture-governance-1",
                    "proposer_address": "VLQ_FAKE_GOVERNOR_0001",
                    "title": "Fixture rule proposal",
                    "category": "difficulty",
                    "parameter": "difficulty",
                    "status": "active",
                    "voting_deadline": 1_710_010_000,
                    "created_at": BASE_TIMESTAMP + 140,
                    "votes": {},
                    "status_history": [{"status": "active", "timestamp": BASE_TIMESTAMP + 140}],
                }
            },
            "governance_settings": {"difficulty": 4},
            "rule_changes": [
                {
                    "rule_change_id": "fixture-rule-change-1",
                    "proposal_id": "fixture-governance-1",
                    "category": "difficulty",
                    "parameter": "difficulty",
                    "old_value": 4,
                    "new_value": 4,
                    "applied_block_height": 1,
                    "status": "simulated",
                }
            ],
        },
        "exchange.json": {
            "offers": {
                "fixture-offer-1": {
                    "offer_id": "fixture-offer-1",
                    "creator_address": "VLQ_FAKE_SELLER_0001",
                    "acceptor_address": None,
                    "offer_type": "sell",
                    "amount": 5,
                    "price": "fixture goods",
                    "status": "open",
                    "created_at": BASE_TIMESTAMP + 150,
                    "status_history": [{"status": "open", "timestamp": BASE_TIMESTAMP + 150}],
                }
            }
        },
        "lending.json": {
            "loan_requests": {
                "fixture-loan-1": {
                    "loan_id": "fixture-loan-1",
                    "requester_address": "VLQ_FAKE_BORROWER_0001",
                    "amount": 3,
                    "repayment_amount": 3.3,
                    "status": "pending_vote",
                    "due_block": 100,
                    "created_at": BASE_TIMESTAMP + 160,
                    "votes": {},
                    "status_history": [{"status": "pending_vote", "timestamp": BASE_TIMESTAMP + 160}],
                }
            }
        },
        "treasury.json": {
            "proposals": {
                "fixture-treasury-1": {
                    "proposal_id": "fixture-treasury-1",
                    "proposer_address": "VLQ_FAKE_TREASURER_0001",
                    "recipient_address": "VLQ_FAKE_RECIPIENT_0001",
                    "requested_amount": 1.5,
                    "status": "active",
                    "created_at": BASE_TIMESTAMP + 170,
                    "votes": {},
                }
            }
        },
        "registry.json": {
            "registered_nodes": {
                "https://fixture-node.example.invalid": {
                    "node_url": "https://fixture-node.example.invalid",
                    "display_name": "Fixture Node",
                    "operator_wallet_address": "VLQ_FAKE_OPERATOR_0001",
                    "region": "fixture",
                    "status": "synced",
                    "last_seen": BASE_TIMESTAMP + 180,
                    "last_chain_height": 1,
                    "reliability_score": 99,
                }
            }
        },
        "faucet.json": {
            "claims": {
                "fixture-claim-1": {
                    "claim_id": "fixture-claim-1",
                    "wallet_address": "VLQ_FAKE_PENDING_0001",
                    "amount": 1,
                    "status": "pending",
                    "tx_id": "fixture-pending-1",
                    "requested_at": BASE_TIMESTAMP + 190,
                }
            }
        },
        "price.json": {
            "signals": {
                "fixture-price-1": {
                    "signal_id": "fixture-price-1",
                    "address": "VLQ_FAKE_SIGNALER_0001",
                    "currency": "USD",
                    "price": 0,
                    "status": "test",
                    "timestamp": BASE_TIMESTAMP + 200,
                    "expires_at": BASE_TIMESTAMP + 3600,
                }
            }
        },
        "achievements.json": {
            "earned": {
                "VLQ_FAKE_MINER_0001": {
                    "fixture-achievement-1": {
                        "achievement_id": "fixture-achievement-1",
                        "earned_at": BASE_TIMESTAMP + 210,
                    }
                }
            }
        },
        "indexes.json": {
            "schema_version": 1,
            "built_at": "2024-03-09T16:00:00Z",
            "chain_height": 1,
            "latest_block_hash": latest_block["hash"],
            "indexes": {
                "treasury_ledger_index": [
                    {
                        "ledger_id": "fixture-ledger-1",
                        "tx_id": "fixture-treasury-reward-1",
                        "block_hash": latest_block["hash"],
                        "block_index": 1,
                        "type": "treasury_reward",
                        "sender_address": SYSTEM_ADDRESS,
                        "receiver_address": TREASURY_ADDRESS,
                        "amount": 2.5,
                        "timestamp": BASE_TIMESTAMP + 61,
                    }
                ]
            },
        },
        "backend/analytics.json": {
            "events": [
                {
                    "event_id": "fixture-analytics-1",
                    "event_type": "route_view",
                    "route": "/migration-readiness",
                    "category": "fixture",
                    "timestamp": BASE_TIMESTAMP + 220,
                }
            ]
        },
        "backend/incidents.json": {
            "incidents": [
                {
                    "incident_id": "fixture-incident-1",
                    "title": "Fixture incident",
                    "severity": "minor",
                    "status": "resolved",
                    "created_at": BASE_TIMESTAMP + 230,
                    "updated_at": BASE_TIMESTAMP + 240,
                }
            ]
        },
        "backend/reports.json": {"reports": []},
    }


def create_fixture(output_dir: Path) -> None:
    for relative_path, payload in fixture_payloads().items():
        write_json(output_dir / relative_path, payload)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Create deterministic fake JSON state for migration rehearsal tests.")
    parser.add_argument("--output-dir", default=str(REPO_ROOT / "tests" / "fixtures" / "migration" / "sample_data"))
    args = parser.parse_args(argv)
    output_dir = Path(args.output_dir)
    create_fixture(output_dir)
    print(f"Migration fixture written to {output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
