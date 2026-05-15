import { useEffect, useMemo, useState } from "react";
import { ec as EC } from "elliptic";
import { toast } from "react-toastify";

import ErrorMessage from "../components/ErrorMessage";
import Spinner from "../components/Spinner";
import api from "../helpers/api";
import { apiErrorMessage } from "../helpers/errors";
import { createPythonSigningPayload } from "../helpers/signer";

const secp256k1 = new EC("secp256k1");
const PAGE_SIZE = 20;
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
  const [totalBlocks, setTotalBlocks] = useState(0);
  const [hasMoreBlocks, setHasMoreBlocks] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [activeTab, setActiveTab] = useState("blocks");
  const [search, setSearch] = useState("");
  const [addressInput, setAddressInput] = useState("");
  const [addressSearch, setAddressSearch] = useState("");
  const [addressResults, setAddressResults] = useState([]);
  const [addressHasMore, setAddressHasMore] = useState(false);
  const [addressLoading, setAddressLoading] = useState(false);
  const [lookupInput, setLookupInput] = useState("");
  const [lookupSearch, setLookupSearch] = useState("");
  const [signatureStatuses, setSignatureStatuses] = useState({});
  const [errorMessage, setErrorMessage] = useState("");

  async function loadBlocks(offset = 0, append = false) {
    const response = await api.get("/chain/blocks", {
      params: { limit: PAGE_SIZE, offset },
    });
    setChain((current) => (append ? [...current, ...(response.data.blocks || [])] : response.data.blocks || []));
    setTotalBlocks(response.data.total_blocks || 0);
    setHasMoreBlocks(Boolean(response.data.has_more));
  }

  useEffect(() => {
    let mounted = true;

    async function loadInitialBlocks() {
      try {
        const response = await api.get("/chain/blocks", {
          params: { limit: PAGE_SIZE, offset: 0 },
        });
        if (mounted) {
          setChain(response.data.blocks || []);
          setTotalBlocks(response.data.total_blocks || 0);
          setHasMoreBlocks(Boolean(response.data.has_more));
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

    loadInitialBlocks();

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
          block_timestamp: block.timestamp,
          transaction_index: index,
          id: `${block.hash}-${index}`,
        }))
      ),
    [chain]
  );

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

  const verifiableTransactions = useMemo(
    () => [...transactions, ...addressResults, ...lookupResults],
    [addressResults, lookupResults, transactions]
  );

  useEffect(() => {
    let mounted = true;

    async function verifyVisibleTransactions() {
      const updates = {};
      const candidates = verifiableTransactions.filter(
        (transaction) => transaction.signature || SYSTEM_ADDRESSES.has(transaction.sender_address)
      );

      await Promise.all(
        candidates.map(async (transaction) => {
          const id = transaction.id || `${transaction.block_hash}-${transaction.transaction_index}`;
          updates[id] = await verifyTransactionSignature(transaction);
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
  }, [verifiableTransactions]);

  async function loadMoreBlocks() {
    setLoadingMore(true);
    try {
      await loadBlocks(chain.length, true);
    } catch (error) {
      const message = apiErrorMessage(error, "Unable to load more blocks.");
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleBlockSearch(event) {
    event.preventDefault();
    const term = search.trim();
    if (!term) {
      setLoading(true);
      try {
        await loadBlocks(0, false);
      } catch (error) {
        toast.error(apiErrorMessage(error, "Unable to load blocks."));
      } finally {
        setLoading(false);
      }
      return;
    }

    if (/^\d+$/.test(term)) {
      const index = Number(term);
      const offset = Math.max(totalBlocks - 1 - index, 0);
      setLoading(true);
      try {
        const response = await api.get("/chain/blocks", {
          params: { limit: 1, offset },
        });
        setChain((response.data.blocks || []).filter((block) => Number(block.index) === index));
        setTotalBlocks(response.data.total_blocks || totalBlocks);
        setHasMoreBlocks(false);
        setErrorMessage("");
      } catch (error) {
        const message = apiErrorMessage(error, "Unable to find that block.");
        setErrorMessage(message);
        toast.error(message);
      } finally {
        setLoading(false);
      }
      return;
    }

    setActiveTab("address");
    setAddressInput(term);
    await searchAddress(term, 0, false);
  }

  async function searchAddress(address, offset = 0, append = false) {
    const normalized = address.trim();
    if (!normalized) {
      return;
    }

    setAddressSearch(normalized);
    setAddressLoading(true);
    try {
      const response = await api.get("/chain/address", {
        params: { address: normalized, limit: PAGE_SIZE, offset },
      });
      const transactionsForAddress = (response.data.transactions || []).map((transaction) => ({
        ...transaction,
        id: `${transaction.block_hash}-${transaction.transaction_index}`,
      }));
      setAddressResults((current) => (append ? [...current, ...transactionsForAddress] : transactionsForAddress));
      setAddressHasMore(Boolean(response.data.has_more));
      setErrorMessage("");
    } catch (error) {
      const message = apiErrorMessage(error, "Unable to search this address.");
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setAddressLoading(false);
    }
  }

  function renderTabs() {
    return (
      <div className="tab-list">
        <button className={`tab-button ${activeTab === "blocks" ? "active" : ""}`} type="button" onClick={() => setActiveTab("blocks")}>
          Blocks
        </button>
        <button className={`tab-button ${activeTab === "address" ? "active" : ""}`} type="button" onClick={() => setActiveTab("address")}>
          Search Address
        </button>
        <button className={`tab-button ${activeTab === "lookup" ? "active" : ""}`} type="button" onClick={() => setActiveTab("lookup")}>
          Transaction Lookup
        </button>
      </div>
    );
  }

  function renderBlockList() {
    return (
      <>
        <section className="card card-pad explorer-search">
          <form className="form" onSubmit={handleBlockSearch}>
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
            <button className="button" type="submit">Search</button>
          </form>
        </section>

        <section className="stack">
          {loading && <Spinner label="Loading blockchain blocks..." />}
          {!loading && chain.length === 0 && <div className="empty-state">No blocks found.</div>}
          {!loading && chain.map(renderBlock)}
          {!loading && hasMoreBlocks && (
            <button className="button secondary" type="button" disabled={loadingMore} onClick={loadMoreBlocks}>
              {loadingMore ? "Loading..." : "Load More Blocks"}
            </button>
          )}
        </section>
      </>
    );
  }

  function renderBlock(block) {
    return (
      <article className="card card-pad block-card" key={block.hash}>
        <div className="section-title">
          <h2>Block #{block.index}</h2>
          <span className="eyebrow">{block.transactions?.length || 0} transactions</span>
        </div>

        <div className="block-meta">
          <Meta label="Block Hash" value={block.hash} />
          <Meta label="Previous Hash" value={block.previous_hash} />
          <Meta label="Timestamp" value={new Date(block.timestamp * 1000).toLocaleString()} />
          <Meta label="Nonce" value={block.nonce} />
        </div>

        <div className="transactions">
          <h3>Transactions</h3>
          {block.transactions?.length ? (
            block.transactions.map((transaction, index) => (
              <div className="transaction-item" key={`${block.hash}-${index}`}>
                <Meta label="Sender" value={transaction.sender_address} />
                <Meta label="Receiver" value={transaction.receiver_address} />
                <Meta label="Amount" value={`${transaction.amount} VLQ`} />
              </div>
            ))
          ) : (
            <div className="empty-state">This block has no transactions.</div>
          )}
        </div>
      </article>
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
              searchAddress(addressInput, 0, false);
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
            <button className="button" type="submit">Search</button>
          </form>
        </div>

        {addressLoading && <Spinner label="Searching address transactions..." />}
        {addressSearch && !addressLoading && addressResults.length === 0 && (
          <div className="empty-state">No transactions found for this address.</div>
        )}

        {addressResults.map((transaction) => renderTransactionResult(transaction, addressSearch))}

        {!addressLoading && addressHasMore && (
          <button className="button secondary" type="button" onClick={() => searchAddress(addressSearch, addressResults.length, true)}>
            Load More Transactions
          </button>
        )}
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
            <button className="button" type="submit">Lookup Recent Blocks</button>
          </form>
        </div>

        <p className="help-text">Transaction lookup searches the blocks currently loaded in this explorer view.</p>

        {lookupSearch && lookupResults.length === 0 && (
          <div className="empty-state">No matching transaction found in the loaded blocks.</div>
        )}

        {lookupResults.map((transaction) => renderTransactionCard(transaction))}
      </section>
    );
  }

  function renderTransactionResult(transaction, searchedAddress) {
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
  }

  function renderTransactionCard(transaction) {
    const id = transaction.id || `${transaction.block_hash}-${transaction.transaction_index}`;
    return (
      <article className="card card-pad block-card" key={id}>
        <div className="section-title">
          <h2>Transaction</h2>
          <span className={signatureStatuses[id] === "Valid" ? "green" : "red"}>
            Signature {signatureStatuses[id] || "Checking"}
          </span>
        </div>
        <div className="block-meta">
          <Meta label="Full Sender Address" value={transaction.sender_address} />
          <Meta label="Full Receiver Address" value={transaction.receiver_address} />
          <Meta label="Amount" value={`${transaction.amount} VLQ`} />
          <Meta label="Timestamp" value={new Date((transaction.block_timestamp || transaction.timestamp) * 1000).toLocaleString()} />
          <Meta label="Block Number" value={transaction.block_index} />
          <Meta label="Signature" value={transaction.signature || "System transaction"} />
        </div>
      </article>
    );
  }

  return (
    <main className="page">
      <section className="hero">
        <span className="eyebrow">Chain Explorer</span>
        <h1>Vorliq Blockchain</h1>
        <p className="subtitle">
          Inspect recent blocks, search wallet activity, and verify transaction signatures recorded by the VLQ chain.
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

function Meta({ label, value }) {
  return (
    <div className="meta-item">
      <span className="meta-label">{label}</span>
      <span className="meta-value">{value}</span>
    </div>
  );
}

export default Blockchain;
