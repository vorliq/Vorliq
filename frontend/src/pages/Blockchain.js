import { useEffect, useState } from "react";
import { toast } from "react-toastify";

import api from "../helpers/api";

function Blockchain() {
  const [chain, setChain] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function loadChain() {
      try {
        const response = await api.get("/chain");
        if (mounted) {
          setChain([...(response.data.chain || [])].sort((a, b) => b.index - a.index));
        }
      } catch (error) {
        toast.error(error.response?.data?.error || "Unable to load blockchain.");
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadChain();

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <main className="page">
      <section className="hero">
        <span className="eyebrow">Chain Explorer</span>
        <h1>Vorliq Blockchain</h1>
        <p className="subtitle">
          Inspect every block, hash, nonce, and transaction recorded by the local VLQ chain.
        </p>
      </section>

      <section className="stack">
        {loading && <div className="empty-state">Loading blockchain data...</div>}

        {!loading && chain.length === 0 && <div className="empty-state">No blocks found.</div>}

        {chain.map((block) => (
          <article className="card card-pad block-card" key={block.hash}>
            <div className="section-title">
              <h2>Block #{block.index}</h2>
              <span className="eyebrow">{block.transactions?.length || 0} transactions</span>
            </div>

            <div className="block-meta">
              <div className="meta-item">
                <span className="meta-label">Block Hash</span>
                <span className="meta-value">{block.hash}</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Previous Hash</span>
                <span className="meta-value">{block.previous_hash}</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Timestamp</span>
                <span className="meta-value">
                  {new Date(block.timestamp * 1000).toLocaleString()}
                </span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Nonce</span>
                <span className="meta-value">{block.nonce}</span>
              </div>
            </div>

            <div className="transactions">
              <h3>Transactions</h3>
              {block.transactions?.length ? (
                block.transactions.map((transaction, index) => (
                  <div className="transaction-item" key={`${block.hash}-${index}`}>
                    <div className="meta-item">
                      <span className="meta-label">Sender</span>
                      <span className="meta-value">{transaction.sender_address}</span>
                    </div>
                    <div className="meta-item">
                      <span className="meta-label">Receiver</span>
                      <span className="meta-value">{transaction.receiver_address}</span>
                    </div>
                    <div className="meta-item">
                      <span className="meta-label">Amount</span>
                      <span className="meta-value">{transaction.amount} VLQ</span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="empty-state">This block has no transactions.</div>
              )}
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}

export default Blockchain;
