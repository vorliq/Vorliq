-- Vorliq PostgreSQL view draft.
-- Preparation only: these views are future read models, not active production routes.
-- Current public reads continue to use JSON plus derived indexes.

CREATE OR REPLACE VIEW explorer_latest_blocks AS
SELECT
  block_index,
  block_hash,
  previous_hash,
  miner_address,
  block_timestamp,
  transaction_count
FROM blocks
ORDER BY block_index DESC;

CREATE OR REPLACE VIEW explorer_confirmed_transactions AS
SELECT
  transaction_pk,
  tx_id,
  block_index,
  block_hash,
  transaction_index,
  sender_address,
  receiver_address,
  amount,
  transaction_type,
  transaction_timestamp
FROM confirmed_transactions
ORDER BY block_index DESC, transaction_index DESC;

CREATE OR REPLACE VIEW address_activity AS
SELECT
  transaction_pk,
  tx_id,
  block_index,
  block_hash,
  sender_address AS address,
  'sent' AS direction,
  amount,
  transaction_timestamp
FROM confirmed_transactions
WHERE sender_address IS NOT NULL
UNION ALL
SELECT
  transaction_pk,
  tx_id,
  block_index,
  block_hash,
  receiver_address AS address,
  'received' AS direction,
  amount,
  transaction_timestamp
FROM confirmed_transactions
WHERE receiver_address IS NOT NULL;

CREATE OR REPLACE VIEW miner_leaderboard AS
SELECT
  miner_address,
  count(*) AS mined_blocks,
  max(block_index) AS latest_mined_block
FROM blocks
WHERE miner_address IS NOT NULL
GROUP BY miner_address
ORDER BY mined_blocks DESC, latest_mined_block DESC;

CREATE OR REPLACE VIEW public_storage_readiness AS
SELECT
  overall_status,
  chain_height,
  latest_block_hash,
  checked_at
FROM storage_health_snapshots
ORDER BY checked_at DESC;

