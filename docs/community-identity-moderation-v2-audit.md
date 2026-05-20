# Community Identity and Moderation v2 Audit

Vorliq profiles currently store public wallet-linked fields: wallet address, display name, bio, location, country, avatar style, website, X link, Telegram link, Discord name, creation/update timestamps, reputation score, ambassador flag, and public badges. The v2 layer adds wallet-control verification fields: `verified_wallet`, `verification_message`, and `verified_at`.

Reputation is calculated from transparent community activity: profile existence, achievements, forum posts and replies, completed exchange trades, repaid loans, governance votes, treasury votes, and mined blocks. It is a public activity signal, not a legal trust score.

Before v2, moderation was limited to public validation, rate limits, protected admin routes, incident tools, and forum pin/feature controls. Chat had in-memory public history and basic message-length/rate validation.

Remaining risks were impersonation by display name, spam reports living outside the app, no wallet-control badge, no hidden/locked forum states, no report queue, and limited chat moderation metadata. The v2 changes add non-KYC wallet verification, factual trust labels, public report submission, protected report review, non-destructive forum hide/lock moderation, and chat message IDs/cooldowns without deleting blockchain history or collecting government identity.
