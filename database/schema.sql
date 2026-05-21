-- Vorliq PostgreSQL schema draft.
-- Preparation only: this schema is not active production storage.
-- Hardened JSON files remain the source of truth until a future cutover is explicitly approved.

CREATE TABLE IF NOT EXISTS blocks (
  block_hash TEXT PRIMARY KEY,
  block_index BIGINT NOT NULL UNIQUE,
  previous_hash TEXT NOT NULL,
  nonce BIGINT NOT NULL,
  block_timestamp DOUBLE PRECISION NOT NULL,
  difficulty INTEGER,
  miner_address TEXT,
  transaction_count INTEGER NOT NULL DEFAULT 0,
  raw_block_json JSONB NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS confirmed_transactions (
  transaction_pk TEXT PRIMARY KEY,
  tx_id TEXT,
  block_hash TEXT NOT NULL REFERENCES blocks(block_hash),
  block_index BIGINT NOT NULL,
  transaction_index INTEGER NOT NULL,
  sender_address TEXT,
  receiver_address TEXT,
  amount NUMERIC,
  transaction_type TEXT,
  category TEXT,
  transaction_timestamp DOUBLE PRECISION,
  raw_transaction_json JSONB NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (block_hash, transaction_index)
);

CREATE TABLE IF NOT EXISTS pending_transactions (
  pending_pk TEXT PRIMARY KEY,
  tx_id TEXT,
  sender_address TEXT,
  receiver_address TEXT,
  amount NUMERIC,
  transaction_type TEXT,
  category TEXT,
  transaction_timestamp DOUBLE PRECISION,
  raw_transaction_json JSONB NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS peers (
  peer_url TEXT PRIMARY KEY,
  raw_peer_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS registry_nodes (
  node_url TEXT PRIMARY KEY,
  display_name TEXT,
  operator_wallet_address TEXT,
  region TEXT,
  status TEXT,
  last_seen_at DOUBLE PRECISION,
  last_chain_height BIGINT,
  reliability_score NUMERIC,
  raw_node_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lending_loans (
  loan_id TEXT PRIMARY KEY,
  requester_address TEXT,
  amount NUMERIC,
  repayment_amount NUMERIC,
  status TEXT,
  due_block BIGINT,
  created_at DOUBLE PRECISION,
  votes_json JSONB,
  status_history_json JSONB,
  raw_loan_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS exchange_offers (
  offer_id TEXT PRIMARY KEY,
  creator_address TEXT,
  acceptor_address TEXT,
  offer_type TEXT,
  amount NUMERIC,
  price TEXT,
  status TEXT,
  created_at DOUBLE PRECISION,
  status_history_json JSONB,
  raw_offer_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS governance_proposals (
  proposal_id TEXT PRIMARY KEY,
  proposer_address TEXT,
  category TEXT,
  parameter TEXT,
  status TEXT,
  voting_deadline BIGINT,
  created_at DOUBLE PRECISION,
  votes_json JSONB,
  status_history_json JSONB,
  raw_proposal_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS governance_rule_changes (
  rule_change_id TEXT PRIMARY KEY,
  proposal_id TEXT REFERENCES governance_proposals(proposal_id),
  category TEXT,
  parameter TEXT,
  old_value_json JSONB,
  new_value_json JSONB,
  applied_block_height BIGINT,
  status TEXT,
  raw_rule_change_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS treasury_proposals (
  proposal_id TEXT PRIMARY KEY,
  proposer_address TEXT,
  recipient_address TEXT,
  requested_amount NUMERIC,
  status TEXT,
  payout_tx_id TEXT,
  created_at DOUBLE PRECISION,
  votes_json JSONB,
  raw_proposal_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS treasury_ledger (
  ledger_id TEXT PRIMARY KEY,
  tx_id TEXT,
  block_hash TEXT REFERENCES blocks(block_hash),
  block_index BIGINT,
  ledger_type TEXT,
  from_address TEXT,
  to_address TEXT,
  amount NUMERIC,
  proposal_id TEXT,
  ledger_timestamp DOUBLE PRECISION,
  raw_ledger_json JSONB NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS price_signals (
  signal_id TEXT PRIMARY KEY,
  address TEXT,
  currency TEXT,
  price NUMERIC,
  status TEXT,
  signal_timestamp DOUBLE PRECISION,
  expires_at DOUBLE PRECISION,
  raw_signal_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS forum_posts (
  post_id TEXT PRIMARY KEY,
  author_address TEXT,
  title TEXT,
  body TEXT,
  moderation_status TEXT,
  vote_count INTEGER,
  post_timestamp DOUBLE PRECISION,
  raw_post_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS forum_replies (
  reply_id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES forum_posts(post_id),
  author_address TEXT,
  body TEXT,
  moderation_status TEXT,
  reply_timestamp DOUBLE PRECISION,
  raw_reply_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reports (
  report_id TEXT PRIMARY KEY,
  target_type TEXT,
  target_id TEXT,
  reported_by_address TEXT,
  reason TEXT,
  status TEXT,
  created_at DOUBLE PRECISION,
  updated_at DOUBLE PRECISION,
  raw_report_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS achievements (
  achievement_pk TEXT PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  achievement_id TEXT NOT NULL,
  earned_at DOUBLE PRECISION,
  raw_achievement_json JSONB NOT NULL,
  UNIQUE (wallet_address, achievement_id)
);

CREATE TABLE IF NOT EXISTS profiles (
  wallet_address TEXT PRIMARY KEY,
  display_name TEXT,
  bio TEXT,
  avatar TEXT,
  reputation_score NUMERIC,
  raw_profile_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS faucet_claims (
  claim_id TEXT PRIMARY KEY,
  wallet_address TEXT,
  amount NUMERIC,
  status TEXT,
  tx_id TEXT,
  requested_at DOUBLE PRECISION,
  completed_at DOUBLE PRECISION,
  raw_claim_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS analytics_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT,
  route TEXT,
  category TEXT,
  event_timestamp DOUBLE PRECISION,
  raw_event_json JSONB NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS incidents (
  incident_id TEXT PRIMARY KEY,
  title TEXT,
  severity TEXT,
  status TEXT,
  created_at DOUBLE PRECISION,
  updated_at DOUBLE PRECISION,
  raw_incident_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_exports_metadata (
  export_id TEXT PRIMARY KEY,
  export_type TEXT,
  chain_height BIGINT,
  latest_block_hash TEXT,
  sha256 TEXT,
  generated_at TIMESTAMPTZ,
  raw_export_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS storage_health_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  overall_status TEXT,
  chain_height BIGINT,
  latest_block_hash TEXT,
  warnings_count INTEGER,
  errors_count INTEGER,
  checked_at TIMESTAMPTZ NOT NULL,
  raw_snapshot_json JSONB NOT NULL
);

