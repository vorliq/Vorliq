#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Any

from postgres_shadow_common import (
    DATABASE_DIR,
    DEFAULT_DATA_DIR,
    SQL_FILES,
    SHADOW_TABLES,
    SHADOW_VIEWS,
    achievement_rows,
    as_list,
    as_mapping,
    chain_blocks,
    confirmed_transactions,
    expected_counts,
    iso_now,
    load_psycopg,
    load_shadow_source,
    parse_database_url,
    pending_transactions,
    to_decimal,
    validate_shadow_database_url,
)


def progress(message: str) -> None:
    print(f"[shadow-migrate] {message}")


def split_sql(sql: str) -> list[str]:
    statements: list[str] = []
    current: list[str] = []
    in_single_quote = False
    in_double_quote = False
    previous = ""
    for character in sql:
        if character == "'" and previous != "\\" and not in_double_quote:
            in_single_quote = not in_single_quote
        elif character == '"' and previous != "\\" and not in_single_quote:
            in_double_quote = not in_double_quote
        if character == ";" and not in_single_quote and not in_double_quote:
            statement = "".join(current).strip()
            if statement:
                statements.append(statement)
            current = []
        else:
            current.append(character)
        previous = character
    trailing = "".join(current).strip()
    if trailing:
        statements.append(trailing)
    return statements


def execute_sql_file(conn: Any, relative_path: str) -> None:
    path = DATABASE_DIR / relative_path
    sql = path.read_text(encoding="utf-8")
    with conn.cursor() as cursor:
        for statement in split_sql(sql):
            cursor.execute(statement)


def reset_shadow_schema(conn: Any) -> None:
    with conn.cursor() as cursor:
        for view_name in SHADOW_VIEWS:
            cursor.execute(f'DROP VIEW IF EXISTS "{view_name}" CASCADE')
        for table_name in SHADOW_TABLES:
            cursor.execute(f'DROP TABLE IF EXISTS "{table_name}" CASCADE')


def cleanup_shadow_database(conn: Any) -> None:
    reset_shadow_schema(conn)


def wrap_json(Jsonb: Any, value: Any) -> Any:
    return Jsonb(value)


def insert_many(conn: Any, table: str, columns: list[str], rows: list[dict[str, Any]], Jsonb: Any) -> int:
    if not rows:
        return 0
    placeholders = ", ".join(["%s"] * len(columns))
    column_sql = ", ".join(columns)
    values = []
    for row in rows:
        values.append([
            wrap_json(Jsonb, row[column]) if column.startswith("raw_") or column.endswith("_json") else row.get(column)
            for column in columns
        ])
    with conn.cursor() as cursor:
        cursor.executemany(f"INSERT INTO {table} ({column_sql}) VALUES ({placeholders})", values)
    return len(rows)


def block_rows(source: dict[str, Any]) -> list[dict[str, Any]]:
    rows = []
    for block in chain_blocks(source):
        rows.append(
            {
                "block_hash": str(block.get("hash") or ""),
                "block_index": int(block.get("index") or 0),
                "previous_hash": str(block.get("previous_hash") or ""),
                "nonce": int(block.get("nonce") or 0),
                "block_timestamp": block.get("timestamp"),
                "difficulty": block.get("difficulty"),
                "miner_address": block.get("miner_address"),
                "transaction_count": len(block.get("transactions") or []),
                "raw_block_json": block,
            }
        )
    return rows


def simple_mapping_rows(source: dict[str, Any], source_name: str, field: str, id_field: str) -> list[tuple[str, dict[str, Any]]]:
    rows = []
    for key, payload in as_mapping(source.get("files", {}).get(source_name), field).items():
        if isinstance(payload, dict):
            rows.append((str(payload.get(id_field) or key), payload))
    return rows


def import_rows(conn: Any, source: dict[str, Any], Jsonb: Any) -> dict[str, int]:
    files = source.get("files", {})
    inserted: dict[str, int] = {}

    inserted["blocks"] = insert_many(
        conn,
        "blocks",
        ["block_hash", "block_index", "previous_hash", "nonce", "block_timestamp", "difficulty", "miner_address", "transaction_count", "raw_block_json"],
        block_rows(source),
        Jsonb,
    )
    inserted["confirmed_transactions"] = insert_many(
        conn,
        "confirmed_transactions",
        [
            "transaction_pk",
            "tx_id",
            "block_hash",
            "block_index",
            "transaction_index",
            "sender_address",
            "receiver_address",
            "amount",
            "transaction_type",
            "category",
            "transaction_timestamp",
            "raw_transaction_json",
        ],
        confirmed_transactions(source),
        Jsonb,
    )
    inserted["pending_transactions"] = insert_many(
        conn,
        "pending_transactions",
        ["pending_pk", "tx_id", "sender_address", "receiver_address", "amount", "transaction_type", "category", "transaction_timestamp", "raw_transaction_json"],
        pending_transactions(source),
        Jsonb,
    )

    profiles = [
        {
            "wallet_address": wallet,
            "display_name": profile.get("display_name"),
            "bio": profile.get("bio"),
            "avatar": profile.get("avatar"),
            "reputation_score": to_decimal(profile.get("reputation_score")),
            "raw_profile_json": profile,
        }
        for wallet, profile in as_mapping(files.get("profiles"), "profiles").items()
        if isinstance(profile, dict)
    ]
    inserted["profiles"] = insert_many(conn, "profiles", ["wallet_address", "display_name", "bio", "avatar", "reputation_score", "raw_profile_json"], profiles, Jsonb)

    registry_nodes = [
        {
            "node_url": node_url,
            "display_name": node.get("display_name"),
            "operator_wallet_address": node.get("operator_wallet_address"),
            "region": node.get("region"),
            "status": node.get("status") or node.get("sync_status"),
            "last_seen_at": node.get("last_seen") or node.get("last_heartbeat_at"),
            "last_chain_height": node.get("last_chain_height"),
            "reliability_score": to_decimal(node.get("reliability_score")),
            "raw_node_json": node,
        }
        for node_url, node in simple_mapping_rows(source, "registry", "registered_nodes", "node_url")
    ]
    inserted["registry_nodes"] = insert_many(conn, "registry_nodes", ["node_url", "display_name", "operator_wallet_address", "region", "status", "last_seen_at", "last_chain_height", "reliability_score", "raw_node_json"], registry_nodes, Jsonb)

    lending_loans = [
        {
            "loan_id": loan_id,
            "requester_address": loan.get("requester_address"),
            "amount": to_decimal(loan.get("amount")),
            "repayment_amount": to_decimal(loan.get("repayment_amount")),
            "status": loan.get("status"),
            "due_block": loan.get("due_block"),
            "created_at": loan.get("created_at") or loan.get("timestamp"),
            "votes_json": loan.get("votes") or {},
            "status_history_json": loan.get("status_history") or [],
            "raw_loan_json": loan,
        }
        for loan_id, loan in simple_mapping_rows(source, "lending", "loan_requests", "loan_id")
    ]
    inserted["lending_loans"] = insert_many(conn, "lending_loans", ["loan_id", "requester_address", "amount", "repayment_amount", "status", "due_block", "created_at", "votes_json", "status_history_json", "raw_loan_json"], lending_loans, Jsonb)

    exchange_offers = [
        {
            "offer_id": offer_id,
            "creator_address": offer.get("creator_address"),
            "acceptor_address": offer.get("acceptor_address"),
            "offer_type": offer.get("offer_type"),
            "amount": to_decimal(offer.get("amount")),
            "price": str(offer.get("price")) if offer.get("price") is not None else None,
            "status": offer.get("status"),
            "created_at": offer.get("created_at") or offer.get("timestamp"),
            "status_history_json": offer.get("status_history") or [],
            "raw_offer_json": offer,
        }
        for offer_id, offer in simple_mapping_rows(source, "exchange", "offers", "offer_id")
    ]
    inserted["exchange_offers"] = insert_many(conn, "exchange_offers", ["offer_id", "creator_address", "acceptor_address", "offer_type", "amount", "price", "status", "created_at", "status_history_json", "raw_offer_json"], exchange_offers, Jsonb)

    governance_proposals = [
        {
            "proposal_id": proposal_id,
            "proposer_address": proposal.get("proposer_address"),
            "category": proposal.get("category"),
            "parameter": str(proposal.get("parameter")) if proposal.get("parameter") is not None else None,
            "status": proposal.get("status"),
            "voting_deadline": proposal.get("voting_deadline"),
            "created_at": proposal.get("created_at") or proposal.get("timestamp"),
            "votes_json": proposal.get("votes") or {},
            "status_history_json": proposal.get("status_history") or [],
            "raw_proposal_json": proposal,
        }
        for proposal_id, proposal in simple_mapping_rows(source, "governance", "proposals", "proposal_id")
    ]
    inserted["governance_proposals"] = insert_many(conn, "governance_proposals", ["proposal_id", "proposer_address", "category", "parameter", "status", "voting_deadline", "created_at", "votes_json", "status_history_json", "raw_proposal_json"], governance_proposals, Jsonb)

    rule_changes = []
    for index, rule in enumerate(as_list((files.get("governance") or {}).get("rule_changes")) if isinstance(files.get("governance"), dict) else []):
        if isinstance(rule, dict):
            rule_changes.append(
                {
                    "rule_change_id": str(rule.get("rule_change_id") or rule.get("id") or f"rule-change-{index}"),
                    "proposal_id": rule.get("proposal_id"),
                    "category": rule.get("category"),
                    "parameter": str(rule.get("parameter")) if rule.get("parameter") is not None else None,
                    "old_value_json": rule.get("old_value"),
                    "new_value_json": rule.get("new_value"),
                    "applied_block_height": rule.get("applied_block_height"),
                    "status": rule.get("status"),
                    "raw_rule_change_json": rule,
                }
            )
    inserted["governance_rule_changes"] = insert_many(conn, "governance_rule_changes", ["rule_change_id", "proposal_id", "category", "parameter", "old_value_json", "new_value_json", "applied_block_height", "status", "raw_rule_change_json"], rule_changes, Jsonb)

    treasury_proposals = [
        {
            "proposal_id": proposal_id,
            "proposer_address": proposal.get("proposer_address"),
            "recipient_address": proposal.get("recipient_address"),
            "requested_amount": to_decimal(proposal.get("requested_amount")),
            "status": proposal.get("status"),
            "payout_tx_id": proposal.get("payout_tx_id"),
            "created_at": proposal.get("created_at") or proposal.get("timestamp"),
            "votes_json": proposal.get("votes") or {},
            "raw_proposal_json": proposal,
        }
        for proposal_id, proposal in simple_mapping_rows(source, "treasury", "proposals", "proposal_id")
    ]
    inserted["treasury_proposals"] = insert_many(conn, "treasury_proposals", ["proposal_id", "proposer_address", "recipient_address", "requested_amount", "status", "payout_tx_id", "created_at", "votes_json", "raw_proposal_json"], treasury_proposals, Jsonb)

    indexes = files.get("indexes") if isinstance(files.get("indexes"), dict) else {}
    treasury_ledger = []
    for index, entry in enumerate(((indexes.get("indexes") or {}).get("treasury_ledger_index") or []) if isinstance(indexes, dict) else []):
        if isinstance(entry, dict):
            treasury_ledger.append(
                {
                    "ledger_id": str(entry.get("ledger_id") or entry.get("tx_id") or f"ledger-{index}"),
                    "tx_id": entry.get("tx_id"),
                    "block_hash": entry.get("block_hash"),
                    "block_index": entry.get("block_index"),
                    "ledger_type": entry.get("type"),
                    "from_address": entry.get("sender_address") or entry.get("from_address"),
                    "to_address": entry.get("receiver_address") or entry.get("to_address"),
                    "amount": to_decimal(entry.get("amount")),
                    "proposal_id": entry.get("proposal_id"),
                    "ledger_timestamp": entry.get("timestamp"),
                    "raw_ledger_json": entry,
                }
            )
    inserted["treasury_ledger"] = insert_many(conn, "treasury_ledger", ["ledger_id", "tx_id", "block_hash", "block_index", "ledger_type", "from_address", "to_address", "amount", "proposal_id", "ledger_timestamp", "raw_ledger_json"], treasury_ledger, Jsonb)

    price_signals = [
        {
            "signal_id": signal_id,
            "address": signal.get("address") or signal.get("wallet_address"),
            "currency": signal.get("currency"),
            "price": to_decimal(signal.get("price")),
            "status": signal.get("status"),
            "signal_timestamp": signal.get("timestamp") or signal.get("created_at"),
            "expires_at": signal.get("expires_at"),
            "raw_signal_json": signal,
        }
        for signal_id, signal in simple_mapping_rows(source, "price", "signals", "signal_id")
    ]
    inserted["price_signals"] = insert_many(conn, "price_signals", ["signal_id", "address", "currency", "price", "status", "signal_timestamp", "expires_at", "raw_signal_json"], price_signals, Jsonb)

    forum_posts = []
    forum_replies = []
    for post_id, post in simple_mapping_rows(source, "forum", "posts", "post_id"):
        forum_posts.append(
            {
                "post_id": post_id,
                "author_address": post.get("author_address"),
                "title": post.get("title"),
                "body": post.get("body"),
                "moderation_status": post.get("moderation_status") or post.get("status"),
                "vote_count": post.get("vote_count") or len(post.get("votes", {}) or {}),
                "post_timestamp": post.get("timestamp") or post.get("created_at"),
                "raw_post_json": post,
            }
        )
        for index, reply in enumerate(post.get("replies") or []):
            if isinstance(reply, dict):
                forum_replies.append(
                    {
                        "reply_id": str(reply.get("reply_id") or reply.get("id") or f"{post_id}:reply:{index}"),
                        "post_id": post_id,
                        "author_address": reply.get("author_address"),
                        "body": reply.get("body"),
                        "moderation_status": reply.get("moderation_status") or reply.get("status"),
                        "reply_timestamp": reply.get("timestamp") or reply.get("created_at"),
                        "raw_reply_json": reply,
                    }
                )
    inserted["forum_posts"] = insert_many(conn, "forum_posts", ["post_id", "author_address", "title", "body", "moderation_status", "vote_count", "post_timestamp", "raw_post_json"], forum_posts, Jsonb)
    inserted["forum_replies"] = insert_many(conn, "forum_replies", ["reply_id", "post_id", "author_address", "body", "moderation_status", "reply_timestamp", "raw_reply_json"], forum_replies, Jsonb)

    inserted["achievements"] = insert_many(conn, "achievements", ["achievement_pk", "wallet_address", "achievement_id", "earned_at", "raw_achievement_json"], achievement_rows(source), Jsonb)

    faucet_claims = [
        {
            "claim_id": claim_id,
            "wallet_address": claim.get("wallet_address"),
            "amount": to_decimal(claim.get("amount")),
            "status": claim.get("status"),
            "tx_id": claim.get("tx_id"),
            "requested_at": claim.get("requested_at") or claim.get("timestamp"),
            "completed_at": claim.get("completed_at"),
            "raw_claim_json": claim,
        }
        for claim_id, claim in simple_mapping_rows(source, "faucet", "claims", "claim_id")
    ]
    inserted["faucet_claims"] = insert_many(conn, "faucet_claims", ["claim_id", "wallet_address", "amount", "status", "tx_id", "requested_at", "completed_at", "raw_claim_json"], faucet_claims, Jsonb)

    incidents = []
    for index, incident in enumerate(as_list((files.get("incidents") or {}).get("incidents")) if isinstance(files.get("incidents"), dict) else []):
        if isinstance(incident, dict):
            incidents.append(
                {
                    "incident_id": str(incident.get("incident_id") or incident.get("id") or f"incident-{index}"),
                    "title": incident.get("title"),
                    "severity": incident.get("severity"),
                    "status": incident.get("status"),
                    "created_at": incident.get("created_at"),
                    "updated_at": incident.get("updated_at"),
                    "raw_incident_json": incident,
                }
            )
    inserted["incidents"] = insert_many(conn, "incidents", ["incident_id", "title", "severity", "status", "created_at", "updated_at", "raw_incident_json"], incidents, Jsonb)

    analytics = []
    for index, event in enumerate(as_list((files.get("analytics") or {}).get("events")) if isinstance(files.get("analytics"), dict) else []):
        if isinstance(event, dict):
            analytics.append(
                {
                    "event_id": str(event.get("event_id") or event.get("id") or f"analytics-{index}"),
                    "event_type": event.get("event_type") or event.get("type"),
                    "route": event.get("route"),
                    "category": event.get("category"),
                    "event_timestamp": event.get("timestamp") or event.get("created_at"),
                    "raw_event_json": event,
                }
            )
    inserted["analytics_events"] = insert_many(conn, "analytics_events", ["event_id", "event_type", "route", "category", "event_timestamp", "raw_event_json"], analytics, Jsonb)

    reports = []
    for index, report in enumerate(as_list((files.get("reports") or {}).get("reports")) if isinstance(files.get("reports"), dict) else []):
        if isinstance(report, dict):
            reports.append(
                {
                    "report_id": str(report.get("report_id") or report.get("id") or f"report-{index}"),
                    "target_type": report.get("target_type"),
                    "target_id": report.get("target_id"),
                    "reported_by_address": report.get("reported_by_address"),
                    "reason": report.get("reason"),
                    "status": report.get("status"),
                    "created_at": report.get("created_at"),
                    "updated_at": report.get("updated_at"),
                    "raw_report_json": report,
                }
            )
    inserted["reports"] = insert_many(conn, "reports", ["report_id", "target_type", "target_id", "reported_by_address", "reason", "status", "created_at", "updated_at", "raw_report_json"], reports, Jsonb)

    return inserted


def run_shadow_migration(
    *,
    data_dir: Path,
    database_url: str,
    backend_data_dir: Path | None = None,
    strict: bool = False,
    reset: bool = True,
) -> dict[str, Any]:
    psycopg, Jsonb = load_psycopg()
    source = load_shadow_source(data_dir, backend_data_dir=backend_data_dir, strict=strict)
    if source["errors"]:
        return {
            "success": False,
            "status": "fail",
            "checked_at": iso_now(),
            "warnings": source["warnings"],
            "errors": source["errors"],
            "counts": {},
        }

    info = parse_database_url(database_url)
    progress(f"Connecting to shadow database {info['redacted']}")
    with psycopg.connect(database_url) as conn:
        conn.autocommit = True
        if reset:
            progress("Resetting existing shadow rehearsal objects")
            reset_shadow_schema(conn)
        progress("Applying PostgreSQL schema files")
        for relative_path in SQL_FILES:
            execute_sql_file(conn, relative_path)
        progress("Importing copied JSON state into shadow tables")
        inserted = import_rows(conn, source, Jsonb)

    return {
        "success": True,
        "status": "pass",
        "checked_at": iso_now(),
        "source_data_dir": str(data_dir.resolve()),
        "backend_data_dir": source.get("backend_data_dir"),
        "database": {"host": info["host"], "database": info["database"]},
        "postgres_active": False,
        "production_storage_unchanged": True,
        "json_source_modified": False,
        "expected_counts": expected_counts(source),
        "counts": inserted,
        "warnings": source["warnings"],
        "errors": [],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Import copied Vorliq JSON state into a guarded PostgreSQL shadow database.")
    parser.add_argument("--data-dir", default=str(DEFAULT_DATA_DIR), help="Path to copied blockchain/data JSON state.")
    parser.add_argument("--backend-data-dir", help="Optional copied backend/data directory for analytics/incidents/reports.")
    parser.add_argument("--database-url", default=os.environ.get("SHADOW_DATABASE_URL"), help="Shadow PostgreSQL URL, or SHADOW_DATABASE_URL.")
    parser.add_argument("--strict", action="store_true", help="Fail when optional JSON files are missing.")
    parser.add_argument("--i-understand-this-is-not-production", action="store_true", help="Documents operator intent; production-looking hosts or names are still refused.")
    args = parser.parse_args(argv)

    database_url, validation_errors = validate_shadow_database_url(
        args.database_url,
        intent_flag=args.i_understand_this_is_not_production,
    )
    if validation_errors:
        print("Vorliq PostgreSQL shadow migration")
        print("Status: fail")
        for error in validation_errors:
            print(f"  - {error}")
        return 1

    progress("Vorliq PostgreSQL shadow migration starting")
    try:
        result = run_shadow_migration(
            data_dir=Path(args.data_dir),
            backend_data_dir=Path(args.backend_data_dir) if args.backend_data_dir else None,
            database_url=database_url or "",
            strict=args.strict,
        )
    except RuntimeError as exc:
        result = {
            "success": False,
            "status": "fail",
            "counts": {},
            "warnings": [],
            "errors": [str(exc)],
        }
    print("Vorliq PostgreSQL shadow migration")
    print(f"Status: {result['status']}")
    print("Production PostgreSQL active: false")
    print("JSON source modified: false")
    print(f"Tables imported: {len(result.get('counts', {}))}")
    if result.get("warnings"):
        print(f"Warnings: {len(result['warnings'])}")
        for warning in result["warnings"]:
            print(f"  - {warning}")
    if result.get("errors"):
        print("Errors:")
        for error in result["errors"]:
            print(f"  - {error}")
    return 0 if result.get("success") else 1


if __name__ == "__main__":
    raise SystemExit(main())
