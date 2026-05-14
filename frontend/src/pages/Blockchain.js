import { useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";

import api from "../helpers/api";

function Blockchain() {
  const [chain, setChain] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

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

  const filteredChain = useMemo(() => {
    const term = search.trim();
    if (!term) {
      return chain;
    }

    if (/^\d+$/.test(term)) {
      return chain.filter((block) => Number(block.index) === Number(term));
    }

    const normalizedTerm = term.toLowerCase();
    return chain.filter((block) =>
      (block.transactions || []).some(
        (transaction) =>
          transaction.sender_address?.toLowerCase().includes(normalizedTerm) ||
          transaction.receiver_address?.toLowerCase().includes(normalizedTerm)
      )
    );
  }, [chain, search]);

  return (
    <main className="page">
      <section className="hero">
        <span className="eyebrow">Chain Explorer</span>
        <h1>Vorliq Blockchain</h1>
        <p className="subtitle">
          Inspect every block, hash, nonce, and transaction recorded by the local VLQ chain.
        </p>
      </section>

      <section className="card card-pad explorer-search">
        <div className="field">
          <label htmlFor="chain-search">Search by Block Index or Wallet Address</label>
          <input
            id="chain-search"
            className="input"
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Example: 4 or a wallet address"
          />
        </div>
      </section>

      <section className="stack">
        {loading && <div className="empty-state">Loading blockchain data...</div>}

        {!loading && filteredChain.length === 0 && <div className="empty-state">No blocks found.</div>}

        {filteredChain.map((block) => (
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
