import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "react-toastify";

import AddressIdentity from "../components/AddressIdentity";
import ErrorMessage from "../components/ErrorMessage";
import Spinner from "../components/Spinner";
import api from "../helpers/api";
import { apiErrorMessage } from "../helpers/errors";

function TransactionDetail() {
  const { txId } = useParams();
  const [transaction, setTransaction] = useState(null);
  const [rawOpen, setRawOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let mounted = true;
    async function loadTransaction() {
      setLoading(true);
      try {
        const response = await api.get(`/transactions/${encodeURIComponent(txId)}`);
        if (mounted) {
          setTransaction(response.data.transaction);
          setErrorMessage("");
        }
      } catch (error) {
        const message = apiErrorMessage(error, "Transaction not found.");
        if (mounted) setErrorMessage(message);
        toast.error(message);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    loadTransaction();
    return () => {
      mounted = false;
    };
  }, [txId]);

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
        <span className="eyebrow">Transaction Explorer</span>
        <h1>Transaction Detail</h1>
        <p className="subtitle">
          Inspect whether a VLQ transaction is pending in the pool or confirmed in a mined block.
        </p>
      </section>

      <ErrorMessage message={errorMessage} />
      {loading && <Spinner label="Loading transaction..." />}

      {!loading && transaction && (
        <section className="card card-pad stack explorer-detail">
          <div className="section-title">
            <div>
              <span className={`status-badge ${transaction.status}`}>{transaction.status}</span>
              <h2>{shortId(transaction.tx_id)}</h2>
            </div>
            <button className="button secondary small-button" type="button" onClick={() => copy(transaction.tx_id, "Transaction ID")}>
              Copy ID
            </button>
          </div>

          <div className="grid explorer-summary-grid">
            <IdentityPanel label="Sender" address={transaction.sender_address} />
            <IdentityPanel label="Recipient" address={transaction.receiver_address} />
            <Meta label="Amount" value={`${transaction.amount} VLQ`} />
            <Meta label="Type" value={transaction.type || transaction.category || "transfer"} />
            <Meta label="Timestamp" value={formatTime(transaction.timestamp)} />
            <Meta label="Confirmations" value={transaction.confirmations ?? 0} />
            <Meta label="Signature Present" value={transaction.signature_present ? "Yes" : "No"} />
            <Meta label="Public Key Present" value={transaction.public_key_present ? "Yes" : "No"} />
          </div>

          {transaction.status === "confirmed" && transaction.block_index !== null && (
            <div className="explorer-link-row">
              <span>Confirmed in block #{transaction.block_index}</span>
              <Link className="button secondary small-button" to={`/block/${transaction.block_hash || transaction.block_index}`}>
                View Block
              </Link>
            </div>
          )}

          {transaction.status === "pending" && (
            <div className="risk-box">
              This transaction is in the pending pool. It becomes confirmed after a miner includes
              it in a valid block.
            </div>
          )}

          <button className="text-button" type="button" onClick={() => setRawOpen((open) => !open)}>
            {rawOpen ? "Hide safe JSON" : "Show safe JSON"}
          </button>
          {rawOpen && <pre className="code-box">{JSON.stringify(transaction, null, 2)}</pre>}
        </section>
      )}
    </div>
  );
}

function IdentityPanel({ label, address }) {
  return (
    <div className="meta-item identity-panel">
      <span className="meta-label">{label}</span>
      <AddressIdentity address={address} compact />
      <span className="meta-value">{address}</span>
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

function shortId(value) {
  if (!value) return "Unknown transaction";
  return value.length > 24 ? `${value.slice(0, 16)}...${value.slice(-8)}` : value;
}

function formatTime(timestamp) {
  const number = Number(timestamp);
  if (!Number.isFinite(number)) return "Unknown";
  return new Date(number * 1000).toLocaleString();
}

export default TransactionDetail;
