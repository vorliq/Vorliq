import { useEffect, useState } from "react";
import { toast } from "react-toastify";

import ErrorMessage from "../components/ErrorMessage";
import Spinner from "../components/Spinner";
import api from "../helpers/api";
import { apiErrorMessage } from "../helpers/errors";

function Network() {
  const [peerUrl, setPeerUrl] = useState("");
  const [peers, setPeers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [peerStatuses, setPeerStatuses] = useState({});
  const [recommendedNodes, setRecommendedNodes] = useState([]);
  const [errorMessage, setErrorMessage] = useState("");

  async function loadPeers({ quiet = false } = {}) {
    try {
      const [peersResponse, registryResponse] = await Promise.all([
        api.get("/peers"),
        api.get("/registry/nodes"),
      ]);
      setPeers(peersResponse.data.peers || []);
      setRecommendedNodes(registryResponse.data.nodes || []);
      setErrorMessage("");
    } catch (error) {
      if (!quiet) {
        const message = apiErrorMessage(error, "Unable to load peers.");
        setErrorMessage(message);
        toast.error(message);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPeers();
    const timer = window.setInterval(() => {
      loadPeers({ quiet: true });
    }, 10000);

    return () => window.clearInterval(timer);
  }, []);

  async function addPeer(event) {
    event.preventDefault();

    if (!peerUrl.trim()) {
      toast.error("Enter a peer URL first.");
      return;
    }

    setAdding(true);
    try {
      const response = await api.post("/peers/add", {
        peer: peerUrl.trim(),
      });
      setPeers(response.data.peers || []);
      setPeerUrl("");
      setErrorMessage("");
      toast.success("Peer added to your Vorliq node.");
    } catch (error) {
      const message = apiErrorMessage(error, "Unable to add peer.");
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setAdding(false);
    }
  }

  async function addPeerUrl(url) {
    try {
      const response = await api.post("/peers/add", { peer: url });
      setPeers(response.data.peers || []);
      setErrorMessage("");
      toast.success("Node added to your Vorliq node.");
    } catch (error) {
      const message = apiErrorMessage(error, "Unable to add peer.");
      setErrorMessage(message);
      toast.error(message);
    }
  }

  async function syncChain() {
    setSyncing(true);
    try {
      const response = await api.post("/peers/sync");
      setPeerStatuses(response.data.peer_statuses || {});
      if (response.data.updated) {
        toast.success("Chain updated to a longer network chain.");
      } else {
        toast.info("Your chain is already the longest.");
      }
      setErrorMessage("");
    } catch (error) {
      const message = apiErrorMessage(error, "Unable to sync chain.");
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="page">
      <section className="hero">
        <span className="eyebrow">Peer Network</span>
        <h1>Network</h1>
        <p className="subtitle">Connect your Vorliq node to other nodes in the community.</p>
      </section>

      <ErrorMessage message={errorMessage} />

      <div className="grid two-column">
        <section className="card card-pad stack">
          <h2>Add Peer</h2>
          <form className="form" onSubmit={addPeer}>
            <div className="field">
              <label htmlFor="peer-url">Peer URL</label>
              <input
                id="peer-url"
                className="input"
                type="url"
                placeholder="http://192.168.1.5:5001"
                value={peerUrl}
                onChange={(event) => setPeerUrl(event.target.value)}
              />
            </div>
            <button className="button" type="submit" disabled={adding}>
              {adding ? "Adding..." : "Add Peer"}
            </button>
          </form>
        </section>

        <section className="card card-pad stack">
          <h2>Sync Chain</h2>
          <p>
            Ask connected peers for their latest chain and adopt the longest valid chain if one
            exists.
          </p>
          <button className="button secondary" onClick={syncChain} disabled={syncing}>
            {syncing ? "Syncing..." : "Sync Chain Now"}
          </button>
        </section>
      </div>

      <section className="card card-pad peer-section">
        <div className="section-title">
          <h2>Node Operator Tools</h2>
          <span className="eyebrow">Verified onboarding</span>
        </div>
        <div className="button-row">
          <a className="button secondary small-button" href="/docs/run-your-own-node.html">
            Node Guide
          </a>
          <a className="button secondary small-button" href="/docs/bootstrap-verification.html">
            Bootstrap Verification
          </a>
          <a className="button secondary small-button" href="https://status.vorliq.org">
            Status Page
          </a>
          <a className="button secondary small-button" href="/readiness">
            Readiness Page
          </a>
          <a className="button secondary small-button" href="/bootstrap">
            Bootstrap Node
          </a>
        </div>
      </section>

      <section className="card card-pad peer-section">
        <div className="section-title">
          <h2>Known Peers</h2>
          <span className="eyebrow">Auto refreshes every 10 seconds</span>
        </div>

        {loading && <Spinner label="Loading peers..." />}

        {!loading && peers.length === 0 && (
          <div className="empty-state">No peers registered yet.</div>
        )}

        <div className="peer-list">
          {peers.map((peer) => (
            <div className="peer-item" key={peer}>
              <span className="peer-url">
                <span
                  className={`status-dot ${peerStatuses[peer] ? "online" : "unknown"}`}
                  aria-label={peerStatuses[peer] ? "peer reached" : "peer not reached"}
                />
                {peer}
              </span>
              <button
                className="button secondary small-button"
                type="button"
                onClick={() => toast.info("Peer removal coming in the next version.")}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="card card-pad peer-section">
        <div className="section-title">
          <h2>Recommended Active Nodes</h2>
          <span className="eyebrow">{recommendedNodes.length} from registry</span>
        </div>
        {!loading && recommendedNodes.length === 0 && (
          <div className="empty-state">No active registry nodes are available right now.</div>
        )}
        <div className="peer-list">
          {recommendedNodes.map((node) => (
            <div className="peer-item" key={node.node_url}>
              <span className="peer-url">
                <span
                  className={`status-dot ${node.sync_status === "synced" ? "online" : "unknown"}`}
                  aria-label={`${node.sync_status || "unknown"} node`}
                />
                <span>
                  <strong>{node.display_name}</strong>
                  <span className="meta-value">{node.node_url}</span>
                </span>
              </span>
              <span className="meta-label">
                Height {node.last_chain_height ?? "unknown"} - Reliability {node.reliability_score ?? 0}%
              </span>
              <button
                className="button secondary small-button"
                type="button"
                onClick={() => addPeerUrl(node.node_url)}
              >
                Add Node
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export default Network;
