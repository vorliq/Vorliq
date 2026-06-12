import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import ErrorMessage from "../components/ErrorMessage";
import Spinner from "../components/Spinner";
import { useAuth } from "../context/AuthContext";
import api from "../helpers/api";
import { apiErrorMessage } from "../helpers/errors";
import { formatTime, formatVlq, shortHash } from "../helpers/publicApi";

function settledData(result) {
  return result.status === "fulfilled" ? result.value.data : null;
}

function unavailable(result) {
  return result.status === "rejected" || result.value?.data?.success === false;
}

function numericValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function displayNumber(source, value, suffix = "") {
  if (!source || value === null || value === undefined || value === "") return "Unavailable";
  const number = numericValue(value);
  return number === null ? `${value}${suffix}` : `${number.toLocaleString(undefined, { maximumFractionDigits: 8 })}${suffix}`;
}

function statusText(source, value) {
  if (!source || value === null || value === undefined || value === "") return "Unavailable";
  return value;
}

function VLQ() {
  const { wallet, isLoggedIn } = useAuth();
  const [data, setData] = useState(null);
  const [walletData, setWalletData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let mounted = true;

    async function loadVlqOverview() {
      setLoading(true);
      try {
        const [
          summaryResult,
          economicsResult,
          confirmedResult,
          pendingResult,
          faucetResult,
          miningResult,
          treasuryResult,
          treasuryLedgerResult,
          lendingResult,
        ] = await Promise.allSettled([
          api.get("/chain/summary"),
          api.get("/economics"),
          api.get("/transactions", { params: { status: "confirmed", limit: 6, offset: 0 } }),
          api.get("/transactions/pending", { params: { limit: 6, offset: 0 } }),
          api.get("/faucet/summary"),
          api.get("/mining/status"),
          api.get("/treasury/summary"),
          api.get("/treasury/ledger", { params: { limit: 5, offset: 0 } }),
          api.get("/lending/summary"),
        ]);

        if (!mounted) return;
        setData({
          summary: settledData(summaryResult)?.summary || null,
          economics: settledData(economicsResult) || null,
          confirmed: settledData(confirmedResult) || null,
          pending: settledData(pendingResult) || null,
          faucet: settledData(faucetResult)?.summary || null,
          mining: settledData(miningResult)?.status || settledData(miningResult) || null,
          treasury: settledData(treasuryResult)?.summary || null,
          treasuryLedger: settledData(treasuryLedgerResult) || null,
          lending: settledData(lendingResult)?.summary || null,
          unavailable: {
            summary: unavailable(summaryResult),
            economics: unavailable(economicsResult),
            confirmed: unavailable(confirmedResult),
            pending: unavailable(pendingResult),
            faucet: unavailable(faucetResult),
            mining: unavailable(miningResult),
            treasury: unavailable(treasuryResult),
            treasuryLedger: unavailable(treasuryLedgerResult),
            lending: unavailable(lendingResult),
          },
        });
        setErrorMessage("");
      } catch (error) {
        if (mounted) setErrorMessage(apiErrorMessage(error, "Unable to load VLQ overview."));
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadVlqOverview();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    async function loadWalletVlq() {
      if (!wallet?.address) {
        setWalletData(null);
        return;
      }

      const [balanceResult, activityResult, claimsResult] = await Promise.allSettled([
        api.get("/wallet/balance", { params: { address: wallet.address } }),
        api.get("/chain/address", { params: { address: wallet.address, limit: 8, offset: 0 } }),
        api.get("/faucet/claims", { params: { address: wallet.address } }),
      ]);

      if (!mounted) return;
      setWalletData({
        balance: settledData(balanceResult) || null,
        activity: settledData(activityResult) || null,
        claims: settledData(claimsResult)?.claims || [],
        unavailable: {
          balance: unavailable(balanceResult),
          activity: unavailable(activityResult),
          claims: unavailable(claimsResult),
        },
      });
    }

    loadWalletVlq();
    return () => {
      mounted = false;
    };
  }, [wallet?.address]);

  const economy = useMemo(() => {
    const summary = data?.summary;
    const economics = data?.economics;
    return {
      totalIssued: displayNumber(summary || economics, economics?.total_issued ?? summary?.total_issued, " VLQ"),
      maximumSupply: displayNumber(economics, economics?.maximum_supply, " VLQ"),
      currentReward: displayNumber(economics || summary, economics?.current_mining_reward ?? summary?.current_mining_reward, " VLQ"),
      height: displayNumber(summary || economics, summary?.block_height ?? economics?.current_block_height),
      halvingInterval: displayNumber(economics, economics?.halving_interval, " blocks"),
      chainStatus: statusText(summary, summary?.chain_valid === true ? "Valid" : summary?.chain_valid === false ? "Review" : null),
    };
  }, [data]);

  const pendingTransactions = data?.pending?.transactions || [];
  const confirmedTransactions = data?.confirmed?.transactions || [];
  const ledgerEntries = data?.treasuryLedger?.entries || data?.treasury?.latest_ledger_entries || [];
  const walletTransactions = walletData?.activity?.transactions || [];

  const metrics = [
    { label: "Confirmed supply issued", value: economy.totalIssued, note: "Computed from public chain data." },
    { label: "Maximum supply rule", value: economy.maximumSupply, note: "Read from the public economics endpoint." },
    { label: "Current mining reward", value: economy.currentReward, note: `Halving interval: ${economy.halvingInterval}.` },
    {
      label: "Confirmed transactions",
      value: displayNumber(data?.summary || data?.confirmed, data?.summary?.total_transactions ?? data?.confirmed?.total),
    },
    {
      label: "Pending transactions",
      value: displayNumber(data?.pending, data?.pending?.total),
      note: "Pending means waiting for a mined block.",
    },
    { label: "Chain status", value: economy.chainStatus },
  ];

  const flowSteps = [
    {
      title: "1. Submit or queue",
      body: "A send, faucet payout, lending issue, treasury payout, or mining reward starts as a pending transaction when the public API accepts or creates it.",
    },
    {
      title: "2. Mine a block",
      body: "Mining collects pending transactions into a proof-of-work block. Reward transactions are also queued for later confirmation.",
    },
    {
      title: "3. Inspect confirmation",
      body: "The explorer shows confirmed transaction records, block links, confirmations, sender, receiver, amount, and public status.",
    },
  ];

  return (
    <div className="page">
      <section className="hero" aria-label="VLQ introduction">
        <span className="eyebrow">VLQ Transparency</span>
        <h1>Understand VLQ inside Vorliq.</h1>
        <p className="subtitle">
          VLQ is the native coin used by Vorliq wallets, sends, mining rewards, faucet claims, treasury movement,
          lending workflows, and community voting. This page only shows data from existing public APIs and does not
          make market value or return promises.
        </p>
        <div className="button-row">
          <Link className="button" to="/blockchain">
            Open Explorer
          </Link>
          <Link className="button secondary" to="/wallet">
            Check A Balance
          </Link>
          <Link className="button secondary" to="/faucet">
            Get Starter VLQ
          </Link>
        </div>
      </section>

      <ErrorMessage message={errorMessage} />

      {loading && <Spinner label="Loading VLQ overview..." />}

      {!loading && (
        <>
          <section className="grid stats-grid" aria-label="VLQ network summary">
            {metrics.map((metric) => (
              <div className="card card-pad stat-card compact-stat" key={metric.label}>
                <span className="stat-label">{metric.label}</span>
                <span className="stat-value mono-wrap">{metric.value}</span>
                {metric.note && <p className="help-text">{metric.note}</p>}
              </div>
            ))}
          </section>

          <div className="two-column">
            <section className="card card-pad stack" aria-label="Wallet view">
              <div className="section-title">
                <div>
                  <span className="eyebrow">Wallet View</span>
                  <h2>{isLoggedIn ? "Your VLQ" : "Your VLQ starts with a wallet"}</h2>
                </div>
              </div>
              {isLoggedIn && wallet?.address ? (
                <>
                  <div className="meta-item">
                    <span className="meta-label">Wallet address</span>
                    <span className="meta-value mono-wrap">{wallet.address}</span>
                  </div>
                  <div className="meta-item">
                    <span className="meta-label">Confirmed balance</span>
                    <span className="meta-value mono-wrap">
                      {walletData?.unavailable.balance
                        ? "Unavailable"
                        : displayNumber(walletData?.balance, walletData?.balance?.balance, ` ${walletData?.balance?.coin || "VLQ"}`)}
                    </span>
                  </div>
                  <div className="meta-item">
                    <span className="meta-label">Pending incoming</span>
                    <span className="meta-value mono-wrap">
                      {walletData?.unavailable.activity
                        ? "Unavailable"
                        : displayNumber(walletData?.activity, walletData?.activity?.pending_incoming_total, " VLQ")}
                    </span>
                  </div>
                  <div className="meta-item">
                    <span className="meta-label">Pending outgoing</span>
                    <span className="meta-value mono-wrap">
                      {walletData?.unavailable.activity
                        ? "Unavailable"
                        : displayNumber(walletData?.activity, walletData?.activity?.pending_outgoing_total, " VLQ")}
                    </span>
                  </div>
                  <p className="muted-text">
                    Confirmed balance is spendable on the public chain. Pending movement has been submitted or queued
                    but is not final until mined.
                  </p>
                  <div className="button-row">
                    <Link className="button secondary small-button" to="/send">
                      Send VLQ
                    </Link>
                    <Link className="button secondary small-button" to={`/faucet?address=${encodeURIComponent(wallet.address)}`}>
                      Open Faucet
                    </Link>
                  </div>
                </>
              ) : (
                <>
                  <div className="risk-box">
                    <strong>No unlocked wallet in this browser session.</strong>
                    <p>
                      Create or import an encrypted Vorliq wallet to see your confirmed balance, pending movement,
                      faucet claims, and recent wallet activity here.
                    </p>
                  </div>
                  <div className="button-row">
                    <Link className="button" to="/register">
                      Create Account
                    </Link>
                    <Link className="button secondary" to="/login">
                      Sign In
                    </Link>
                  </div>
                </>
              )}
            </section>

            <section className="card card-pad stack" aria-label="How movement confirms">
              <div className="section-title">
                <div>
                  <span className="eyebrow">How Movement Confirms</span>
                  <h2>Pending to confirmed</h2>
                </div>
              </div>
              <div className="stack">
                {flowSteps.map((step) => (
                  <article className="lifecycle-step" key={step.title}>
                    <h3>{step.title}</h3>
                    <p>{step.body}</p>
                  </article>
                ))}
              </div>
            </section>
          </div>

          <div className="lifecycle-grid">
            <section className="card card-pad stack" aria-label="Faucet status">
              <div className="section-title">
                <div>
                  <span className="eyebrow">Starter VLQ</span>
                  <h2>Faucet status</h2>
                </div>
              </div>
              <div className="meta-item">
                <span className="meta-label">Starter amount</span>
                <span className="meta-value mono-wrap">{displayNumber(data?.faucet, data?.faucet?.starter_amount, " VLQ")}</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Treasury available</span>
                <span className="meta-value mono-wrap">{displayNumber(data?.faucet, data?.faucet?.treasury_balance, " VLQ")}</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Claims in 24h</span>
                <span className="meta-value mono-wrap">{displayNumber(data?.faucet, data?.faucet?.claims_24h)}</span>
              </div>
              <p className="muted-text">
                {data?.faucet?.next_available_hint || "Claims use public wallet addresses only and do not require private keys."}
              </p>
              <div className="button-row">
                <Link className="button secondary small-button" to="/faucet">
                  Open Faucet
                </Link>
              </div>
            </section>

            <section className="card card-pad stack" aria-label="Mining reward status">
              <div className="section-title">
                <div>
                  <span className="eyebrow">Mining</span>
                  <h2>Reward status</h2>
                </div>
              </div>
              <div className="meta-item">
                <span className="meta-label">Miner receives</span>
                <span className="meta-value mono-wrap">{displayNumber(data?.mining, data?.mining?.miner_reward_after_treasury, " VLQ")}</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Treasury receives</span>
                <span className="meta-value mono-wrap">{displayNumber(data?.mining, data?.mining?.treasury_reward_per_block, " VLQ")}</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Pending user transactions</span>
                <span className="meta-value mono-wrap">{displayNumber(data?.mining, data?.mining?.pending_user_transaction_count)}</span>
              </div>
              <p className="muted-text">
                {data?.mining?.can_mine_now
                  ? "Mining is available now."
                  : data?.mining?.reason_if_not || "Mining status is loaded from the public mining endpoint."}
              </p>
              <div className="button-row">
                <Link className="button secondary small-button" to="/mine">
                  View Mining
                </Link>
              </div>
            </section>

            <section className="card card-pad stack" aria-label="Lending movement">
              <div className="section-title">
                <div>
                  <span className="eyebrow">Community Pool</span>
                  <h2>Lending movement</h2>
                </div>
              </div>
              <div className="meta-item">
                <span className="meta-label">Pending votes</span>
                <span className="meta-value mono-wrap">{displayNumber(data?.lending, data?.lending?.pending_vote_count)}</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Active VLQ</span>
                <span className="meta-value mono-wrap">{displayNumber(data?.lending, data?.lending?.total_vlq_active, " VLQ")}</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Repaid VLQ</span>
                <span className="meta-value mono-wrap">{displayNumber(data?.lending, data?.lending?.total_vlq_repaid, " VLQ")}</span>
              </div>
              <p className="muted-text">
                Approved lending activity still needs an issuance transaction to be mined before it is confirmed.
              </p>
              <div className="button-row">
                <Link className="button secondary small-button" to="/lending">
                  View Lending
                </Link>
              </div>
            </section>
          </div>

          <section className="card card-pad stack" aria-label="Public treasury movement">
            <div className="section-title">
              <div>
                <span className="eyebrow">Treasury</span>
                <h2>Public treasury movement</h2>
              </div>
            </div>
            <div className="grid quick-link-grid">
              <div className="card card-pad stat-card compact-stat">
                <span className="stat-label">Balance</span>
                <span className="stat-value mono-wrap">
                  {displayNumber(data?.treasury, data?.treasury?.current_balance ?? data?.treasury?.balance, " VLQ")}
                </span>
              </div>
              <div className="card card-pad stat-card compact-stat">
                <span className="stat-label">Total received</span>
                <span className="stat-value mono-wrap">{displayNumber(data?.treasury, data?.treasury?.total_received, " VLQ")}</span>
              </div>
              <div className="card card-pad stat-card compact-stat">
                <span className="stat-label">Total paid</span>
                <span className="stat-value mono-wrap">{displayNumber(data?.treasury, data?.treasury?.total_paid, " VLQ")}</span>
              </div>
              <div className="card card-pad stat-card compact-stat">
                <span className="stat-label">Pending payouts</span>
                <span className="stat-value mono-wrap">{displayNumber(data?.treasury, data?.treasury?.pending_payouts, " VLQ")}</span>
              </div>
            </div>
            {ledgerEntries.length ? (
              <div className="stack">
                {ledgerEntries.map((entry) => (
                  <TreasuryLedgerRow entry={entry} key={entry.ledger_id || entry.tx_id} />
                ))}
              </div>
            ) : (
              <div className="empty-state">
                {data?.unavailable.treasuryLedger
                  ? "Treasury ledger is unavailable from the public API right now."
                  : "No treasury ledger entries are available yet."}
              </div>
            )}
            <div className="button-row">
              <Link className="button secondary small-button" to="/treasury">
                Open Treasury
              </Link>
            </div>
          </section>

          <div className="two-column">
            <section className="card card-pad stack" aria-label="Pending transaction pool">
              <div className="section-title">
                <div>
                  <span className="eyebrow">Pending Pool</span>
                  <h2>Waiting for a block</h2>
                </div>
              </div>
              {pendingTransactions.length ? (
                <div className="stack">
                  {pendingTransactions.map((transaction) => (
                    <TransactionRow transaction={transaction} key={transaction.tx_id} />
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  {data?.unavailable.pending
                    ? "Pending transactions are unavailable right now."
                    : "No pending transactions are waiting right now."}
                </div>
              )}
            </section>
            <section className="card card-pad stack" aria-label="Recent confirmed VLQ transactions">
              <div className="section-title">
                <div>
                  <span className="eyebrow">Confirmed On-Chain</span>
                  <h2>Recent VLQ transactions</h2>
                </div>
              </div>
              {confirmedTransactions.length ? (
                <div className="stack">
                  {confirmedTransactions.map((transaction) => (
                    <TransactionRow transaction={transaction} key={transaction.tx_id} />
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  {data?.unavailable.confirmed
                    ? "Confirmed transactions are unavailable right now."
                    : "No confirmed transactions are available yet."}
                </div>
              )}
            </section>
          </div>

          {isLoggedIn && wallet?.address && (
            <section className="card card-pad stack" aria-label="Recent activity for your wallet">
              <div className="section-title">
                <div>
                  <span className="eyebrow">Wallet Activity</span>
                  <h2>Recent activity for your wallet</h2>
                </div>
              </div>
              {walletTransactions.length ? (
                <div className="stack">
                  {walletTransactions.map((transaction) => (
                    <TransactionRow transaction={transaction} key={transaction.tx_id} />
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  {walletData?.unavailable.activity
                    ? "Wallet activity is unavailable right now."
                    : "No public activity found for this wallet yet."}
                </div>
              )}
              {walletData?.claims?.length > 0 && (
                <>
                  <div className="section-title">
                    <div>
                      <span className="eyebrow">Faucet</span>
                      <h3>Faucet claims for this wallet</h3>
                    </div>
                  </div>
                  <div className="stack">
                    {walletData.claims.slice(0, 4).map((claim) => (
                      <div className="lifecycle-step" key={claim.claim_id}>
                        <span className={`status-badge ${claim.status === "confirmed" ? "executed" : "active"}`}>
                          {claim.status || "pending"}
                        </span>
                        <span className="meta-value">{formatVlq(claim.amount)}</span>
                        {claim.tx_id ? (
                          <Link className="button secondary small-button" to={`/tx/${claim.tx_id}`}>
                            View {shortHash(claim.tx_id)}
                          </Link>
                        ) : (
                          <p className="muted-text">No transaction yet.</p>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function TransactionRow({ transaction }) {
  const status = String(transaction.status || "confirmed").toLowerCase();
  const txId = transaction.tx_id || transaction.id;
  const sender = transaction.sender_address || transaction.sender;
  const receiver = transaction.receiver_address || transaction.recipient;
  const badgeClass = status === "pending" ? "status-badge active" : "status-badge executed";
  const badgeLabel = status === "pending" ? "Pending" : "Confirmed";

  const content = (
    <>
      <div className="section-title">
        <span className={badgeClass}>{badgeLabel}</span>
        <span className="muted-text mono-wrap">{formatVlq(transaction.amount)}</span>
      </div>
      <span className="meta-value mono-wrap">{shortHash(txId)}</span>
      <span className="muted-text mono-wrap">From {shortHash(sender)}</span>
      <span className="muted-text mono-wrap">To {shortHash(receiver)}</span>
      {transaction.block_index !== null && transaction.block_index !== undefined && (
        <span className="muted-text">Block #{transaction.block_index}</span>
      )}
    </>
  );

  if (!txId) {
    return <div className="lifecycle-step">{content}</div>;
  }

  return (
    <Link className="lifecycle-step record-link" to={`/tx/${encodeURIComponent(txId)}`}>
      {content}
    </Link>
  );
}

function TreasuryLedgerRow({ entry }) {
  return (
    <div className="lifecycle-step">
      <div className="section-title">
        <span className={`status-badge ${entry.type === "reward_in" ? "executed" : "active"}`}>
          {entry.type === "reward_in" ? "Reward in" : "Payout"}
        </span>
        <span className="muted-text mono-wrap">{formatVlq(entry.amount)}</span>
      </div>
      <span className="meta-value">{entry.description || "Treasury ledger entry"}</span>
      <span className="muted-text mono-wrap">
        {shortHash(entry.from_address)} to {shortHash(entry.to_address)}
      </span>
      <span className="muted-text">{formatTime(entry.timestamp)}</span>
      {entry.tx_id && (
        <Link className="button secondary small-button" to={`/tx/${entry.tx_id}`}>
          View {shortHash(entry.tx_id)}
        </Link>
      )}
    </div>
  );
}

export default VLQ;
