import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "react-toastify";

import ErrorMessage from "../components/ErrorMessage";
import Spinner from "../components/Spinner";
import api from "../helpers/api";
import { apiErrorMessage } from "../helpers/errors";

function BlockDetail() {
  const { blockId } = useParams();
  const [block, setBlock] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let mounted = true;
    async function loadBlock() {
      setLoading(true);
      try {
        const response = await api.get(`/chain/block/${encodeURIComponent(blockId)}`);
        if (mounted) {
          setBlock(response.data.block);
          setErrorMessage("");
        }
      } catch (error) {
        const message = apiErrorMessage(error, "Block not found.");
        if (mounted) setErrorMessage(message);
        toast.error(message);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    loadBlock();
    return () => {
      mounted = false;
    };
  }, [blockId]);

  async function copy(value, label) {
    try {
      await navigator.clipboard.writeText(String(value || ""));
      toast.success(`${label} copied.`);
    } catch (error) {
      toast.error(`Unable to copy ${label.toLowerCase()}.`);
    }
  }

  return (
    <div className="page">
      <section className="hero">
        <span className="eyebrow">Block Explorer</span>
        <h1>Block Detail</h1>
        <p className="subtitle">
          Review a mined VLQ block, its proof-of-work metadata, and included transactions.
        </p>
      </section>

      <ErrorMessage message={errorMessage} />
      {loading && <Spinner label="Loading block..." />}

      {!loading && block && (
        <section className="card card-pad stack explorer-detail">
          <div className="section-title">
            <div>
              <span className="eyebrow">Block #{block.index}</span>
              <h2>{shortHash(block.hash)}</h2>
            </div>
            <button className="button secondary small-button" type="button" onClick={() => copy(block.hash, "Block hash")}>
              Copy Hash
            </button>
          </div>

          <div className="block-meta">
            <Meta label="Hash" value={block.hash} />
            <Meta
              label="Previous Hash"
              value={
                block.previous_hash && block.previous_hash !== "0" ? (
                  <Link to={`/block/${block.previous_hash}`}>{block.previous_hash}</Link>
                ) : (
                  "Genesis"
                )
              }
            />
            <Meta label="Timestamp" value={formatTime(block.timestamp)} />
            <Meta label="Nonce" value={block.nonce} />
            <Meta label="Difficulty" value={block.difficulty ?? "Unknown"} />
            <Meta label="Confirmations" value={block.confirmations ?? 0} />
            <Meta label="Transaction Count" value={block.transaction_count ?? (block.transactions || []).length} />
            <Meta label="Miner" value={block.miner_address || "Unknown"} />
          </div>

          <div className="transactions">
            <h3>Transactions</h3>
            {(block.transactions || []).length ? (
              <div className="stack">
                {block.transactions.map((transaction) => (
                  <Link className="transaction-item explorer-transaction-link" to={`/tx/${transaction.tx_id}`} key={transaction.tx_id}>
                    <span className={`status-badge ${transaction.status}`}>{transaction.status}</span>
                    <strong>{shortHash(transaction.tx_id)}</strong>
                    <span>{transaction.amount} VLQ</span>
                    <span>{transaction.type || transaction.category || "transfer"}</span>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="empty-state">This block has no transactions.</div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function Meta({ label, value }) {
  return (
    <div className="meta-item">
      <span className="meta-label">{label}</span>
      <span className="meta-value">{value}</span>
    </div>
  );
}

function shortHash(value) {
  if (!value) return "Unknown";
  return value.length > 24 ? `${value.slice(0, 14)}...${value.slice(-8)}` : value;
}

function formatTime(timestamp) {
  const number = Number(timestamp);
  if (!Number.isFinite(number)) return "Unknown";
  return new Date(number * 1000).toLocaleString();
}

export default BlockDetail;
