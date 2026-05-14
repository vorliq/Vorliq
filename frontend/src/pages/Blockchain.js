import { useEffect, useMemo, useState } from "react";
import { ec as EC } from "elliptic";
import { toast } from "react-toastify";

import ErrorMessage from "../components/ErrorMessage";
import api from "../helpers/api";
import { apiErrorMessage } from "../helpers/errors";
import { createPythonSigningPayload } from "../helpers/signer";

const secp256k1 = new EC("secp256k1");
const SYSTEM_ADDRESSES = new Set(["SYSTEM", "LENDING_POOL"]);

function shortenAddress(address) {
  if (!address) {
    return "Unknown";
  }
  return address.length > 16 ? `${address.slice(0, 12)}...${address.slice(-4)}` : address;
}

function pemToBytes(pem) {
  const base64 = String(pem || "")
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");

  if (!base64) {
    throw new Error("Public key PEM is empty.");
  }

  const binary = window.atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function extractUncompressedPublicKey(publicKeyPem) {
  const bytes = pemToBytes(publicKeyPem);
  const publicKeyBytes = bytes.slice(-65);

  if (publicKeyBytes.length !== 65 || publicKeyBytes[0] !== 0x04) {
    throw new Error("Could not read a SECP256K1 public key from the PEM.");
  }

  return Array.from(publicKeyBytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(message) {
  const encoded = new TextEncoder().encode(message);
  const digest = await window.crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function verifyTransactionSignature(transaction) {
  if (SYSTEM_ADDRESSES.has(transaction.sender_address)) {
    return transaction.signature ? "Invalid" : "Valid";
  }

  if (!transaction.signature || !transaction.sender_public_key) {
    return "Invalid";
  }

  try {
    const payload = createPythonSigningPayload({
      senderAddress: transaction.sender_address,
      receiverAddress: transaction.receiver_address,
      amount: transaction.amount,
      timestamp: transaction.timestamp,
    });
    const digestHex = await sha256Hex(payload);
    const publicKeyHex = extractUncompressedPublicKey(transaction.sender_public_key);
    const key = secp256k1.keyFromPublic(publicKeyHex, "hex");
    return key.verify(digestHex, transaction.signature) ? "Valid" : "Invalid";
  } catch (error) {
    return "Invalid";
  }
}

function Blockchain() {
  const [chain, setChain] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("blocks");
  const [search, setSearch] = useState("");
  const [addressInput, setAddressInput] = useState("");
  const [addressSearch, setAddressSearch] = useState("");
  const [lookupInput, setLookupInput] = useState("");
  const [lookupSearch, setLookupSearch] = useState("");
  const [signatureStatuses, setSignatureStatuses] = useState({});
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let mounted = true;

    async function loadChain() {
      try {
        const response = await api.get("/chain");
        if (mounted) {
          setChain([...(response.data.chain || [])].sort((a, b) => b.index - a.index));
          setErrorMessage("");
        }
      } catch (error) {
        const message = apiErrorMessage(error, "Unable to load blockchain.");
        setErrorMessage(message);
        toast.error(message);
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

  const transactions = useMemo(
    () =>
      chain.flatMap((block) =>
        (block.transactions || []).map((transaction, index) => ({
          ...transaction,
          block_index: block.index,
          block_hash: block.hash,
          transaction_index: index,
          id: `${block.hash}-${index}`,
        }))
      ),
    [chain]
  );

  useEffect(() => {
    let mounted = true;

    async function verifyVisibleTransactions() {
      const updates = {};
      const candidates = transactions.filter(
        (transaction) => transaction.signature || SYSTEM_ADDRESSES.has(transaction.sender_address)
      );

      await Promise.all(
        candidates.map(async (transaction) => {
          updates[transaction.id] = await verifyTransactionSignature(transaction);
        })
      );

      if (mounted) {
        setSignatureStatuses(updates);
      }
    }

    verifyVisibleTransactions();

    return () => {
      mounted = false;
    };
  }, [transactions]);

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

  const addressResults = useMemo(() => {
    const address = addressSearch.trim().toLowerCase();
    if (!address) {
      return [];
    }

    return transactions.filter(
      (transaction) =>
        transaction.sender_address?.toLowerCase() === address ||
        transaction.receiver_address?.toLowerCase() === address
    );
  }, [transactions, addressSearch]);

  const lookupResults = useMemo(() => {
    const term = lookupSearch.trim().toLowerCase();
    if (!term) {
      return [];
    }

    return transactions.filter(
      (transaction) =>
        transaction.signature?.toLowerCase().includes(term) ||
        transaction.sender_address?.toLowerCase().includes(term) ||
        transaction.receiver_address?.toLowerCase().includes(term)
    );
  }, [transactions, lookupSearch]);

  function renderTabs() {
    return (
      <div className="tab-list">
        <button
          className={`tab-button ${activeTab === "blocks" ? "active" : ""}`}
          type="button"
          onClick={() => setActiveTab("blocks")}
        >
          All Blocks
        </button>
        <button
          className={`tab-button ${activeTab === "address" ? "active" : ""}`}
          type="button"
          onClick={() => setActiveTab("address")}
        >
          Search Address
        </button>
        <button
          className={`tab-button ${activeTab === "lookup" ? "active" : ""}`}
          type="button"
          onClick={() => setActiveTab("lookup")}
        >
          Transaction Lookup
        </button>
      </div>
    );
  }

  function renderBlockList() {
    return (
      <>
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
      </>
    );
  }

  function renderAddressSearch() {
    return (
      <section className="stack">
        <div className="card card-pad">
          <form
            className="form"
            onSubmit={(event) => {
              event.preventDefault();
              setAddressSearch(addressInput);
            }}
          >
            <div className="field">
              <label htmlFor="address-search">Wallet Address</label>
              <input
                id="address-search"
                className="input"
                type="text"
                value={addressInput}
                onChange={(event) => setAddressInput(event.target.value)}
                placeholder="Paste a Vorliq wallet address"
              />
            </div>
            <button className="button" type="submit">
              Search
            </button>
          </form>
        </div>

        {addressSearch && addressResults.length === 0 && (
          <div className="empty-state">No transactions found for this address.</div>
        )}

        {addressResults.map((transaction) => {
          const searchedAddress = addressSearch.trim();
          const isSent = transaction.sender_address === searchedAddress;
          const otherParty = isSent ? transaction.receiver_address : transaction.sender_address;

          return (
            <div className="card card-pad explorer-result" key={transaction.id}>
              <span className={`direction ${isSent ? "sent" : "received"}`}>
                {isSent ? "Sent" : "Received"}
              </span>
              <span>Block #{transaction.block_index}</span>
              <span>{shortenAddress(otherParty)}</span>
              <strong>{transaction.amount} VLQ</strong>
            </div>
          );
        })}
      </section>
    );
  }

  function renderTransactionLookup() {
    return (
      <section className="stack">
        <div className="card card-pad">
          <form
            className="form"
            onSubmit={(event) => {
              event.preventDefault();
              setLookupSearch(lookupInput);
            }}
          >
            <div className="field">
              <label htmlFor="transaction-lookup">Transaction Signature, Sender, or Receiver</label>
              <input
                id="transaction-lookup"
                className="input"
                type="text"
                value={lookupInput}
                onChange={(event) => setLookupInput(event.target.value)}
                placeholder="Paste a signature or wallet address"
              />
            </div>
            <button className="button" type="submit">
              Lookup
            </button>
          </form>
        </div>

        {lookupSearch && lookupResults.length === 0 && (
          <div className="empty-state">No matching transaction found.</div>
        )}

        {lookupResults.map((transaction) => (
          <article className="card card-pad block-card" key={transaction.id}>
            <div className="section-title">
              <h2>Transaction</h2>
              <span className={signatureStatuses[transaction.id] === "Valid" ? "green" : "red"}>
                Signature {signatureStatuses[transaction.id] || "Checking"}
              </span>
            </div>
            <div className="block-meta">
              <div className="meta-item">
                <span className="meta-label">Full Sender Address</span>
                <span className="meta-value">{transaction.sender_address}</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Full Receiver Address</span>
                <span className="meta-value">{transaction.receiver_address}</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Amount</span>
                <span className="meta-value">{transaction.amount} VLQ</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Timestamp</span>
                <span className="meta-value">
                  {new Date(transaction.timestamp * 1000).toLocaleString()}
                </span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Block Number</span>
                <span className="meta-value">{transaction.block_index}</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Signature</span>
                <span className="meta-value">{transaction.signature || "System transaction"}</span>
              </div>
            </div>
          </article>
        ))}
      </section>
    );
  }

  return (
    <main className="page">
      <section className="hero">
        <span className="eyebrow">Chain Explorer</span>
        <h1>Vorliq Blockchain</h1>
        <p className="subtitle">
          Inspect blocks, search wallet activity, and verify transaction signatures recorded by the local VLQ chain.
        </p>
      </section>

      <ErrorMessage message={errorMessage} />

      {renderTabs()}

      {activeTab === "blocks" && renderBlockList()}
      {activeTab === "address" && renderAddressSearch()}
      {activeTab === "lookup" && renderTransactionLookup()}
    </main>
  );
}

export default Blockchain;
