# Vorliq PostgreSQL Readiness

This directory contains preparation-only PostgreSQL schema artifacts for a future
database migration. Vorliq production storage remains hardened JSON. These files
are not applied by deployment, are not connected to a live database, and must not
be treated as the active source of truth.

## Files

- `schema.sql` defines future table shapes for canonical chain data, pending
  state, app state, operational events, and audit metadata.
- `indexes.sql` defines future query indexes for public explorer, account,
  leaderboard, moderation, and operations reads.
- `constraints.sql` defines compatibility constraints that are safe for future
  imports while preserving raw JSON payloads.
- `views.sql` defines future read-only views that could replace some derived
  JSON index reads after a verified cutover.
- `migrations/001_initial_schema.sql` is the first combined migration draft for
  a future migration system.

## Rules

- `chain.json` remains the active source of truth today.
- Historical blocks are immutable. Do not recalculate, normalize away, or rewrite
  block fields that participate in hashes.
- Confirmed transaction rows must keep `raw_transaction_json` for legacy
  compatibility, including transactions without `tx_id`.
- Pending transactions remain separate from confirmed transactions.
- Derived index data should be rebuilt after migration, not imported as truth.
- JSON backups remain the rollback source until a future database adapter passes
  parity, readiness, and smoke testing.

Validate these files without PostgreSQL installed:

```bash
python tools/postgres_schema_check.py
```

