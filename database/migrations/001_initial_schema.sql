-- Vorliq PostgreSQL migration draft 001.
-- Preparation only: this migration is not applied by current deployment.
-- Production remains on hardened JSON until a future verified cutover.

BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Future migration runners should apply database/schema.sql, constraints.sql,
-- indexes.sql, and views.sql in that order after dry-run/import validation.
INSERT INTO schema_migrations (version, description)
VALUES ('001_initial_schema', 'Preparation-only initial PostgreSQL schema draft')
ON CONFLICT (version) DO NOTHING;

COMMIT;

