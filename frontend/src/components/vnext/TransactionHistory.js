// Shared wallet transaction history: the paginated /chain/address fetch, the
// column definitions, the expandable per-row detail, and the Card wrapper.
// Used by both the Dashboard and the Wallet page so the two surfaces show the
// same data through the same code path rather than diverging copies.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";

import api from "../../helpers/api";
import { formatNumber, formatRelativeTime, formatVlq } from "../../helpers/publicApi";
import { Card } from "./primitives";
import DataTable from "./DataTable";

const TX_PAGE = 200;
const TX_PAGE_CAP = 5; // up to 1000 transactions

function shortAddress(value) {
  if (!value) return "—";
  const text = String(value);
  return text.length > 12 ? `${text.slice(0, 6)}…${text.slice(-4)}` : text;
}

export function useTransactions(address) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(
    async (signal) => {
      if (!address) {
        setRows([]);
        setError("");
        return;
      }
      setRows(null);
      setError("");
      try {
        const all = [];
        let offset = 0;
        for (let i = 0; i < TX_PAGE_CAP; i += 1) {
          const res = await api.get("/chain/address", {
            params: { address, limit: TX_PAGE, offset },
            signal,
          });
          const batch = res.data?.transactions || [];
          all.push(...batch);
          if (!res.data?.has_more || batch.length === 0) break;
          offset += TX_PAGE;
        }
        setRows(all);
      } catch (err) {
        if (err?.name === "CanceledError" || err?.code === "ERR_CANCELED") return;
        setError("We couldn't load your transaction history.");
        setRows([]);
      }
    },
    [address]
  );

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return { rows, error, reload: () => load() };
}

function txColumns(address) {
  return [
    {
      key: "type",
      header: "Type",
      render: (tx) => {
        const received = tx.receiver_address === address;
        return (
          <span className={`vn-tx-type ${received ? "vn-tx-type--in" : "vn-tx-type--out"}`}>
            {received ? <ArrowDownLeft size={16} aria-hidden="true" /> : <ArrowUpRight size={16} aria-hidden="true" />}
            {received ? "Received" : "Sent"}
          </span>
        );
      },
    },
    { key: "amount", header: "Amount", render: (tx) => formatVlq(tx.amount) },
    {
      key: "party",
      header: "Counterparty",
      className: "vn-mono",
      render: (tx) => {
        const other = tx.receiver_address === address ? tx.sender_address : tx.receiver_address;
        return <span title={other}>{shortAddress(other)}</span>;
      },
    },
    {
      key: "block",
      header: "Block",
      render: (tx) =>
        tx.block_index != null ? (
          <Link className="vn-block-link" to={`/block/${tx.block_index}`}>
            #{formatNumber(tx.block_index)}
          </Link>
        ) : (
          "—"
        ),
    },
    { key: "time", header: "Time", render: (tx) => formatRelativeTime(tx.timestamp) || "—" },
  ];
}

function TxDetail({ tx, address }) {
  return (
    <dl className="vn-dt__detail">
      <div>
        <dt>Transaction ID</dt>
        <dd className="vn-mono">{tx.tx_id || tx.hash || "—"}</dd>
      </div>
      <div>
        <dt>Block hash</dt>
        <dd className="vn-mono">{tx.block_hash || "—"}</dd>
      </div>
      <div>
        <dt>From</dt>
        <dd className="vn-mono">{tx.sender_address || "—"}</dd>
      </div>
      <div>
        <dt>To</dt>
        <dd className="vn-mono">{tx.receiver_address || "—"}</dd>
      </div>
      <div>
        <dt>Amount</dt>
        <dd>{formatVlq(tx.amount)}</dd>
      </div>
      <div>
        <dt>Direction</dt>
        <dd>{tx.receiver_address === address ? "Received" : "Sent"}</dd>
      </div>
      {tx.block_index != null && (
        <div>
          <dt>Block</dt>
          <dd>
            <Link className="vn-block-link" to={`/block/${tx.block_index}`}>
              View block #{formatNumber(tx.block_index)}
            </Link>
          </dd>
        </div>
      )}
    </dl>
  );
}

// Full Card-wrapped transaction history panel. `data`/`error`/`onRetry` can be
// supplied by a caller that already owns the fetch (so the Dashboard does not
// fetch twice); otherwise it fetches its own via useTransactions.
const FILTERS = [
  { key: "all", label: "All" },
  { key: "received", label: "Received" },
  { key: "sent", label: "Sent" },
];

export default function TransactionHistory({ address, isLoggedIn, rows: rowsProp, error: errorProp, onRetry, title = "Transaction history" }) {
  const own = useTransactions(rowsProp === undefined ? address : null);
  const rows = rowsProp === undefined ? own.rows : rowsProp;
  const error = rowsProp === undefined ? own.error : errorProp;
  const retry = rowsProp === undefined ? own.reload : onRetry;

  const [filter, setFilter] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  // Debounce the search so filtering runs at most every 300ms, not per keystroke.
  // All filtering is client-side over already-loaded rows — no new fetch.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const query = search.trim().toLowerCase();
  const filteredRows = useMemo(() => {
    if (rows == null) return null;
    const byDirection = rows.filter((tx) => {
      if (filter === "sent") return tx.sender_address === address;
      if (filter === "received") return tx.receiver_address === address;
      return true;
    });
    if (!query) return byDirection;
    return byDirection.filter((tx) =>
      [tx.tx_id, tx.hash, tx.sender_address, tx.receiver_address].some((value) =>
        String(value || "").toLowerCase().includes(query)
      )
    );
  }, [rows, filter, query, address]);

  const emptyMessage = !isLoggedIn
    ? "Sign in to see your transactions."
    : query
      ? `No transactions match "${search.trim()}".`
      : filter !== "all"
        ? `No ${filter} transactions for this wallet yet.`
        : "No transactions for this wallet yet.";

  return (
    <Card>
      <h2 className="vn-panel-title">{title}</h2>
      <div className="vn-txfilter">
        <div className="vn-txfilter__tabs" role="tablist" aria-label="Filter transactions">
          {FILTERS.map((option) => (
            <button
              key={option.key}
              type="button"
              role="tab"
              aria-selected={filter === option.key}
              className={`vn-txfilter__tab ${filter === option.key ? "is-active" : ""}`}
              onClick={() => setFilter(option.key)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <input
          type="search"
          className="vn-input vn-txfilter__search"
          placeholder="Search address or transaction ID"
          aria-label="Search transactions"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
        />
      </div>
      <DataTable
        columns={txColumns(address)}
        rows={filteredRows}
        loading={rows == null && isLoggedIn}
        error={error}
        onRetry={retry}
        rowKey={(tx, i) => tx.tx_id || tx.hash || `${tx.block_index}-${i}`}
        pageSize={20}
        emptyMessage={emptyMessage}
        renderExpanded={(tx) => <TxDetail tx={tx} address={address} />}
        caption="Wallet transaction history"
      />
    </Card>
  );
}
