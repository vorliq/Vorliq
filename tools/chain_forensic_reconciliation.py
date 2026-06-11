from __future__ import annotations

import argparse
import hashlib
import json
import logging
import sys
import tarfile
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
BLOCKCHAIN_DIR = ROOT / "blockchain"
sys.path.insert(0, str(BLOCKCHAIN_DIR))
sys.path.insert(0, str(ROOT / "tools"))

from block import Block  # noqa: E402
from blockchain import Blockchain  # noqa: E402
from diagnose_chain_startup import evaluate_chain_payload  # noqa: E402
from transaction import Transaction  # noqa: E402


STATE_SPECS = {
    "pending_transactions": ("blockchain/data/pending.json", None),
    "faucet_claims": ("blockchain/data/faucet.json", "claims"),
    "lending_proposals": ("blockchain/data/lending.json", "loan_requests"),
    "treasury_records": ("blockchain/data/treasury.json", "proposals"),
    "governance_proposals": ("blockchain/data/governance.json", "proposals"),
    "governance_rule_changes": ("blockchain/data/governance.json", "rule_changes"),
    "forum_posts": ("blockchain/data/forum.json", "posts"),
    "community_requests": ("blockchain/data/exchange.json", "offers"),
    "profiles": ("blockchain/data/profiles.json", "profiles"),
    "backend_incidents": ("backend/data/incidents.json", "incidents"),
}

SAFE_TRANSACTION_CATEGORIES = {
    "transfer",
    "mining_reward",
    "treasury_reward",
    "lending",
    "treasury",
    "faucet",
    "faucet_starter",
    "governance",
}


def read_archive_json(path: Path, suffix: str) -> Any | None:
    try:
        with tarfile.open(path, "r:gz") as archive:
            members = [member for member in archive.getmembers() if member.isfile() and member.name.endswith(suffix)]
            if len(members) != 1:
                return None
            extracted = archive.extractfile(members[0])
            if extracted is None:
                return None
            return json.loads(extracted.read().decode("utf-8"))
    except Exception:
        return None


def archive_chain(path: Path) -> dict[str, Any] | None:
    data = read_archive_json(path, "blockchain/data/chain.json")
    return data if isinstance(data, dict) else None


def read_directory_json(path: Path, suffix: str) -> Any | None:
    try:
        return json.loads((path / Path(suffix).name).read_text(encoding="utf-8"))
    except Exception:
        return None


def transaction_bucket(data: Any) -> str:
    if not isinstance(data, dict):
        return "invalid"
    category = str(data.get("category") or data.get("type") or "other").strip().lower()
    return category if category in SAFE_TRANSACTION_CATEGORIES else "other"


def transaction_counts(chain_data: dict[str, Any], start_index: int = 0) -> dict[str, Any]:
    counts = {category: 0 for category in sorted(SAFE_TRANSACTION_CATEGORIES | {"other", "invalid"})}
    individually_valid = 0
    total = 0
    for block in chain_data.get("chain", [])[start_index:]:
        if not isinstance(block, dict):
            continue
        for transaction_data in block.get("transactions", []):
            total += 1
            counts[transaction_bucket(transaction_data)] += 1
            try:
                if Transaction.from_dict(transaction_data).verify_transaction():
                    individually_valid += 1
            except Exception:
                pass
    return {
        "total": total,
        "individually_valid": individually_valid,
        "individually_invalid": total - individually_valid,
        "categories": {key: value for key, value in counts.items() if value},
    }


def chain_detail(chain_data: dict[str, Any]) -> dict[str, Any]:
    result = evaluate_chain_payload(chain_data)
    try:
        blocks = [Block.from_dict(block) for block in chain_data.get("chain", [])]
    except Exception:
        return {"validation": result, "block_count": 0, "transaction_counts": transaction_counts(chain_data)}

    self_valid = 0
    linked_to_predecessor = 0
    for index, block in enumerate(blocks):
        if block.hash == block.calculate_hash() and block.hash.startswith("0" * getattr(block, "difficulty", 4)):
            self_valid += 1
        if index == 0 or block.previous_hash == blocks[index - 1].hash:
            linked_to_predecessor += 1

    failure_index = result.get("index") if isinstance(result.get("index"), int) else None
    links_after_failure = 0
    links_after_failure_total = 0
    if failure_index is not None:
        for index in range(failure_index + 1, len(blocks)):
            links_after_failure_total += 1
            if blocks[index].previous_hash == blocks[index - 1].hash:
                links_after_failure += 1

    return {
        "validation": result,
        "block_count": len(blocks),
        "self_valid_block_count": self_valid,
        "linked_block_count": linked_to_predecessor,
        "links_after_failure_valid": links_after_failure,
        "links_after_failure_total": links_after_failure_total,
        "transaction_counts": transaction_counts(chain_data),
    }


def record_fingerprints(payload: Any, key: str | None) -> dict[str, str]:
    if key is not None:
        payload = payload.get(key) if isinstance(payload, dict) else None
    if isinstance(payload, dict):
        return {
            str(identity): hashlib.sha256(
                json.dumps(value, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
            ).hexdigest()
            for identity, value in payload.items()
        }
    if isinstance(payload, list):
        fingerprints = {}
        for item in payload:
            encoded = json.dumps(item, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
            fingerprint = hashlib.sha256(encoded).hexdigest()
            fingerprints[fingerprint] = fingerprint
        return fingerprints
    return {}


def compare_state(
    selected: Path,
    invalid: Path,
    reader: Callable[[Path, str], Any | None] = read_archive_json,
) -> dict[str, Any]:
    comparison = {}
    for label, (suffix, key) in STATE_SPECS.items():
        selected_payload = reader(selected, suffix)
        invalid_payload = reader(invalid, suffix)
        if selected_payload is None or invalid_payload is None:
            comparison[label] = {"available": False}
            continue
        selected_records = record_fingerprints(selected_payload, key)
        invalid_records = record_fingerprints(invalid_payload, key)
        selected_ids = set(selected_records)
        invalid_ids = set(invalid_records)
        comparison[label] = {
            "available": True,
            "restored_count": len(selected_ids),
            "latest_invalid_count": len(invalid_ids),
            "later_added_count": len(invalid_ids - selected_ids),
            "later_missing_count": len(selected_ids - invalid_ids),
            "later_changed_count": sum(
                selected_records[identity] != invalid_records[identity]
                for identity in selected_ids & invalid_ids
            ),
        }
    comparison["audit_snapshot_records"] = {"available": False}
    return comparison


def common_prefix_count(selected_data: dict[str, Any], invalid_data: dict[str, Any]) -> int:
    selected_chain = selected_data.get("chain", [])
    invalid_chain = invalid_data.get("chain", [])
    count = 0
    for selected_block, invalid_block in zip(selected_chain, invalid_chain):
        if not isinstance(selected_block, dict) or not isinstance(invalid_block, dict):
            break
        if selected_block.get("hash") != invalid_block.get("hash"):
            break
        count += 1
    return count


def comparison_details(
    selected_data: dict[str, Any],
    invalid_data: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    selected_detail = chain_detail(selected_data)
    invalid_detail = chain_detail(invalid_data)
    selected_blocks = selected_detail["block_count"]
    later_transactions = transaction_counts(invalid_data, selected_blocks)
    failure_index = invalid_detail["validation"].get("index")
    prefix_validation = None
    if isinstance(failure_index, int) and failure_index > 0:
        prefix_payload = {**invalid_data, "chain": invalid_data.get("chain", [])[:failure_index]}
        prefix_validation = evaluate_chain_payload(prefix_payload)
    comparison = {
        "validation": invalid_detail["validation"],
        "block_count": invalid_detail["block_count"],
        "transaction_count": invalid_detail["transaction_counts"]["total"],
        "common_prefix_block_count": common_prefix_count(selected_data, invalid_data),
        "blocks_not_restored": max(invalid_detail["block_count"] - selected_blocks, 0),
        "transactions_not_restored": max(
            invalid_detail["transaction_counts"]["total"] - selected_detail["transaction_counts"]["total"],
            0,
        ),
        "self_valid_block_count": invalid_detail["self_valid_block_count"],
        "linked_block_count": invalid_detail["linked_block_count"],
        "links_after_failure_valid": invalid_detail["links_after_failure_valid"],
        "links_after_failure_total": invalid_detail["links_after_failure_total"],
        "prefix_before_failure_validation": prefix_validation,
        "later_transaction_counts": later_transactions,
    }
    classification = {
        "json_snapshot_was_readable": True,
        "partial_write_or_interrupted_snapshot_less_likely": (
            invalid_detail["self_valid_block_count"] == invalid_detail["block_count"]
            and invalid_detail["links_after_failure_valid"] == invalid_detail["links_after_failure_total"]
        ),
        "broken_predecessor_or_branch_boundary_pattern": (
            invalid_detail["validation"].get("code") == "BLOCK_LINK_MISMATCH"
            and invalid_detail["self_valid_block_count"] == invalid_detail["block_count"]
        ),
        "exact_origin_determined": False,
    }
    return comparison, classification


def build_directory_report(selected_directory: Path, invalid_directory: Path) -> dict[str, Any]:
    selected_data = read_directory_json(selected_directory, "chain.json")
    invalid_data = read_directory_json(invalid_directory, "chain.json")
    if not isinstance(selected_data, dict) or not isinstance(invalid_data, dict):
        return {"diagnostic": "chain_forensic_reconciliation", "status": "state_directory_unavailable"}

    selected_detail = chain_detail(selected_data)
    comparison, classification = comparison_details(selected_data, invalid_data)
    return {
        "diagnostic": "chain_forensic_reconciliation",
        "status": "preserved_state_compared",
        "selected_state_reference": {
            "block_count": selected_detail["block_count"],
            "transaction_count": selected_detail["transaction_counts"]["total"],
        },
        "preserved_invalid_comparison": comparison,
        "user_visible_record_deltas": compare_state(
            selected_directory,
            invalid_directory,
            reader=read_directory_json,
        ),
        "sanitized_classification": classification,
    }


def build_report(directory: Path) -> dict[str, Any]:
    archives = sorted(directory.glob("vorliq-backup-*.tar.gz"), key=lambda path: path.stat().st_mtime, reverse=True)
    selected_index = None
    invalid_summaries = []
    for index, archive in enumerate(archives):
        data = archive_chain(archive)
        detail = (
            chain_detail(data)
            if data is not None
            else {"validation": {"status": "invalid", "code": "ARCHIVE_UNREADABLE"}}
        )
        if detail["validation"]["status"] == "valid":
            selected_index = index
            break
        invalid_summaries.append(detail)

    if selected_index is None:
        return {
            "diagnostic": "chain_forensic_reconciliation",
            "status": "no_valid_archive",
            "archives_checked": len(archives),
        }

    selected_archive = archives[selected_index]
    selected_data = archive_chain(selected_archive)
    assert selected_data is not None
    selected_detail = chain_detail(selected_data)
    newer_invalid = archives[:selected_index]
    failure_patterns: dict[str, int] = {}
    failure_indices: dict[str, int] = {}
    invalid_block_counts = []
    for detail in invalid_summaries:
        validation = detail["validation"]
        code = str(validation.get("code") or "UNKNOWN")
        failure_patterns[code] = failure_patterns.get(code, 0) + 1
        if validation.get("index") is not None:
            index_key = str(validation["index"])
            failure_indices[index_key] = failure_indices.get(index_key, 0) + 1
        if detail.get("block_count") is not None:
            invalid_block_counts.append(int(detail["block_count"]))

    report: dict[str, Any] = {
        "diagnostic": "chain_forensic_reconciliation",
        "status": "valid_archive_selected",
        "selected_archive_reference": {
            "age_rank": selected_index + 1,
            "block_count": selected_detail["block_count"],
            "transaction_count": selected_detail["transaction_counts"]["total"],
        },
        "newer_invalid_archive_count": len(newer_invalid),
        "invalid_archive_failure_codes": failure_patterns,
        "invalid_archive_failure_indices": failure_indices,
        "invalid_archive_block_count_range": {
            "minimum": min(invalid_block_counts) if invalid_block_counts else None,
            "maximum": max(invalid_block_counts) if invalid_block_counts else None,
        },
    }

    if newer_invalid:
        latest_invalid = newer_invalid[0]
        latest_data = archive_chain(latest_invalid)
        assert latest_data is not None
        report["latest_invalid_comparison"], classification = comparison_details(selected_data, latest_data)
        report["user_visible_record_deltas"] = compare_state(selected_archive, latest_invalid)
        report["sanitized_classification"] = {
            **classification,
            "repeated_same_failure_across_newer_archives": len(failure_patterns) == 1 and len(failure_indices) == 1,
        }
    return report


def main() -> int:
    logging.disable(logging.CRITICAL)
    parser = argparse.ArgumentParser()
    parser.add_argument("--directory")
    parser.add_argument("--selected-data-directory")
    parser.add_argument("--invalid-data-directory")
    args = parser.parse_args()
    if args.directory:
        report = build_report(Path(args.directory))
    elif args.selected_data_directory and args.invalid_data_directory:
        report = build_directory_report(Path(args.selected_data_directory), Path(args.invalid_data_directory))
    else:
        parser.error("provide --directory or both --selected-data-directory and --invalid-data-directory")
    print(json.dumps(report, sort_keys=True))
    return 0 if report["status"] in {"valid_archive_selected", "preserved_state_compared"} else 1


if __name__ == "__main__":
    raise SystemExit(main())
