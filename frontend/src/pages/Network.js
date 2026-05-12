import { useEffect, useState } from "react";
import { toast } from "react-toastify";

import api from "../helpers/api";

function Network() {
  const [peerUrl, setPeerUrl] = useState("");
  const [peers, setPeers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [syncing, setSyncing] = useState(false);

  async function loadPeers({ quiet = false } = {}) {
    try {
      const response = await api.get("/peers");
      setPeers(response.data.peers || []);
    } catch (error) {
      if (!quiet) {
        toast.error(error.response?.data?.error || "Unable to load peers.");
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
      toast.success("Peer added to your Vorliq node.");
    } catch (error) {
      toast.error(error.response?.data?.error || "Unable to add peer.");
    } finally {
      setAdding(false);
    }
  }

  async function syncChain() {
    setSyncing(true);
    try {
      const response = await api.post("/peers/sync");
      if (response.data.updated) {
        toast.success("Chain updated to a longer network chain.");
      } else {
        toast.info("Your chain is already the longest.");
      }
    } catch (error) {
      toast.error(error.response?.data?.error || "Unable to sync chain.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <main className="page">
      <section className="hero">
        <span className="eyebrow">Peer Network</span>
        <h1>Network</h1>
        <p className="subtitle">Connect your Vorliq node to other nodes in the community.</p>
      </section>

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
          <h2>Known Peers</h2>
          <span className="eyebrow">Auto refreshes every 10 seconds</span>
        </div>

        {loading && <div className="empty-state">Loading peers...</div>}

        {!loading && peers.length === 0 && (
          <div className="empty-state">No peers registered yet.</div>
        )}

        <div className="peer-list">
          {peers.map((peer) => (
            <div className="peer-item" key={peer}>
              <span>{peer}</span>
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
    </main>
  );
}

export default Network;
