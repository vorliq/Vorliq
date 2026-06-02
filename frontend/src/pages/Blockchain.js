import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { toast } from "react-toastify";

import { ButtonLink, Card, PageShell, Reveal, Section, StatusPill } from "../components/MarketingPrimitives";
import ErrorMessage from "../components/ErrorMessage";
import api from "../helpers/api";
import { apiErrorMessage } from "../helpers/errors";
import { formatTime, formatVlq, loadPublicChainSnapshot, shortHash } from "../helpers/publicApi";

const PAGE_SIZE = 12;

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
        setErrorMessage("");
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
  const transactions = useMemo(() => {
    if (!snapshot) return [];
    return (snapshot.confirmedTransactions || []).slice(0, 12);
  }, [snapshot]);

  return (
    <PageShell>
      <Section className="grid gap-8">
        <Reveal className="max-w-4xl pt-6">
          <StatusPill>Vorliq public chain</StatusPill>
          <h1 className="mt-5 text-[clamp(2.4rem,7vw,5rem)] font-black leading-none text-white">Vorliq Blockchain</h1>
          <p className="mt-6 max-w-3xl text-lg leading-8 text-vorliq-muted">
            Follow blocks, confirmed transactions, pending transactions, and wallet activity on Vorliq's own lightweight blockchain.
          </p>
        </Reveal>

        <ErrorMessage message={errorMessage} />

        <Card className="p-5 md:p-6">
          <form className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end" onSubmit={handleSearch}>
            <div className="grid gap-2">
              <label className="text-sm font-black text-white" htmlFor="chain-search">
                Search block, transaction, or wallet address
              </label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-vorliq-muted" size={18} aria-hidden="true" />
                <input
                  id="chain-search"
                  className="min-h-12 w-full rounded-lg border border-vorliq-border bg-[#0A0E1A] pl-11 pr-4 font-mono text-sm text-white outline-none transition focus:border-vorliq-accent"
                  type="text"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Block index, hash, transaction ID, or wallet address"
                />
              </div>
            </div>
            <button className="min-h-12 rounded-full bg-vorliq-accent px-5 py-3 text-sm font-black text-[#06101c] shadow-glow" type="submit">
              Search Explorer
            </button>
          </form>
        </Card>

        {loading ? (
          <Card className="p-6 text-vorliq-muted">Loading blockchain explorer...</Card>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5" aria-label="Chain summary">
              <ExplorerStat
                label="Wallet holders"
                value={snapshot?.unavailable.holders ? "Unavailable" : snapshot?.holderTotal ?? "Unavailable"}
                note="Public holder count comes from the leaderboard endpoint."
              />
              <ExplorerStat label="Total blocks" value={snapshot?.unavailable.summary ? "Unavailable" : summary.total_blocks ?? "Unavailable"} />
              <ExplorerStat label="Confirmed transactions" value={snapshot?.unavailable.confirmedTransactions ? "Unavailable" : summary.total_transactions ?? snapshot?.confirmedTotal ?? "Unavailable"} />
              <ExplorerStat
                label="Pending transactions"
                value={
                  snapshot?.unavailable.pendingTransactions || snapshot?.pendingTotal == null
                    ? "Unavailable"
                    : snapshot.pendingTotal
                  }
              />
              <ExplorerStat
                label="Chain health"
                value={snapshot?.unavailable.summary ? "Unavailable" : summary.chain_valid ? "Valid" : "Review"}
                tone={snapshot?.unavailable.summary ? "gold" : summary.chain_valid ? "teal" : "gold"}
              />
            </div>

            <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
              <Card className="grid content-start gap-4 p-5">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <h2 className="text-2xl font-black text-white">Recent Blocks</h2>
                  <span className="font-mono text-sm text-vorliq-muted">{summary.total_blocks ?? blocks.length} total</span>
                </div>
                {blocks.length ? (
                  blocks.map((block) => <BlockRow block={block} key={block.hash || block.index} />)
                ) : snapshot?.unavailable.blocks ? (
                  <EmptyState>Block history is unavailable from the public API right now.</EmptyState>
                ) : (
                  <EmptyState>No blocks are available from the public API right now.</EmptyState>
                )}
                {hasMoreBlocks && (
                  <button
                    className="rounded-full border border-vorliq-border px-5 py-3 text-sm font-black text-white"
                    type="button"
                    disabled={loadingMore}
                    onClick={loadMoreBlocks}
                  >
                    {loadingMore ? "Loading..." : "Load More Blocks"}
                  </button>
                )}
              </Card>

              <Card className="grid content-start gap-4 p-5">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <h2 className="text-2xl font-black text-white">Pending Transactions</h2>
                  <StatusPill tone="gold">awaiting mining</StatusPill>
                </div>
                {snapshot?.pendingTransactions?.length ? (
                  snapshot.pendingTransactions.map((transaction) => (
                    <TransactionRow transaction={transaction} key={transaction.tx_id} />
                  ))
                ) : snapshot?.unavailable.pendingTransactions ? (
                  <EmptyState>Pending transaction data is unavailable from the public API right now.</EmptyState>
                ) : (
                  <EmptyState>No pending transactions are waiting right now.</EmptyState>
                )}
                <ButtonLink to="/send" variant="secondary">Create Transaction</ButtonLink>
              </Card>
            </div>

            <Card className="grid gap-4 p-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-2xl font-black text-white">Recent Confirmed Transactions</h2>
                <span className="text-sm font-bold text-vorliq-muted">Mined public transaction records</span>
              </div>
              {transactions.length ? (
                <div className="grid gap-3 md:grid-cols-2">
                  {transactions.map((transaction, index) => (
                    <TransactionRow transaction={transaction} key={transaction.tx_id || index} />
                  ))}
                </div>
              ) : snapshot?.unavailable.confirmedTransactions ? (
                <EmptyState>Confirmed transaction history is unavailable from the public API right now.</EmptyState>
              ) : (
                <EmptyState>No confirmed transactions are available right now.</EmptyState>
              )}
            </Card>

            {addressSearch && (
              <div ref={addressResultsRef}>
                <Card className="grid gap-4 p-5">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <span className="text-xs font-black uppercase tracking-[0.12em] text-vorliq-muted">Wallet History</span>
                      <h2 className="font-mono text-2xl font-black text-white">{shortHash(addressSearch)}</h2>
                      <p className="mt-2 text-sm font-semibold text-vorliq-muted">
                        {addressTotal === null ? "Showing public transaction matches." : `${addressTotal} public transaction match${addressTotal === 1 ? "" : "es"}.`}
                      </p>
                    </div>
                    <Link className="rounded-full border border-vorliq-border px-4 py-2 text-sm font-black text-white" to={`/profile?address=${encodeURIComponent(addressSearch)}`}>
                      View Profile
                    </Link>
                  </div>
                  {addressResults.length ? (
                    addressResults.map((transaction) => <TransactionRow transaction={transaction} key={transaction.tx_id} />)
                  ) : (
                    <EmptyState>No transactions found for this wallet address.</EmptyState>
                  )}
                </Card>
              </div>
            )}
          </>
        )}
      </Section>
    </PageShell>
  );
}

function ExplorerStat({ label, value, note, tone = "muted" }) {
  const toneClass = tone === "teal" ? "text-vorliq-accent" : tone === "gold" ? "text-vorliq-gold" : "text-white";
  return (
    <Card className="p-4">
      <span className="text-xs font-black uppercase tracking-[0.12em] text-vorliq-muted">{label}</span>
      <strong className={`mt-3 block break-words font-mono text-2xl ${toneClass}`}>{value}</strong>
      {note && <p className="mt-2 text-xs leading-5 text-vorliq-muted">{note}</p>}
    </Card>
  );
}

function BlockRow({ block }) {
  return (
    <Link className="rounded-lg border border-vorliq-border bg-[#0A0E1A]/72 p-4 transition hover:border-vorliq-accent" to={`/block/${block.hash || block.index}`}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <StatusPill>block #{block.index}</StatusPill>
        <span className="font-mono text-sm text-vorliq-muted">{formatTime(block.timestamp)}</span>
      </div>
      <strong className="mt-3 block break-all font-mono text-sm text-white">{shortHash(block.hash)}</strong>
      <span className="mt-2 block text-sm font-bold text-vorliq-muted">{block.transaction_count ?? (block.transactions || []).length} tx</span>
    </Link>
  );
}

function TransactionRow({ transaction }) {
  const status = String(transaction.status || "confirmed").toLowerCase();
  const txId = transaction.tx_id || transaction.id;
  if (!txId) {
    return (
      <div className="rounded-lg border border-vorliq-border bg-[#0A0E1A]/72 p-4">
        <StatusPill tone={status === "pending" ? "gold" : "teal"}>{status === "pending" ? "Pending" : "Confirmed"}</StatusPill>
        <strong className="mt-3 block text-sm text-white">Transaction ID unavailable</strong>
        <span className="mt-2 block break-all font-mono text-xs text-vorliq-muted">
          From {shortHash(transaction.sender_address || transaction.sender)}
        </span>
      </div>
    );
  }
  return (
    <Link className="rounded-lg border border-vorliq-border bg-[#0A0E1A]/72 p-4 transition hover:border-vorliq-accent" to={`/tx/${encodeURIComponent(txId)}`}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <StatusPill tone={status === "pending" ? "gold" : "teal"}>{status === "pending" ? "Pending" : "Confirmed"}</StatusPill>
        <span className="font-mono text-sm font-black text-vorliq-muted">{formatVlq(transaction.amount)}</span>
      </div>
      <strong className="mt-3 block break-all font-mono text-sm text-white">{shortHash(txId)}</strong>
      <span className="mt-2 block break-all font-mono text-xs text-vorliq-muted">
        From {shortHash(transaction.sender_address || transaction.sender)}
      </span>
      {transaction.receiver_address && (
        <span className="mt-1 block break-all font-mono text-xs text-vorliq-muted">
          To {shortHash(transaction.receiver_address)}
        </span>
      )}
    </Link>
  );
}

function EmptyState({ children }) {
  return <div className="rounded-lg border border-vorliq-border bg-[#0A0E1A]/72 p-5 font-semibold text-vorliq-muted">{children}</div>;
}

export default Blockchain;
