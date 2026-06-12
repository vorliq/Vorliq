import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";

import ErrorMessage from "../components/ErrorMessage";
import Spinner from "../components/Spinner";
import api from "../helpers/api";
import { apiErrorMessage } from "../helpers/errors";
import { formatTime, formatVlq, loadPublicChainSnapshot, shortHash } from "../helpers/publicApi";

const PAGE_SIZE = 12;

function chainHealthBadge(loading, snapshot) {
  if (loading) return { className: "status-badge active", label: "Connecting..." };
  if (!snapshot || snapshot.unavailable.summary) {
    return { className: "status-badge expired", label: "Chain data unavailable" };
  }
  return snapshot.summary?.chain_valid
    ? { className: "status-badge executed", label: "Chain valid" }
    : { className: "status-badge rejected", label: "Chain under review" };
}

function Blockchain() {
  const navigate = useNavigate();
  const addressResultsRef = useRef(null);
  const [snapshot, setSnapshot] = useState(null);
  const [blocks, setBlocks] = useState([]);
  const [hasMoreBlocks, setHasMoreBlocks] = useState(false);
  const [addressResults, setAddressResults] = useState([]);
  const [addressTotal, setAddressTotal] = useState(null);
  const [addressSearch, setAddressSearch] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let mounted = true;
    async function loadExplorer() {
      try {
        const data = await loadPublicChainSnapshot();
        if (!mounted) return;
        setSnapshot(data);
        setBlocks(data.blocks || []);
        setHasMoreBlocks((data.blocks || []).length < (data.summary?.total_blocks || 0));
        setUnavailable(
          data.unavailable.summary &&
            data.unavailable.blocks &&
            data.unavailable.confirmedTransactions &&
            data.unavailable.pendingTransactions
        );
        setErrorMessage("");
      } catch (error) {
        const message = apiErrorMessage(error, "Unable to load blockchain explorer.");
        if (mounted) {
          setUnavailable(true);
          setErrorMessage(message);
        }
        toast.error(message);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    loadExplorer();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!addressSearch) return undefined;
    const timer = window.setTimeout(() => {
      addressResultsRef.current?.scrollIntoView({ block: "start" });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [addressSearch, addressResults.length]);

  async function loadMoreBlocks() {
    setLoadingMore(true);
    try {
      const response = await api.get("/chain/blocks", {
        params: { limit: PAGE_SIZE, offset: blocks.length },
      });
      setBlocks((current) => [...current, ...(response.data.blocks || [])]);
      setHasMoreBlocks(Boolean(response.data.has_more));
    } catch (error) {
      toast.error(apiErrorMessage(error, "Unable to load more blocks."));
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleSearch(event) {
    event.preventDefault();
    const term = search.trim();
    if (!term) return;

    if (/^\d+$/.test(term)) {
      navigate(`/block/${term}`);
      return;
    }

    try {
      const txResponse = await api.get(`/transactions/${encodeURIComponent(term)}`);
      if (txResponse.data?.transaction) {
        navigate(`/tx/${term}`);
        return;
      }
    } catch (error) {
      // Try block and address lookups below.
    }

    try {
      const blockResponse = await api.get(`/chain/block/${encodeURIComponent(term)}`);
      if (blockResponse.data?.block) {
        navigate(`/block/${term}`);
        return;
      }
    } catch (error) {
      // Try address lookup below.
    }

    try {
      const addressResponse = await api.get("/chain/address", {
        params: { address: term, limit: 12, offset: 0 },
      });
      setAddressSearch(term);
      setAddressResults(addressResponse.data.transactions || []);
      setAddressTotal(addressResponse.data.total ?? (addressResponse.data.transactions || []).length);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(`No block, transaction, or wallet history matched ${shortHash(term)}.`);
    }
  }

  const summary = snapshot?.summary || {};
  const badge = chainHealthBadge(loading, snapshot);
  const transactions = useMemo(() => {
    if (!snapshot) return [];
    return (snapshot.confirmedTransactions || []).slice(0, 12);
  }, [snapshot]);

  const statCards = [
    {
      label: "Wallet Holders",
      value: snapshot?.unavailable.holders ? "Unavailable" : snapshot?.holderTotal ?? "Unavailable",
      note: "Public holder count comes from the leaderboard endpoint.",
    },
    {
      label: "Total Blocks",
      value: snapshot?.unavailable.summary ? "Unavailable" : summary.total_blocks ?? "Unavailable",
    },
    {
      label: "Confirmed Transactions",
      value: snapshot?.unavailable.confirmedTransactions
        ? "Unavailable"
        : summary.total_transactions ?? snapshot?.confirmedTotal ?? "Unavailable",
    },
    {
      label: "Pending Transactions",
      value:
        snapshot?.unavailable.pendingTransactions || snapshot?.pendingTotal == null
          ? "Unavailable"
          : snapshot.pendingTotal,
    },
    {
      label: "Chain Health",
      value: snapshot?.unavailable.summary ? "Unavailable" : summary.chain_valid ? "Valid" : "Needs review",
    },
  ];

  return (
    <div className="page">
      <section className="hero">
        <span className="eyebrow">Public Chain Explorer</span>
        <h1>Vorliq Blockchain</h1>
        <p className="subtitle">
          Follow blocks, confirmed transactions, pending transactions, and wallet activity on Vorliq's own
          lightweight blockchain.
        </p>
      </section>

      <ErrorMessage message={errorMessage} />

      <section className="card card-pad stack elev-2" aria-label="Explorer search">
        <form className="form" onSubmit={handleSearch}>
          <div className="field">
            <label htmlFor="chain-search">Search block, transaction, or wallet address</label>
            <input
              id="chain-search"
              className="input"
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Block index, hash, transaction ID, or wallet address"
            />
          </div>
          <div className="button-row">
            <button className="button" type="submit">
              Search Explorer
            </button>
          </div>
        </form>
      </section>

      {loading && <Spinner label="Loading blockchain explorer..." />}

      {!loading && (
        <>
          <section className="card card-pad stack elev-2" aria-label="Chain summary">
            <div className="section-title">
              <div>
                <span className="eyebrow">Chain Summary</span>
                <h2>Live Chain Values</h2>
              </div>
              <span className={badge.className} role="status">
                {badge.label}
              </span>
            </div>
            {unavailable && (
              <p className="help-text" role="status">
                Live chain data is unavailable right now. Values stay marked unavailable instead of being estimated.
              </p>
            )}
            <div className="grid stats-grid">
              {statCards.map((stat) => (
                <div className="card card-pad stat-card compact-stat" key={stat.label}>
                  <span className="stat-label">{stat.label}</span>
                  <span className="stat-value mono-wrap">{stat.value}</span>
                  {stat.note && <p className="help-text">{stat.note}</p>}
                </div>
              ))}
            </div>
          </section>

          <div className="two-column">
            <section className="card card-pad stack" aria-label="Recent blocks">
              <div className="section-title">
                <div>
                  <span className="eyebrow">Recent Blocks</span>
                  <h2>Block History</h2>
                </div>
                <span className="muted-text mono-wrap">
                  {snapshot?.unavailable.summary ? "total unavailable" : `${summary.total_blocks ?? blocks.length} total`}
                </span>
              </div>
              {blocks.length ? (
                <div className="stack">
                  {blocks.map((block) => (
                    <BlockRow block={block} key={block.hash || block.index} />
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  {snapshot?.unavailable.blocks
                    ? "Block history is unavailable from the public API right now."
                    : "No blocks are available from the public API right now."}
                </div>
              )}
              {hasMoreBlocks && (
                <div className="button-row">
                  <button className="button secondary" type="button" disabled={loadingMore} onClick={loadMoreBlocks}>
                    {loadingMore ? "Loading..." : "Load More Blocks"}
                  </button>
                </div>
              )}
            </section>

            <section className="card card-pad stack" aria-label="Pending transactions">
              <div className="section-title">
                <div>
                  <span className="eyebrow">Pending</span>
                  <h2>Pending Transactions</h2>
                </div>
                <span className="status-badge active">awaiting mining</span>
              </div>
              {snapshot?.pendingTransactions?.length ? (
                <div className="stack">
                  {snapshot.pendingTransactions.map((transaction) => (
                    <TransactionRow transaction={transaction} key={transaction.tx_id} />
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  {snapshot?.unavailable.pendingTransactions
                    ? "Pending transaction data is unavailable from the public API right now."
                    : "No pending transactions are waiting right now."}
                </div>
              )}
              <div className="button-row">
                <Link className="button secondary small-button" to="/send">
                  Create Transaction
                </Link>
              </div>
            </section>
          </div>

          <section className="card card-pad stack" aria-label="Recent confirmed transactions">
            <div className="section-title">
              <div>
                <span className="eyebrow">Confirmed</span>
                <h2>Recent Confirmed Transactions</h2>
              </div>
              <span className="muted-text">Mined public transaction records</span>
            </div>
            {transactions.length ? (
              <div className="governance-grid">
                {transactions.map((transaction, index) => (
                  <TransactionRow transaction={transaction} key={transaction.tx_id || index} />
                ))}
              </div>
            ) : (
              <div className="empty-state">
                {snapshot?.unavailable.confirmedTransactions
                  ? "Confirmed transaction history is unavailable from the public API right now."
                  : "No confirmed transactions are available right now."}
              </div>
            )}
          </section>

          {addressSearch && (
            <section className="card card-pad stack" aria-label="Wallet history" ref={addressResultsRef}>
              <div className="section-title">
                <div>
                  <span className="eyebrow">Wallet History</span>
                  <h2 className="mono-wrap">{shortHash(addressSearch)}</h2>
                </div>
                <Link
                  className="button secondary small-button"
                  to={`/profile?address=${encodeURIComponent(addressSearch)}`}
                >
                  View Profile
                </Link>
              </div>
              <p className="muted-text">
                {addressTotal === null
                  ? "Showing public transaction matches."
                  : `${addressTotal} public transaction match${addressTotal === 1 ? "" : "es"}.`}
              </p>
              {addressResults.length ? (
                <div className="stack">
                  {addressResults.map((transaction) => (
                    <TransactionRow transaction={transaction} key={transaction.tx_id} />
                  ))}
                </div>
              ) : (
                <div className="empty-state">No transactions found for this wallet address.</div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function BlockRow({ block }) {
  return (
    <Link className="lifecycle-step record-link" to={`/block/${block.hash || block.index}`}>
      <div className="section-title">
        <span className="status-badge executed">block #{block.index}</span>
        <span className="muted-text mono-wrap">{formatTime(block.timestamp)}</span>
      </div>
      <span className="meta-value mono-wrap">{shortHash(block.hash)}</span>
      <span className="muted-text">{block.transaction_count ?? (block.transactions || []).length} tx</span>
    </Link>
  );
}

function TransactionRow({ transaction }) {
  const status = String(transaction.status || "confirmed").toLowerCase();
  const txId = transaction.tx_id || transaction.id;
  const badgeClass = status === "pending" ? "status-badge active" : "status-badge executed";
  const badgeLabel = status === "pending" ? "Pending" : "Confirmed";

  if (!txId) {
    return (
      <div className="lifecycle-step">
        <span className={badgeClass}>{badgeLabel}</span>
        <span className="meta-value">Transaction ID unavailable</span>
        <span className="muted-text mono-wrap">From {shortHash(transaction.sender_address || transaction.sender)}</span>
      </div>
    );
  }

  return (
    <Link className="lifecycle-step record-link" to={`/tx/${encodeURIComponent(txId)}`}>
      <div className="section-title">
        <span className={badgeClass}>{badgeLabel}</span>
        <span className="muted-text mono-wrap">{formatVlq(transaction.amount)}</span>
      </div>
      <span className="meta-value mono-wrap">{shortHash(txId)}</span>
      <span className="muted-text mono-wrap">From {shortHash(transaction.sender_address || transaction.sender)}</span>
      {transaction.receiver_address && (
        <span className="muted-text mono-wrap">To {shortHash(transaction.receiver_address)}</span>
      )}
    </Link>
  );
}

export default Blockchain;
