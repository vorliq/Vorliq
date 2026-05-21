-- Vorliq PostgreSQL constraint draft.
-- Preparation only: constraints are not enforced in production today.
-- Future imports must pass these without mutating JSON source files.

ALTER TABLE blocks
  ADD CONSTRAINT chk_blocks_hash_present CHECK (length(block_hash) >= 16),
  ADD CONSTRAINT chk_blocks_index_nonnegative CHECK (block_index >= 0),
  ADD CONSTRAINT chk_blocks_transaction_count_nonnegative CHECK (transaction_count >= 0);

ALTER TABLE confirmed_transactions
  ADD CONSTRAINT chk_confirmed_transaction_index_nonnegative CHECK (transaction_index >= 0),
  ADD CONSTRAINT chk_confirmed_amount_nonnegative CHECK (amount IS NULL OR amount >= 0);

ALTER TABLE pending_transactions
  ADD CONSTRAINT chk_pending_amount_nonnegative CHECK (amount IS NULL OR amount >= 0);

ALTER TABLE lending_loans
  ADD CONSTRAINT chk_lending_amount_nonnegative CHECK (amount IS NULL OR amount >= 0),
  ADD CONSTRAINT chk_lending_repayment_nonnegative CHECK (repayment_amount IS NULL OR repayment_amount >= 0);

ALTER TABLE exchange_offers
  ADD CONSTRAINT chk_exchange_amount_nonnegative CHECK (amount IS NULL OR amount >= 0);

ALTER TABLE treasury_proposals
  ADD CONSTRAINT chk_treasury_requested_amount_nonnegative CHECK (requested_amount IS NULL OR requested_amount >= 0);

ALTER TABLE treasury_ledger
  ADD CONSTRAINT chk_treasury_ledger_amount_nonnegative CHECK (amount IS NULL OR amount >= 0);

ALTER TABLE faucet_claims
  ADD CONSTRAINT chk_faucet_amount_nonnegative CHECK (amount IS NULL OR amount >= 0);

ALTER TABLE storage_health_snapshots
  ADD CONSTRAINT chk_storage_health_counts_nonnegative CHECK (
    (warnings_count IS NULL OR warnings_count >= 0)
    AND (errors_count IS NULL OR errors_count >= 0)
  );
