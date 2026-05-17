import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";

import AddressIdentity from "../components/AddressIdentity";
import ErrorMessage from "../components/ErrorMessage";
import Spinner from "../components/Spinner";
import api from "../helpers/api";
import { apiErrorMessage } from "../helpers/errors";

const PAGE_SIZE = 12;

function Blockchain() {
  const navigate = useNavigate();
  const [summary, setSummary] = useState(null);
  const [blocks, setBlocks] = useState([]);
  const [pendingTransactions, setPendingTransactions] = useState([]);
  const [addressResults, setAddressResults] = useState([]);
  const [addressSearch, setAddressSearch] = useState("");
  const [hasMoreBlocks, setHasMoreBlocks] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let mounted = true;
    async function loadExplorer() {
      try {
        const [summaryResponse, blocksResponse, pendingResponse] = await Promise.all([
          api.get("/chain/summary"),
          api.get("/chain/blocks", { params: { limit: PAGE_SIZE, offset: 0 } }),
          api.get("/transactions/pending", { params: { limit: 8, offset: 0 } }),
        ]);
        if (mounted) {
          setSummary(summaryResponse.data.summary || null);
          setBlocks(blocksResponse.data.blocks || []);
          setHasMoreBlocks(Boolean(blocksResponse.data.has_more));
          setPendingTransactions(pendingResponse.data.transactions || []);
          setErrorMessage("");
        }
      } catch (error) {
        const message = apiErrorMessage(error, "Unable to load blockchain explorer.");
        if (mounted) setErrorMessage(message);
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
      // Fall through to block lookup, then address history.
    }

    try {
      const blockResponse = await api.get(`/chain/block/${encodeURIComponent(term)}`);
      if (blockResponse.data?.block) {
        navigate(`/block/${term}`);
        return;
      }
    } catch (error) {
      // Fall through to wallet address search.
    }

    try {
      const addressResponse = await api.get("/chain/address", {
        params: { address: term, limit: 12, offset: 0 },
      });
      setAddressSearch(term);
      setAddressResults(addressResponse.data.transactions || []);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(`No block, transaction, or wallet history matched ${shortValue(term)}.`);
    }
  }

  return (
    <div className="page">
      <section className="hero">
        <span className="eyebrow">Chain Explorer</span>
        <h1>Vorliq Blockchain</h1>
        <p className="subtitle">
          Follow pending transactions, confirmed blocks, and wallet activity on the VLQ chain.
        </p>
      </section>

      <ErrorMessage message={errorMessage} />
      {loading && <Spinner label="Loading blockchain explorer..." />}

      {!loading && (
        <>
          <section className="card card-pad explorer-search">
            <form className="form" onSubmit={handleSearch}>
              <div className="field">
                <label htmlFor="chain-search">Search block, transaction, or wallet address</label>
                <input
                  id="chain-search"
                  className="input"
                  type="text"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Block index, block hash, transaction ID, or wallet address"
                />
              </div>
              <button className="button" type="submit">Search Explorer</button>
            </form>
          </section>

          <section className="grid stats-grid explorer-stats" aria-label="Chain summary">
            <Stat label="Block Height" value={summary?.block_height ?? 0} />
            <Stat label="Total Transactions" value={summary?.total_transactions ?? 0} />
            <Stat label="Difficulty" value={summary?.current_difficulty ?? 0} />
            <Stat label="Mining Reward" value={`${summary?.current_mining_reward ?? 0} VLQ`} />
            <Stat label="Chain Valid" value={summary?.chain_valid ? "Yes" : "No"} />
            <Stat label="Latest Block" value={shortValue(summary?.last_block_hash)} />
          </section>

          <div className="grid two-column explorer-columns">
            <section className="card card-pad stack">
              <div className="section-title">
                <h2>Recent Blocks</h2>
                <span className="eyebrow">{summary?.total_blocks ?? blocks.length} total</span>
              </div>
              {blocks.length ? blocks.map((block) => <BlockRow block={block} key={block.hash} />) : <div className="empty-state">No blocks found.</div>}
              {hasMoreBlocks && (
                <button className="button secondary" type="button" disabled={loadingMore} onClick={loadMoreBlocks}>
                  {loadingMore ? "Loading..." : "Load More Blocks"}
                </button>
              )}
            </section>

            <section className="card card-pad stack">
              <div className="section-title">
                <h2>Pending Transactions</h2>
                <span className="eyebrow">awaiting mining</span>
              </div>
              {pendingTransactions.length ? (
                pendingTransactions.map((transaction) => <TransactionRow transaction={transaction} key={transaction.tx_id} />)
              ) : (
                <div className="empty-state">No pending transactions are waiting right now.</div>
              )}
              <Link className="button secondary" to="/send">Create Transaction</Link>
            </section>
          </div>

          {addressSearch && (
            <section className="card card-pad stack">
              <div className="section-title">
                <div>
                  <span className="eyebrow">Wallet History</span>
                  <h2>{shortValue(addressSearch)}</h2>
                </div>
                <Link className="button secondary small-button" to={`/profile?address=${encodeURIComponent(addressSearch)}`}>
                  View Profile
                </Link>
              </div>
              {addressResults.length ? (
                addressResults.map((transaction) => <TransactionRow transaction={transaction} key={transaction.tx_id} />)
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

function Stat({ label, value }) {
  return (
    <article className="stat-card">
      <span className="stat-label">{label}</span>
      <span className="stat-value compact-stat">{value}</span>
    </article>
  );
}

function BlockRow({ block }) {
  return (
    <Link className="transaction-item explorer-row-link" to={`/block/${block.hash || block.index}`}>
      <span className="status-badge confirmed">block #{block.index}</span>
      <strong>{shortValue(block.hash)}</strong>
      <span>{block.transaction_count ?? (block.transactions || []).length} tx</span>
      <span>{formatTime(block.timestamp)}</span>
    </Link>
  );
}

function TransactionRow({ transaction }) {
  return (
    <div className="transaction-item explorer-row-link">
      <span className={`status-badge ${transaction.status}`}>{transaction.status}</span>
      <Link to={`/tx/${transaction.tx_id}`}>
        <strong>{shortValue(transaction.tx_id)}</strong>
      </Link>
      <AddressIdentity address={transaction.sender_address} compact />
      <span>{transaction.amount} VLQ</span>
    </div>
  );
}

function shortValue(value) {
  if (!value) return "Unknown";
  return String(value).length > 22 ? `${String(value).slice(0, 12)}...${String(value).slice(-6)}` : String(value);
}

function formatTime(timestamp) {
  const number = Number(timestamp);
  if (!Number.isFinite(number)) return "Unknown";
  return new Date(number * 1000).toLocaleString();
}

export default Blockchain;
