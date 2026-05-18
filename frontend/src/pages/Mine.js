import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";

import ErrorMessage from "../components/ErrorMessage";
import RiskNotice from "../components/RiskNotice";
import Spinner from "../components/Spinner";
import { useNotifications } from "../context/NotificationContext";
import api from "../helpers/api";
import { apiErrorMessage } from "../helpers/errors";

function Mine() {
  const { addNotification } = useNotifications();
  const [minerAddress, setMinerAddress] = useState("");
  const [mining, setMining] = useState(false);
  const [status, setStatus] = useState(null);
  const [history, setHistory] = useState([]);
  const [statusLoading, setStatusLoading] = useState(true);
  const [minedBlock, setMinedBlock] = useState(null);
  const [sessionMinedBlocks, setSessionMinedBlocks] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");
  const [cooldownSeconds, setCooldownSeconds] = useState(0);

  async function loadMiningData() {
    try {
      const [statusResponse, historyResponse] = await Promise.all([
        api.get("/mining/status"),
        api.get("/mining/history", { params: { limit: 5, offset: 0 } }),
      ]);
      setStatus(statusResponse.data.status || null);
      setHistory(historyResponse.data.history || []);
      const nextWait = Number(statusResponse.data.status?.seconds_until_next_allowed_block);
      if (Number.isFinite(nextWait) && nextWait > 0) {
        setCooldownSeconds(Math.ceil(nextWait));
      }
    } catch (error) {
      setErrorMessage(apiErrorMessage(error, "Unable to load mining status."));
    } finally {
      setStatusLoading(false);
    }
  }

  useEffect(() => {
    loadMiningData();
  }, []);

  useEffect(() => {
    if (cooldownSeconds <= 0) {
      return undefined;
    }

    const interval = window.setInterval(() => {
      setCooldownSeconds((seconds) => Math.max(seconds - 1, 0));
      setStatus((current) => {
        if (!current || !current.seconds_until_next_allowed_block) {
          return current;
        }
        const nextWait = Math.max(Number(current.seconds_until_next_allowed_block) - 1, 0);
        return {
          ...current,
          seconds_until_next_allowed_block: nextWait,
          can_mine_now: nextWait === 0 && current.chain_valid,
          reason_if_not: nextWait === 0 ? null : current.reason_if_not,
        };
      });
    }, 1000);

    return () => window.clearInterval(interval);
  }, [cooldownSeconds]);

  async function mineBlock(event) {
    event.preventDefault();

    if (!minerAddress.trim()) {
      toast.error("Enter your miner wallet address.");
      return;
    }

    setMining(true);
    setMinedBlock(null);
    try {
      const response = await api.post("/mine", {
        miner_address: minerAddress.trim(),
      });
      setMinedBlock(response.data.block);
      await loadMiningData();
      setSessionMinedBlocks((current) => current + 1);
      setErrorMessage("");
      addNotification(
        "info",
        "Block Mined",
        `Block #${response.data.block.index} mined with hash ${response.data.block.hash}.`
      );
      toast.success("Block mined successfully.");
    } catch (error) {
      const message = apiErrorMessage(error, "Unable to mine block.");
      setErrorMessage(message);
      if (error.response?.status === 429) {
        const waitSeconds = Number(error.response.data?.wait_seconds);
        setCooldownSeconds(Number.isFinite(waitSeconds) && waitSeconds > 0 ? Math.ceil(waitSeconds) : 30);
      }
      loadMiningData();
      toast.error(message);
    } finally {
      setMining(false);
    }
  }

  const effectiveCooldown = Math.max(
    cooldownSeconds,
    Number(status?.seconds_until_next_allowed_block || 0)
  );
  const canMineNow = status?.can_mine_now && effectiveCooldown <= 0;

  return (
    <div className="page">
      <section className="hero">
        <span className="eyebrow">Proof of Work</span>
        <h1>Mine a new VLQ block</h1>
        <p className="subtitle">
          Mining collects pending transactions into a proof-of-work block. The miner reward is
          split with the public treasury and queued as a real pending transaction for a later block.
        </p>
      </section>

      <ErrorMessage message={errorMessage} />
      <RiskNotice />

      <section className="card card-pad glass-section stack" aria-labelledby="mining-status-title">
        <div className="section-title">
          <div>
            <span className="section-eyebrow">Mining Operations</span>
            <h2 id="mining-status-title">Mining Status</h2>
          </div>
          <span className={`status-badge ${canMineNow ? "success" : "pending"}`}>
            {canMineNow ? "Can mine now" : "Waiting"}
          </span>
        </div>
        {statusLoading ? (
          <Spinner label="Loading mining status..." />
        ) : status ? (
          <div className="grid stats-grid">
            <div className="stat-card">
              <span>Current height</span>
              <strong>{status.current_block_height}</strong>
            </div>
            <div className="stat-card">
              <span>Difficulty</span>
              <strong>{status.current_difficulty}</strong>
            </div>
            <div className="stat-card">
              <span>Next allowed block</span>
              <strong>{effectiveCooldown > 0 ? `${effectiveCooldown}s` : "Now"}</strong>
            </div>
            <div className="stat-card">
              <span>Miner receives</span>
              <strong>{status.miner_reward_after_treasury} VLQ</strong>
            </div>
            <div className="stat-card">
              <span>Treasury receives</span>
              <strong>{status.treasury_reward_per_block} VLQ</strong>
            </div>
            <div className="stat-card">
              <span>Pending transactions</span>
              <strong>{status.pending_transaction_count}</strong>
            </div>
          </div>
        ) : (
          <div className="empty-state">Mining status is unavailable right now.</div>
        )}
        {status?.reason_if_not && <div className="value-box warning">{status.reason_if_not}</div>}
        {status?.last_block_hash && (
          <p className="help-text">
            Last block: <Link to={`/block/${status.last_block_hash}`}>{status.last_block_hash.slice(0, 18)}...</Link>
          </p>
        )}
      </section>

      <div className="grid two-column">
        <section className="card card-pad">
          <form className="form" onSubmit={mineBlock}>
            <div className="field">
              <label htmlFor="miner-address">Miner Address</label>
              <input
                id="miner-address"
                className="input"
                type="text"
                value={minerAddress}
                onChange={(event) => setMinerAddress(event.target.value)}
                autoComplete="off"
              />
            </div>
            {effectiveCooldown > 0 ? (
              <div className="value-box warning">
                Cooling down. Ready to mine in {effectiveCooldown} seconds.
              </div>
            ) : (
              <div className="value-box green">Ready to mine.</div>
            )}
            <button className="button" type="submit" disabled={mining || effectiveCooldown > 0}>
              {mining
                ? "Mining Block..."
                : effectiveCooldown > 0
                  ? `Cooling Down (${effectiveCooldown}s)`
                  : "Mine Block"}
            </button>
            <div className="value-box">Blocks mined this session: {sessionMinedBlocks}</div>
          </form>
        </section>

        <section className="card card-pad stack">
          <h2>Mining Result</h2>
          {mining && <Spinner label="Proof of work is running. This can take a few seconds." />}

          {!mining && minedBlock ? (
            <div className="stack">
              <div className="field">
                <label>New Block Index</label>
                <div className="value-box">{minedBlock.index}</div>
              </div>
              <div className="field">
                <label>Block Hash</label>
                <div className="value-box">{minedBlock.hash}</div>
              </div>
              <div className="field">
                <label>Included Transactions</label>
                <div className="value-box">{minedBlock.transaction_count ?? minedBlock.transactions?.length ?? 0}</div>
              </div>
              <div className="grid two-column">
                <div className="value-box green">Miner reward: {status?.miner_reward_after_treasury ?? "pending"} VLQ</div>
                <div className="value-box">Treasury contribution: {status?.treasury_reward_per_block ?? "pending"} VLQ</div>
              </div>
              <Link className="button secondary small-button" to={`/block/${minedBlock.hash || minedBlock.index}`}>
                View Block
              </Link>
              <p className="green">Your miner reward is queued as a pending transaction for the next block.</p>
              <p>
                The reward appears in confirmed balance after the next block includes that
                pending reward transaction.
              </p>
            </div>
          ) : (
            !mining && <div className="empty-state">Mine a block to see the result here.</div>
          )}
        </section>
      </div>

      <section className="card card-pad glass-section stack" aria-labelledby="mining-history-title">
        <div className="section-title">
          <div>
            <span className="section-eyebrow">Recent Blocks</span>
            <h2 id="mining-history-title">Mining History</h2>
          </div>
        </div>
        {history.length > 0 ? (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Block</th>
                  <th>Miner</th>
                  <th>Transactions</th>
                  <th>Difficulty</th>
                  <th>Reward split</th>
                  <th>Timing</th>
                </tr>
              </thead>
              <tbody>
                {history.map((block) => (
                  <tr key={block.block_hash}>
                    <td>
                      <Link to={`/block/${block.block_hash}`}>#{block.block_index}</Link>
                    </td>
                    <td>{block.miner_address || "Unknown"}</td>
                    <td>{block.transaction_count}</td>
                    <td>{block.difficulty}</td>
                    <td>
                      {block.miner_reward_amount} / {block.treasury_reward_amount} VLQ
                    </td>
                    <td>{block.seconds_since_previous_block ?? "Genesis"}s</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">No mined block history is available yet.</div>
        )}
      </section>
    </div>
  );
}

export default Mine;
