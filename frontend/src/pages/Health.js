import { useEffect, useMemo, useState } from "react";

import ErrorMessage from "../components/ErrorMessage";
import Spinner from "../components/Spinner";
import api from "../helpers/api";
import { apiErrorMessage } from "../helpers/errors";

async function checkNetworkNode(nodeUrl) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 5000);
  const start = performance.now();

  try {
    const response = await fetch(`${nodeUrl.replace(/\/$/, "")}/chain`, {
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error("Node returned an error.");
    }
    return {
      online: true,
      responseTime: Math.round(performance.now() - start),
    };
  } catch (error) {
    return {
      online: false,
      responseTime: null,
    };
  } finally {
    window.clearTimeout(timeout);
  }
}

function Health() {
  const [diagnostics, setDiagnostics] = useState(null);
  const [registryNodes, setRegistryNodes] = useState([]);
  const [networkHealth, setNetworkHealth] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let mounted = true;

    async function loadHealth() {
      setLoading(true);
      setErrorMessage("");

      try {
        const [diagnosticsResponse, registryResponse] = await Promise.all([
          api.get("/diagnostics"),
          api.get("/registry/nodes"),
        ]);
        const nodes = registryResponse.data.nodes || [];
        const nodeChecks = await Promise.all(
          nodes.map(async (node) => ({
            ...node,
            ...(await checkNetworkNode(node.node_url)),
          }))
        );

        if (mounted) {
          setDiagnostics(diagnosticsResponse.data);
          setRegistryNodes(nodes);
          setNetworkHealth(nodeChecks);
        }
      } catch (error) {
        if (mounted) {
          setErrorMessage(
            apiErrorMessage(
              error,
              "Some Vorliq services could not be reached. Check that start.bat is running."
            )
          );
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadHealth();

    return () => {
      mounted = false;
    };
  }, []);

  const diagnosticRows = useMemo(() => {
    if (!diagnostics) {
      return [];
    }

    return [
      ["Node URL", diagnostics.node_url],
      ["Current Block Height", diagnostics.block_height],
      ["Chain Valid", diagnostics.chain_valid ? "Valid" : "Invalid"],
      ["Pending Transactions", diagnostics.pending_transactions],
      ["Known Peers", diagnostics.known_peers],
      ["Active Registry Nodes", diagnostics.active_registry_nodes],
      ["Uptime", `${diagnostics.uptime_seconds} seconds`],
      ["Total VLQ in Circulation", `${diagnostics.total_vlq_in_circulation} VLQ`],
      ["Current Mining Reward", `${diagnostics.current_mining_reward} VLQ`],
      ["Last Block Hash", diagnostics.last_block_hash],
      [
        "Last Block Timestamp",
        diagnostics.last_block_timestamp
          ? new Date(diagnostics.last_block_timestamp * 1000).toLocaleString()
          : "Unavailable",
      ],
    ];
  }, [diagnostics]);

  return (
    <main className="page">
      <section className="hero">
        <span className="eyebrow">Node Operations</span>
        <h1>Health</h1>
        <p className="subtitle">
          Monitor local node diagnostics, public registry nodes, and live network response times.
        </p>
      </section>

      <ErrorMessage message={errorMessage} />

      <section className="card card-pad health-section">
        <h2>Local Node Diagnostics</h2>
        {loading ? (
          <Spinner label="Loading node diagnostics..." />
        ) : diagnostics ? (
          <div className="table-wrap">
            <table className="stats-table">
              <tbody>
                {diagnosticRows.map(([label, value]) => (
                  <tr key={label}>
                    <th>{label}</th>
                    <td className={label === "Chain Valid" && value === "Valid" ? "green" : ""}>
                      {value}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">Diagnostics are unavailable right now.</div>
        )}
      </section>

      <section className="card card-pad health-section">
        <div className="section-title">
          <h2>Network Node Health</h2>
          <span className="eyebrow">{registryNodes.length} registered</span>
        </div>
        {loading && <Spinner label="Checking registry nodes..." />}
        {!loading && networkHealth.length === 0 && (
          <div className="empty-state">No active registry nodes are available right now.</div>
        )}
        <div className="health-list">
          {networkHealth.map((node) => (
            <div className="health-row" key={node.node_url}>
              <span className={`health-icon ${node.online ? "online" : "offline"}`}>
                {node.online ? "\u2713" : "\u00d7"}
              </span>
              <div>
                <strong>{node.display_name}</strong>
                <span>{node.node_url}</span>
              </div>
              <span>{node.online ? `${node.responseTime} ms` : "offline"}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

export default Health;
