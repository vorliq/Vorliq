-- Vorliq PostgreSQL index draft.
-- Preparation only: these indexes are not installed in production.
-- JSON storage and derived JSON indexes remain active today.

CREATE INDEX IF NOT EXISTS idx_blocks_block_index ON blocks(block_index);
CREATE INDEX IF NOT EXISTS idx_blocks_block_hash ON blocks(block_hash);
CREATE INDEX IF NOT EXISTS idx_blocks_previous_hash ON blocks(previous_hash);
CREATE INDEX IF NOT EXISTS idx_blocks_miner_address ON blocks(miner_address);
CREATE INDEX IF NOT EXISTS idx_blocks_timestamp ON blocks(block_timestamp);

CREATE INDEX IF NOT EXISTS idx_confirmed_transactions_tx_id ON confirmed_transactions(tx_id);
CREATE INDEX IF NOT EXISTS idx_confirmed_transactions_block_hash ON confirmed_transactions(block_hash);
CREATE INDEX IF NOT EXISTS idx_confirmed_transactions_block_index ON confirmed_transactions(block_index);
CREATE INDEX IF NOT EXISTS idx_confirmed_transactions_sender_address ON confirmed_transactions(sender_address);
CREATE INDEX IF NOT EXISTS idx_confirmed_transactions_receiver_address ON confirmed_transactions(receiver_address);
CREATE INDEX IF NOT EXISTS idx_confirmed_transactions_timestamp ON confirmed_transactions(transaction_timestamp);

CREATE INDEX IF NOT EXISTS idx_pending_transactions_tx_id ON pending_transactions(tx_id);
CREATE INDEX IF NOT EXISTS idx_pending_transactions_sender_address ON pending_transactions(sender_address);
CREATE INDEX IF NOT EXISTS idx_pending_transactions_receiver_address ON pending_transactions(receiver_address);
CREATE INDEX IF NOT EXISTS idx_pending_transactions_timestamp ON pending_transactions(transaction_timestamp);

CREATE INDEX IF NOT EXISTS idx_peers_peer_url ON peers(peer_url);
CREATE INDEX IF NOT EXISTS idx_registry_nodes_status ON registry_nodes(status);
CREATE INDEX IF NOT EXISTS idx_registry_nodes_operator_wallet ON registry_nodes(operator_wallet_address);
CREATE INDEX IF NOT EXISTS idx_registry_nodes_last_seen ON registry_nodes(last_seen_at);

CREATE INDEX IF NOT EXISTS idx_lending_loans_requester_address ON lending_loans(requester_address);
CREATE INDEX IF NOT EXISTS idx_lending_loans_status ON lending_loans(status);
CREATE INDEX IF NOT EXISTS idx_lending_loans_due_block ON lending_loans(due_block);

CREATE INDEX IF NOT EXISTS idx_exchange_offers_creator_address ON exchange_offers(creator_address);
CREATE INDEX IF NOT EXISTS idx_exchange_offers_acceptor_address ON exchange_offers(acceptor_address);
CREATE INDEX IF NOT EXISTS idx_exchange_offers_status ON exchange_offers(status);
CREATE INDEX IF NOT EXISTS idx_exchange_offers_created_at ON exchange_offers(created_at);

CREATE INDEX IF NOT EXISTS idx_governance_proposals_proposer_address ON governance_proposals(proposer_address);
CREATE INDEX IF NOT EXISTS idx_governance_proposals_status ON governance_proposals(status);
CREATE INDEX IF NOT EXISTS idx_governance_proposals_voting_deadline ON governance_proposals(voting_deadline);
CREATE INDEX IF NOT EXISTS idx_governance_rule_changes_proposal_id ON governance_rule_changes(proposal_id);
CREATE INDEX IF NOT EXISTS idx_governance_rule_changes_status ON governance_rule_changes(status);

CREATE INDEX IF NOT EXISTS idx_treasury_proposals_proposer_address ON treasury_proposals(proposer_address);
CREATE INDEX IF NOT EXISTS idx_treasury_proposals_recipient_address ON treasury_proposals(recipient_address);
CREATE INDEX IF NOT EXISTS idx_treasury_proposals_status ON treasury_proposals(status);
CREATE INDEX IF NOT EXISTS idx_treasury_ledger_tx_id ON treasury_ledger(tx_id);
CREATE INDEX IF NOT EXISTS idx_treasury_ledger_block_index ON treasury_ledger(block_index);
CREATE INDEX IF NOT EXISTS idx_treasury_ledger_to_address ON treasury_ledger(to_address);
CREATE INDEX IF NOT EXISTS idx_treasury_ledger_timestamp ON treasury_ledger(ledger_timestamp);

CREATE INDEX IF NOT EXISTS idx_price_signals_address ON price_signals(address);
CREATE INDEX IF NOT EXISTS idx_price_signals_status ON price_signals(status);
CREATE INDEX IF NOT EXISTS idx_price_signals_timestamp ON price_signals(signal_timestamp);

CREATE INDEX IF NOT EXISTS idx_forum_posts_author_address ON forum_posts(author_address);
CREATE INDEX IF NOT EXISTS idx_forum_posts_moderation_status ON forum_posts(moderation_status);
CREATE INDEX IF NOT EXISTS idx_forum_posts_timestamp ON forum_posts(post_timestamp);
CREATE INDEX IF NOT EXISTS idx_forum_replies_post_id ON forum_replies(post_id);
CREATE INDEX IF NOT EXISTS idx_forum_replies_author_address ON forum_replies(author_address);
CREATE INDEX IF NOT EXISTS idx_forum_replies_timestamp ON forum_replies(reply_timestamp);

CREATE INDEX IF NOT EXISTS idx_reports_target ON reports(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_created_at ON reports(created_at);

CREATE INDEX IF NOT EXISTS idx_achievements_wallet_address ON achievements(wallet_address);
CREATE INDEX IF NOT EXISTS idx_profiles_display_name ON profiles(display_name);
CREATE INDEX IF NOT EXISTS idx_profiles_reputation_score ON profiles(reputation_score);
CREATE INDEX IF NOT EXISTS idx_faucet_claims_wallet_address ON faucet_claims(wallet_address);
CREATE INDEX IF NOT EXISTS idx_faucet_claims_status ON faucet_claims(status);
CREATE INDEX IF NOT EXISTS idx_faucet_claims_requested_at ON faucet_claims(requested_at);

CREATE INDEX IF NOT EXISTS idx_analytics_events_type ON analytics_events(event_type);
CREATE INDEX IF NOT EXISTS idx_analytics_events_route ON analytics_events(route);
CREATE INDEX IF NOT EXISTS idx_analytics_events_timestamp ON analytics_events(event_timestamp);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);
CREATE INDEX IF NOT EXISTS idx_incidents_severity ON incidents(severity);
CREATE INDEX IF NOT EXISTS idx_incidents_created_at ON incidents(created_at);

CREATE INDEX IF NOT EXISTS idx_audit_exports_chain_height ON audit_exports_metadata(chain_height);
CREATE INDEX IF NOT EXISTS idx_audit_exports_latest_hash ON audit_exports_metadata(latest_block_hash);
CREATE INDEX IF NOT EXISTS idx_storage_health_checked_at ON storage_health_snapshots(checked_at);
CREATE INDEX IF NOT EXISTS idx_storage_health_status ON storage_health_snapshots(overall_status);

