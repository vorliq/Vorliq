import { useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";

import { shortAddress } from "../components/AddressIdentity";
import ErrorMessage from "../components/ErrorMessage";
import Spinner from "../components/Spinner";
import api from "../helpers/api";
import { apiErrorMessage } from "../helpers/errors";
import { authorityErrorMessage, postSignedAuthority } from "../helpers/signedAuthority";

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

// Honest three-state operator labelling. The earned "Verified operator" badge is
// rendered ONLY when operator_verified is true (a signed claim AND a probe-
// confirmed match). A signed-but-unconfirmed claim, or a probe that found the
// node advertising a different wallet, must never read as verified.
function operatorLabel(node) {
  if (node.operator_verified === true) return "Operator";
  if (node.operator_probe_match === false) return "Operator (signed claim — probe mismatch, not verified)";
  if (node.is_verified_operator === true) return "Operator (signed claim — awaiting probe confirmation)";
  return "Operator (self-claimed, unverified)";
}

function statusClass(status) {
  if (status === "synced") return "confirmed";
  if (["behind", "unknown", "stale", "inactive"].includes(status)) return "pending";
  if (["archived", "retired"].includes(status)) return "unknown";
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
        <span className={`status-badge ${statusClass(node.lifecycle_status)}`}>
          {statusLabel(node.lifecycle_status || (node.active ? "active" : "inactive"))}
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
          <span className="meta-label">{operatorLabel(node)}</span>
          <span className="meta-value hash-text">{shortAddress(node.operator_wallet_address)}</span>
          {node.operator_verified === true && <span className="status-badge confirmed">Verified operator</span>}
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
  const [filters, setFilters] = useState({ lifecycle_status: "", country: "", sync_status: "" });
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
  const [operatorForm, setOperatorForm] = useState({ node_url: "", password: "", release: false });
  const [operatorSubmitting, setOperatorSubmitting] = useState(false);
  const [operatorError, setOperatorError] = useState("");

  async function submitOperatorClaim(event) {
    event.preventDefault();
    setOperatorError("");
    if (!operatorForm.node_url.trim()) {
      setOperatorError("Enter the node URL you operate.");
      return;
    }
    if (!operatorForm.password) {
      setOperatorError("Enter your wallet password to sign this claim locally.");
      return;
    }
    setOperatorSubmitting(true);
    try {
      // Mirrors Send/Vote: the wallet signs locally; the signer becomes the
      // operator_wallet_address actor. The node must also advertise this same
      // wallet in its diagnostics before the probe will confirm the badge.
      await postSignedAuthority({
        action: "registry.verify_operator",
        body: { node_url: operatorForm.node_url.trim(), release: operatorForm.release },
        walletPassword: operatorForm.password,
      });
      toast.success(
        operatorForm.release
          ? "Operator claim released."
          : "Operator claim signed. It becomes a verified badge once a probe confirms your node advertises this wallet."
      );
      setOperatorForm({ node_url: "", password: "", release: false });
      await loadRegistry({ quiet: true });
    } catch (error) {
      setOperatorError(authorityErrorMessage(error, "Unable to verify node operator."));
    } finally {
      setOperatorSubmitting(false);
    }
  }

  async function loadRegistry({ quiet = false } = {}) {
    try {
      const [activeResponse, allResponse, summaryResponse] = await Promise.all([
        api.get("/registry/nodes"),
        api.get("/registry/lifecycle", { params: { include_archived: true } }),
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
      const lifecycle = node.lifecycle_status || (node.active ? "active" : "inactive");
      if (!filters.lifecycle_status && ["archived", "retired"].includes(lifecycle)) return false;
      if (filters.lifecycle_status && lifecycle !== filters.lifecycle_status) return false;
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

      <div className="risk-box">
        <strong>These figures are self-reported by each node</strong>
        <p>
          Reliability, uptime, sync status, chain height, and the operator address are reported by each node
          itself and are not independently verified by Vorliq. Treat this list as unverified claims, not a trust
          ranking. Before pointing your wallet at any node in Settings, only use nodes you operate or fully
          trust — a node you connect to can show false balances and confirmations and can see your activity.
        </p>
      </div>

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

      <section className="card card-pad registry-section stack">
        <div className="section-title">
          <h2>Run Your Own Node</h2>
          <div className="button-row">
            <a className="button secondary small-button" href="/nodes/compare">
              Node Sync
            </a>
            <a className="button secondary small-button" href="/peers/propagation">
              Peer Propagation
            </a>
            <a className="button secondary small-button" href="/docs/run-your-own-node.html">
              Node Guide
            </a>
            <a className="button secondary small-button" href="/bootstrap">
              Bootstrap Node
            </a>
          </div>
        </div>
        <div className="stats-grid compact-stats">
          <div className="stat-card">
            <span>Verify first</span>
            <strong>Bootstrap</strong>
          </div>
          <div className="stat-card">
            <span>Install</span>
            <strong>Ubuntu</strong>
          </div>
          <div className="stat-card">
            <span>Register</span>
            <strong>Heartbeat</strong>
          </div>
          <div className="stat-card">
            <span>Check health</span>
            <strong>Doctor</strong>
          </div>
          <div className="stat-card">
            <span>Backups</span>
            <strong>Keep</strong>
          </div>
        </div>
      </section>

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
          <p className="help-text">
            Archived and retired nodes are preserved for transparency but hidden from default live network views.
          </p>
          <div className="grid three-column">
            <div className="field">
              <label htmlFor="node-lifecycle-filter">Lifecycle</label>
              <select
                id="node-lifecycle-filter"
                className="input"
                value={filters.lifecycle_status}
                onChange={(event) => setFilters((current) => ({ ...current, lifecycle_status: event.target.value }))}
              >
                <option value="">All visible</option>
                <option value="active">Active</option>
                <option value="stale">Stale</option>
                <option value="inactive">Inactive</option>
                <option value="archived">Archived</option>
                <option value="retired">Retired</option>
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

          <form className="stack" onSubmit={submitOperatorClaim}>
            <div className="section-title">
              <h3>Verify operator</h3>
              <span className="eyebrow">Signed claim from the wallet that runs the node</span>
            </div>
            <p className="meta-value">
              Prove a wallet you control operates a registered node. You sign this claim locally with your
              wallet password — the key never leaves your device. A signed claim is only recorded as a
              self-attestation; it earns the verified badge once the registry independently probes your node
              and confirms it advertises this same wallet (set <code>VORLIQ_OPERATOR_WALLET</code> on your
              node). Once verified, only this wallet can change or release the claim.
            </p>
            {operatorError && <ErrorMessage message={operatorError} />}
            <div className="field">
              <label htmlFor="operator-node-url">Node URL</label>
              <input
                id="operator-node-url"
                className="input"
                type="url"
                value={operatorForm.node_url}
                onChange={(event) => setOperatorForm((current) => ({ ...current, node_url: event.target.value }))}
                placeholder="https://node.example.org"
              />
            </div>
            <div className="field">
              <label htmlFor="operator-password">Wallet password</label>
              <input
                id="operator-password"
                className="input"
                type="password"
                autoComplete="off"
                value={operatorForm.password}
                onChange={(event) => setOperatorForm((current) => ({ ...current, password: event.target.value }))}
                placeholder="Unlocks your saved wallet to sign locally"
              />
            </div>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={operatorForm.release}
                onChange={(event) => setOperatorForm((current) => ({ ...current, release: event.target.checked }))}
              />
              <span>Release my existing claim instead (frees the node for a different wallet)</span>
            </label>
            <button className="button" type="submit" disabled={operatorSubmitting}>
              {operatorSubmitting ? "Signing..." : operatorForm.release ? "Release operator claim" : "Sign operator claim"}
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
