import { useEffect, useState } from "react";
import { toast } from "react-toastify";

import ErrorMessage from "../components/ErrorMessage";
import Spinner from "../components/Spinner";
import api from "../helpers/api";
import { apiErrorMessage } from "../helpers/errors";

function timeAgo(timestamp) {
  if (!timestamp) {
    return "unknown";
  }

  const seconds = Math.max(Math.floor(Date.now() / 1000 - Number(timestamp)), 0);
  if (seconds < 60) {
    return `${seconds} seconds ago`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  }

  const hours = Math.floor(minutes / 60);
  return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
}

function Registry() {
  const [nodeUrl, setNodeUrl] = useState("http://localhost:5001");
  const [displayName, setDisplayName] = useState("Local Vorliq Node");
  const [nodes, setNodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function loadNodes() {
    try {
      const response = await api.get("/registry/nodes");
      setNodes(response.data.nodes || []);
      setErrorMessage("");
    } catch (error) {
      const message = apiErrorMessage(error, "Unable to load active nodes.");
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadNodes();
    const interval = window.setInterval(loadNodes, 30000);
    return () => window.clearInterval(interval);
  }, []);

  async function registerNode(event) {
    event.preventDefault();
    setSubmitting(true);

    try {
      const response = await api.post("/registry/register", {
        node_url: nodeUrl,
        display_name: displayName,
      });
      setNodes(response.data.nodes || []);
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

  return (
    <main className="page">
      <section className="hero">
        <span className="eyebrow">Public Node Registry</span>
        <h1>Registry</h1>
        <p className="subtitle">
          Register your Vorliq node, find active community nodes, and connect your local network to other operators.
        </p>
      </section>

      <ErrorMessage message={errorMessage} />

      <section className="card card-pad">
        <div className="section-title">
          <h2>Register Your Node</h2>
        </div>
        <form className="form" onSubmit={registerNode}>
          <div className="field">
            <label htmlFor="node-url">Node URL</label>
            <input
              id="node-url"
              className="input"
              type="text"
              value={nodeUrl}
              onChange={(event) => setNodeUrl(event.target.value)}
              placeholder="http://your-ip-address:5001"
            />
          </div>
          <div className="field">
            <label htmlFor="display-name">Display Name</label>
            <input
              id="display-name"
              className="input"
              type="text"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Community node name"
            />
          </div>
          <button className="button" type="submit" disabled={submitting}>
            {submitting ? "Registering..." : "Register"}
          </button>
        </form>
      </section>

      <section className="registry-section">
        <div className="section-title">
          <h2>Active Nodes</h2>
          <span className="eyebrow">{nodes.length} online</span>
        </div>

        {loading && <Spinner label="Loading active nodes..." />}

        {!loading && nodes.length === 0 && (
          <div className="empty-state">No active public nodes are registered right now.</div>
        )}

        <div className="registry-grid">
          {nodes.map((node) => (
            <article className="card card-pad registry-card" key={node.node_url}>
              <div>
                <h3>{node.display_name}</h3>
                <p className="meta-value">{node.node_url}</p>
              </div>
              <span className="meta-label">Last seen {timeAgo(node.last_seen)}</span>
              <button
                className="button small-button"
                type="button"
                onClick={() => addToNetwork(node.node_url)}
              >
                Add to My Network
              </button>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

export default Registry;
