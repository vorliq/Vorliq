import { useEffect, useMemo, useState } from "react";

import ErrorMessage from "../components/ErrorMessage";
import api from "../helpers/api";
import { apiErrorMessage } from "../helpers/errors";

async function measureRequest(requestFn) {
  const start = performance.now();
  const response = await requestFn();
  return {
    data: response.data,
    responseTime: Math.round(performance.now() - start),
  };
}

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
  const [backendHealth, setBackendHealth] = useState(null);
  const [blockchainHealth, setBlockchainHealth] = useState(null);
  const [chainData, setChainData] = useState(null);
  const [registryNodes, setRegistryNodes] = useState([]);
  const [networkHealth, setNetworkHealth] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let mounted = true;

    async function loadHealth() {
      setLoading(true);
      setErrorMessage("");

      const backendResult = await measureRequest(() => api.get("/health")).catch((error) => ({
        error,
      }));
      const chainResult = await measureRequest(() => api.get("/chain")).catch((error) => ({
        error,
      }));
      const registryResult = await api.get("/registry/nodes").catch((error) => ({ error }));

      const nodes = registryResult.error ? [] : registryResult.data.nodes || [];
      const nodeChecks = await Promise.all(
        nodes.map(async (node) => ({
          ...node,
          ...(await checkNetworkNode(node.node_url)),
        }))
      );

      if (!mounted) {
        return;
      }

      setBackendHealth({
        online: !backendResult.error,
        responseTime: backendResult.responseTime || null,
      });
      setBlockchainHealth({
        online: !chainResult.error,
        responseTime: chainResult.responseTime || null,
      });
      setChainData(chainResult.error ? null : chainResult.data);
      setRegistryNodes(nodes);
      setNetworkHealth(nodeChecks);

      if (backendResult.error || chainResult.error || registryResult.error) {
        setErrorMessage(
          apiErrorMessage(
            backendResult.error || chainResult.error || registryResult.error,
            "Some Vorliq services could not be reached. Check that start.bat is running."
          )
        );
      }

      setLoading(false);
    }

    loadHealth();

    return () => {
      mounted = false;
    };
  }, []);

  const chainHealth = useMemo(() => {
    const chain = chainData?.chain || [];
    const latestBlock = chain[chain.length - 1];
    return {
      height: Math.max(chain.length - 1, 0),
      valid: Boolean(chainData?.is_valid),
      lastHash: latestBlock?.hash || "Unavailable",
      lastTimestamp: latestBlock?.timestamp
        ? new Date(latestBlock.timestamp * 1000).toLocaleString()
        : "Unavailable",
    };
  }, [chainData]);

  return (
    <main className="page">
      <section className="hero">
        <span className="eyebrow">Node Operations</span>
        <h1>Health</h1>
        <p className="subtitle">
          Monitor local Vorliq services, public registry nodes, and the current health of the chain.
        </p>
      </section>

      <ErrorMessage message={errorMessage} />

      <section className="card card-pad health-section">
        <h2>Local Node Health</h2>
        {loading ? (
          <div className="empty-state">Checking local services...</div>
        ) : (
          <div className="health-list">
            <HealthRow label="Express Backend" health={backendHealth} />
            <HealthRow label="Flask Blockchain API" health={blockchainHealth} />
            <HealthRow label="React Frontend" health={{ online: true, responseTime: 0 }} />
          </div>
        )}
      </section>

      <section className="card card-pad health-section">
        <div className="section-title">
          <h2>Network Node Health</h2>
          <span className="eyebrow">{registryNodes.length} registered</span>
        </div>
        {loading && <div className="empty-state">Checking registry nodes...</div>}
        {!loading && networkHealth.length === 0 && (
          <div className="empty-state">No active registry nodes are available right now.</div>
        )}
        <div className="health-list">
          {networkHealth.map((node) => (
            <div className="health-row" key={node.node_url}>
              <span className={`health-icon ${node.online ? "online" : "offline"}`}>
                {node.online ? "✓" : "×"}
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

      <section className="card card-pad health-section">
        <h2>Chain Health</h2>
        <div className="block-meta">
          <div className="meta-item">
            <span className="meta-label">Current Block Height</span>
            <span className="meta-value">{chainHealth.height}</span>
          </div>
          <div className="meta-item">
            <span className="meta-label">Chain Valid</span>
            <span className={chainHealth.valid ? "green" : "red"}>
              {chainHealth.valid ? "Valid" : "Invalid"}
            </span>
          </div>
          <div className="meta-item">
            <span className="meta-label">Last Block Hash</span>
            <span className="meta-value">{chainHealth.lastHash}</span>
          </div>
          <div className="meta-item">
            <span className="meta-label">Last Block Timestamp</span>
            <span className="meta-value">{chainHealth.lastTimestamp}</span>
          </div>
        </div>
      </section>
    </main>
  );
}

function HealthRow({ label, health }) {
  const online = Boolean(health?.online);
  return (
    <div className="health-row">
      <span className={`health-icon ${online ? "online" : "offline"}`}>
        {online ? "✓" : "×"}
      </span>
      <strong>{label}</strong>
      <span>{online ? `${health.responseTime} ms` : "offline"}</span>
    </div>
  );
}

export default Health;
