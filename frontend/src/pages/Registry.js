import { useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";

import AddressIdentity from "../components/AddressIdentity";
import ErrorMessage from "../components/ErrorMessage";
import Spinner from "../components/Spinner";
import api from "../helpers/api";
import { apiErrorMessage } from "../helpers/errors";

const tabs = ["Active Nodes", "All Nodes", "Register Node", "Node Details"];

function timeAgo(timestamp) {
  if (!timestamp) return "unknown";
  const seconds = Math.max(Math.floor(Date.now() / 1000 - Number(timestamp)), 0);
  if (seconds < 60) return `${seconds} seconds ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

function statusLabel(status) {
  return String(status || "unknown").replaceAll("_", " ");
}

function statusClass(status) {
  if (status === "synced") return "confirmed";
  if (status === "behind" || status === "unknown") return "pending";
  return status || "unknown";
}

function NodeCard({ node, onAdd, onInspect }) {
  return (
    <article className="card card-pad registry-card stack">
      <div className="section-title">
        <div>
          <h3>{node.display_name || "Vorliq Node"}</h3>
          <p className="meta-value">{node.node_url}</p>
        </div>
        <span className={`status-badge ${statusClass(node.sync_status)}`}>
          {statusLabel(node.sync_status)}
        </span>
      </div>

      <div className="stats-grid compact-stats">
        <div className="stat-card">
          <span>Reliability</span>
          <strong>{node.reliability_score ?? 0}%</strong>
        </div>
        <div className="stat-card">
          <span>Uptime</span>
          <strong>{node.uptime_score ?? 0}%</strong>
        </div>
        <div className="stat-card">
          <span>Height</span>
          <strong>{node.last_chain_height ?? "unknown"}</strong>
        </div>
        <div className="stat-card">
          <span>Last seen</span>
          <strong>{timeAgo(node.last_seen)}</strong>
        </div>
      </div>

      <div className="meta-grid">
        <div>
          <span className="meta-label">Region</span>
          <span className="meta-value">{[node.region, node.country].filter(Boolean).join(", ") || "Not provided"}</span>
        </div>
        <div>
          <span className="meta-label">Software</span>
          <span className="meta-value">{node.software_version || "Unknown"}</span>
        </div>
      </div>

      {node.operator_wallet_address && (
        <div>
          <span className="meta-label">Operator</span>
          <AddressIdentity address={node.operator_wallet_address} />
        </div>
      )}

      <div className="button-row">
        <button className="button small-button" type="button" onClick={() => onAdd(node.node_url)}>
          Add to My Network
        </button>
        <button className="button secondary small-button" type="button" onClick={() => onInspect(node.node_url)}>
          Details
        </button>
      </div>
    </article>
  );
}

function Registry() {
  const [activeTab, setActiveTab] = useState("Active Nodes");
  const [nodes, setNodes] = useState([]);
  const [allNodes, setAllNodes] = useState([]);
  const [summary, setSummary] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [detailUrl, setDetailUrl] = useState("");
  const [filters, setFilters] = useState({ status: "", country: "", sync_status: "" });
  const [form, setForm] = useState({
    node_url: "",
    display_name: "Vorliq Community Node",
    description: "",
    region: "",
    country: "",
    operator_wallet_address: "",
  });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function loadRegistry({ quiet = false } = {}) {
    try {
      const [activeResponse, allResponse, summaryResponse] = await Promise.all([
        api.get("/registry/nodes"),
        api.get("/registry/all"),
        api.get("/registry/summary"),
      ]);
      setNodes(activeResponse.data.nodes || []);
      setAllNodes(allResponse.data.nodes || []);
      setSummary(summaryResponse.data.summary || null);
      setErrorMessage("");
    } catch (error) {
      if (!quiet) {
        const message = apiErrorMessage(error, "Unable to load registry nodes.");
        setErrorMessage(message);
        toast.error(message);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRegistry();
    const interval = window.setInterval(() => loadRegistry({ quiet: true }), 30000);
    return () => window.clearInterval(interval);
  }, []);

  async function registerNode(event) {
    event.preventDefault();
    setSubmitting(true);
    try {
      const response = await api.post("/registry/register", form);
      setSelectedNode(response.data.node || null);
      setDetailUrl(response.data.node?.node_url || form.node_url);
      setActiveTab("Node Details");
      await loadRegistry({ quiet: true });
      setErrorMessage("");
      toast.success("Node registered in the public registry.");
    } catch (error) {
      const message = apiErrorMessage(error, "Unable to register node.");
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  async function addToNetwork(url) {
    try {
      await api.post("/peers/add", { peer: url });
      setErrorMessage("");
      toast.success("Node added to your peer network.");
    } catch (error) {
      const message = apiErrorMessage(error, "Unable to add node to your network.");
      setErrorMessage(message);
      toast.error(message);
    }
  }

  async function loadNodeDetails(url = detailUrl) {
    if (!url.trim()) {
      toast.error("Enter a node URL first.");
      return;
    }
    setDetailLoading(true);
    try {
      const response = await api.get("/registry/node", { params: { node_url: url.trim() } });
      setSelectedNode(response.data.node || null);
      setDetailUrl(url.trim());
      setActiveTab("Node Details");
      setErrorMessage("");
    } catch (error) {
      const message = apiErrorMessage(error, "Node details are not available for that URL.");
      setSelectedNode(null);
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setDetailLoading(false);
    }
  }

  const filteredNodes = useMemo(() => {
    return allNodes.filter((node) => {
      if (filters.status === "active" && !node.active) return false;
      if (filters.status === "inactive" && node.active) return false;
      if (filters.sync_status && node.sync_status !== filters.sync_status) return false;
      if (filters.country && String(node.country || "").toLowerCase() !== filters.country.toLowerCase()) return false;
      return true;
    });
  }, [allNodes, filters]);

  return (
    <div className="page">
      <section className="hero">
        <span className="eyebrow">Public Node Registry</span>
        <h1>Registry</h1>
        <p className="subtitle">
          View public Vorliq nodes, health history, sync status, and operator signals before adding a peer to your network.
        </p>
      </section>

      <ErrorMessage message={errorMessage} />

      {summary && (
        <section className="stats-grid compact-stats">
          <div className="stat-card">
            <span>Active nodes</span>
            <strong>{summary.active_node_count}</strong>
          </div>
          <div className="stat-card">
            <span>Synced nodes</span>
            <strong>{summary.synced_node_count}</strong>
          </div>
          <div className="stat-card">
            <span>Highest height</span>
            <strong>{summary.highest_chain_height}</strong>
          </div>
          <div className="stat-card">
            <span>Avg reliability</span>
            <strong>{summary.average_reliability_score}%</strong>
          </div>
        </section>
      )}

      <div className="tabs" role="tablist" aria-label="Registry sections">
        {tabs.map((tab) => (
          <button
            className={`tab-button ${activeTab === tab ? "active" : ""}`}
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === "Active Nodes" && (
        <section className="registry-section">
          <div className="section-title">
            <h2>Active Nodes</h2>
            <span className="eyebrow">{nodes.length} seen in 30 minutes</span>
          </div>
          {loading && <Spinner label="Loading active nodes..." />}
          {!loading && nodes.length === 0 && <div className="empty-state">No active public nodes are registered right now.</div>}
          <div className="registry-grid">
            {nodes.map((node) => (
              <NodeCard key={node.node_url} node={node} onAdd={addToNetwork} onInspect={loadNodeDetails} />
            ))}
          </div>
        </section>
      )}

      {activeTab === "All Nodes" && (
        <section className="registry-section stack">
          <div className="section-title">
            <h2>All Nodes</h2>
            <span className="eyebrow">{filteredNodes.length} shown</span>
          </div>
          <div className="grid three-column">
            <div className="field">
              <label htmlFor="node-activity-filter">Status</label>
              <select
                id="node-activity-filter"
                className="input"
                value={filters.status}
                onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}
              >
                <option value="">All</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="node-sync-filter">Sync status</label>
              <select
                id="node-sync-filter"
                className="input"
                value={filters.sync_status}
                onChange={(event) => setFilters((current) => ({ ...current, sync_status: event.target.value }))}
              >
                <option value="">All</option>
                <option value="synced">Synced</option>
                <option value="behind">Behind</option>
                <option value="invalid">Invalid</option>
                <option value="unknown">Unknown</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="node-country-filter">Country</label>
              <input
                id="node-country-filter"
                className="input"
                value={filters.country}
                onChange={(event) => setFilters((current) => ({ ...current, country: event.target.value }))}
                placeholder="Country"
              />
            </div>
          </div>
          <div className="registry-grid">
            {filteredNodes.map((node) => (
              <NodeCard key={node.node_url} node={node} onAdd={addToNetwork} onInspect={loadNodeDetails} />
            ))}
          </div>
        </section>
      )}

      {activeTab === "Register Node" && (
        <section className="card card-pad stack">
          <div className="section-title">
            <h2>Register Node</h2>
            <span className="eyebrow">Public metadata only</span>
          </div>
          <form className="form" onSubmit={registerNode}>
            <div className="grid two-column">
              <div className="field">
                <label htmlFor="node-url">Node URL</label>
                <input
                  id="node-url"
                  className="input"
                  type="url"
                  value={form.node_url}
                  onChange={(event) => setForm((current) => ({ ...current, node_url: event.target.value }))}
                  placeholder="https://node.example.org"
                />
              </div>
              <div className="field">
                <label htmlFor="display-name">Display Name</label>
                <input
                  id="display-name"
                  className="input"
                  value={form.display_name}
                  onChange={(event) => setForm((current) => ({ ...current, display_name: event.target.value }))}
                  placeholder="Community node name"
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="node-description">Description</label>
              <textarea
                id="node-description"
                className="input"
                value={form.description}
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                placeholder="Short public description"
                rows={3}
              />
            </div>
            <div className="grid three-column">
              <div className="field">
                <label htmlFor="node-region">Region</label>
                <input
                  id="node-region"
                  className="input"
                  value={form.region}
                  onChange={(event) => setForm((current) => ({ ...current, region: event.target.value }))}
                  placeholder="Europe"
                />
              </div>
              <div className="field">
                <label htmlFor="node-country">Country</label>
                <input
                  id="node-country"
                  className="input"
                  value={form.country}
                  onChange={(event) => setForm((current) => ({ ...current, country: event.target.value }))}
                  placeholder="United Kingdom"
                />
              </div>
              <div className="field">
                <label htmlFor="operator-wallet">Operator Wallet</label>
                <input
                  id="operator-wallet"
                  className="input"
                  value={form.operator_wallet_address}
                  onChange={(event) => setForm((current) => ({ ...current, operator_wallet_address: event.target.value }))}
                  placeholder="Optional wallet address"
                />
              </div>
            </div>
            <button className="button" type="submit" disabled={submitting}>
              {submitting ? "Registering..." : "Register Node"}
            </button>
          </form>
        </section>
      )}

      {activeTab === "Node Details" && (
        <section className="card card-pad stack">
          <div className="section-title">
            <h2>Node Details</h2>
            <span className="eyebrow">Health history and trust signals</span>
          </div>
          <form
            className="inline-form"
            onSubmit={(event) => {
              event.preventDefault();
              loadNodeDetails();
            }}
          >
            <div className="field">
              <label htmlFor="detail-node-url">Node URL</label>
              <input
                id="detail-node-url"
                className="input"
                type="url"
                value={detailUrl}
                onChange={(event) => setDetailUrl(event.target.value)}
                placeholder="https://node.example.org"
              />
            </div>
            <button className="button" type="submit" disabled={detailLoading}>
              {detailLoading ? "Loading..." : "Search"}
            </button>
          </form>

          {selectedNode ? (
            <div className="stack">
              <NodeCard node={selectedNode} onAdd={addToNetwork} onInspect={loadNodeDetails} />
              <div className="meta-grid">
                <div>
                  <span className="meta-label">Last block hash</span>
                  <span className="meta-value hash-text">{selectedNode.last_block_hash || "Unknown"}</span>
                </div>
                <div>
                  <span className="meta-label">Diagnostics</span>
                  <span className="meta-value">{selectedNode.last_diagnostics_status || "Unknown"}</span>
                </div>
              </div>
              <div>
                <h3>Health History</h3>
                {selectedNode.status_history?.length ? (
                  <div className="history-list">
                    {selectedNode.status_history.slice().reverse().map((entry, index) => (
                      <div className="history-item" key={`${entry.timestamp}-${index}`}>
                        <span className={`status-badge ${statusClass(entry.status)}`}>{statusLabel(entry.status)}</span>
                        <span>{timeAgo(entry.timestamp)}</span>
                        <span>Height {entry.chain_height ?? "unknown"}</span>
                        <span>{entry.response_time_ms ? `${entry.response_time_ms} ms` : "no latency"}</span>
                        <span>{entry.message}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">No health history has been recorded for this node yet.</div>
                )}
              </div>
            </div>
          ) : (
            <div className="empty-state">Search for a registered node URL to inspect its trust and health history.</div>
          )}
        </section>
      )}
    </div>
  );
}

export default Registry;
