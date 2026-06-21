// Mining page inside the new app shell (/preview/app/mining). Carries forward
// the existing Mine page's real data sources: /mining/status for the header
// figures and /mining/history for mined blocks (filtered to the connected
// wallet). The header cards show real mining parameters — block reward,
// difficulty, block-time target — not a fabricated hash rate (block production
// here is floor-gated by a minimum block time, not hashing power). Node-setup
// commands and the doc link are taken verbatim from the project's
// run-your-own-node guide.
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Boxes, Coins, Gauge, Timer } from "lucide-react";

import "../../styles/vnext.css";
import AppShell from "../../components/vnext/AppShell";
import CodeBlock from "../../components/vnext/CodeBlock";
import DataTable from "../../components/vnext/DataTable";
import SummaryCard from "../../components/vnext/SummaryCard";
import { Button, Card, InlineError } from "../../components/vnext/primitives";
import { useAuth } from "../../context/AuthContext";
import { useRealtime } from "../../context/RealtimeContext";
import api from "../../helpers/api";
import { formatHash, formatNumber, formatRelativeTime, formatVlq } from "../../helpers/publicApi";

const NODE_DOC_URL = "https://vorliq.github.io/Vorliq/run-your-own-node.html";

// Verbatim from docs/run-your-own-node.html (Verify + Install steps).
const NODE_SETUP_COMMANDS = `# Verify a trusted public node before joining
node tools/bootstrap_verify_node.js https://vorliq.org

# Install with the verified installer (fresh Ubuntu server, as root)
curl -fsSL https://raw.githubusercontent.com/vorliq/Vorliq/main/deployment/install_verified_node.sh -o install_verified_node.sh
sudo bash install_verified_node.sh`;

const HISTORY_PAGE = 200;
const HISTORY_PAGE_CAP = 5; // up to 1000 recent blocks scanned for this miner

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// Header figures from /mining/status.
function useMiningStatus() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (signal) => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get("/mining/status", { signal });
      setStatus(res.data?.status || null);
    } catch (err) {
      if (err?.name === "CanceledError" || err?.code === "ERR_CANCELED") return;
      setError("Unable to load mining status.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return { status, loading, error, reload: () => load() };
}

// Blocks mined by the connected wallet, filtered from the existing
// /mining/history endpoint (recent window, paged up to the cap).
function useMyMinedBlocks(address) {
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
        const mine = [];
        let offset = 0;
        for (let i = 0; i < HISTORY_PAGE_CAP; i += 1) {
          const res = await api.get("/mining/history", {
            params: { limit: HISTORY_PAGE, offset },
            signal,
          });
          const batch = res.data?.history || [];
          mine.push(...batch.filter((b) => b.miner_address === address));
          if (batch.length < HISTORY_PAGE) break;
          offset += HISTORY_PAGE;
        }
        setRows(mine);
      } catch (err) {
        if (err?.name === "CanceledError" || err?.code === "ERR_CANCELED") return;
        setError("Unable to load your mining history.");
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

const historyColumns = [
  {
    key: "block",
    header: "Block",
    render: (b) => (
      <Link className="vn-block-link" to={`/block/${b.block_hash || b.block_index}`}>
        #{formatNumber(b.block_index)}
      </Link>
    ),
  },
  {
    key: "reward",
    header: "Reward earned",
    render: (b) => (num(b.miner_reward_amount) != null ? formatVlq(b.miner_reward_amount) : "—"),
  },
  {
    key: "time",
    header: "Timestamp",
    render: (b) => (b.timestamp != null ? formatRelativeTime(b.timestamp) : "—"),
  },
  {
    key: "hash",
    header: "Block hash",
    className: "vn-mono",
    render: (b) => <span title={b.block_hash}>{formatHash(b.block_hash)}</span>,
  },
];

function NodeSetupSection() {
  return (
    <Card style={{ marginTop: 20 }}>
      <h2 className="vn-panel-title">Run a Vorliq node</h2>
      <p style={{ color: "var(--vn-text-2)", marginTop: 0, lineHeight: 1.6 }}>
        A Vorliq node runs the blockchain API, backend, web app, and heartbeat so the community can
        compare public state across independent operators. Verify a trusted node first, then install.
      </p>
      <CodeBlock code={NODE_SETUP_COMMANDS} ariaLabel="Vorliq node setup commands" />
      <div style={{ marginTop: 16 }}>
        <Button variant="secondary" href={NODE_DOC_URL}>
          Read the node setup guide
        </Button>
      </div>
    </Card>
  );
}

export default function Mining() {
  const { isLoggedIn, wallet } = useAuth();
  const address = wallet?.address;
  const { status, loading: statusLoading, error: statusError, reload: reloadStatus } = useMiningStatus();
  const { rows, error: historyError, reload: reloadHistory } = useMyMinedBlocks(address);

  // "Current block reward" = miner share + treasury share (both from status).
  const minerShare = num(status?.miner_reward_after_treasury);
  const treasuryShare = num(status?.treasury_reward_per_block);
  const blockReward = minerShare != null ? minerShare + (treasuryShare || 0) : undefined;
  const difficulty = num(status?.current_difficulty);
  const blockTimeTarget = num(status?.block_time_target);

  // Live block height: the fetched status figure, raised in real time whenever a
  // new block is confirmed on the network (via the realtime socket), so the
  // counter increments without a manual refresh.
  const { latestBlockHeight } = useRealtime();
  const statusHeight = num(status?.current_block_height);
  const blockHeight =
    statusHeight != null || latestBlockHeight != null
      ? Math.max(statusHeight ?? 0, latestBlockHeight ?? 0)
      : null;

  // No honest network hash rate exists on this chain: block production is gated
  // by a minimum block time, not by hashing power, and per-block mining
  // durations are not recorded, so a difficulty-over-time figure would only
  // reflect the cadence floor. Show the real block-time target instead.
  const cards = [
    { label: "Block height", value: blockHeight != null ? formatNumber(blockHeight) : null, icon: Boxes },
    { label: "Current block reward", value: blockReward != null ? formatVlq(blockReward) : null, icon: Coins },
    { label: "Network difficulty", value: difficulty != null ? formatNumber(difficulty) : null, icon: Gauge },
    { label: "Block time target", value: blockTimeTarget != null ? `${formatNumber(blockTimeTarget)}s` : null, icon: Timer },
  ];

  const historyLoading = rows == null && isLoggedIn;
  const hasMined = Array.isArray(rows) && rows.length > 0;

  return (
    <AppShell active="mining">
      <div className="vn-page-head">
        <h1>Mining</h1>
        <div className="vn-page-head__meta">Proof of work on Vorliq's chain</div>
      </div>

      {/* Header stat cards */}
      {statusError ? (
        <InlineError message={statusError} onRetry={reloadStatus} />
      ) : (
        <div className="vn-summary-grid">
          {cards.map((c) => (
            <SummaryCard key={c.label} label={c.label} value={c.value} icon={c.icon} loading={statusLoading} />
          ))}
        </div>
      )}

      {/* Mining history or empty state */}
      <Card style={{ marginTop: 20 }}>
        <h2 className="vn-panel-title">Your mining history</h2>
        {historyError ? (
          <InlineError message={historyError} onRetry={reloadHistory} />
        ) : !isLoggedIn ? (
          <p className="vn-empty-note" style={{ margin: 0 }}>
            <Link className="vn-block-link" to="/login">
              Sign in
            </Link>{" "}
            to see blocks mined by your wallet.
          </p>
        ) : historyLoading ? (
          <DataTable columns={historyColumns} rows={null} loading pageSize={10} />
        ) : hasMined ? (
          <DataTable
            columns={historyColumns}
            rows={rows}
            rowKey={(b, i) => b.block_hash || `${b.block_index}-${i}`}
            pageSize={10}
            caption="Blocks mined by this wallet"
          />
        ) : (
          <div className="vn-mining-empty">
            <h3>You haven't mined any blocks yet</h3>
            <p>
              Run a Vorliq node to mine blocks and support the chain. Your mined blocks will appear
              here once they're confirmed.
            </p>
            <Button variant="primary" href={NODE_DOC_URL}>
              Set up a node to start mining
            </Button>
          </div>
        )}
      </Card>

      {/* How to run a node */}
      <NodeSetupSection />
    </AppShell>
  );
}
