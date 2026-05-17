import { useEffect, useState } from "react";
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
  const [minedBlock, setMinedBlock] = useState(null);
  const [sessionMinedBlocks, setSessionMinedBlocks] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");
  const [cooldownSeconds, setCooldownSeconds] = useState(0);

  useEffect(() => {
    if (cooldownSeconds <= 0) {
      return undefined;
    }

    const interval = window.setInterval(() => {
      setCooldownSeconds((seconds) => Math.max(seconds - 1, 0));
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
      toast.error(message);
    } finally {
      setMining(false);
    }
  }

  return (
    <div className="page">
      <section className="hero">
        <span className="eyebrow">Proof of Work</span>
        <h1>Mine a new VLQ block</h1>
        <p className="subtitle">
          Mining collects all pending transactions into a new block and queues a 50 VLQ reward
          for the miner in the next block.
        </p>
      </section>

      <ErrorMessage message={errorMessage} />
      <RiskNotice />

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
            {cooldownSeconds > 0 ? (
              <div className="value-box warning">
                Cooling down. Ready to mine in {cooldownSeconds} seconds.
              </div>
            ) : (
              <div className="value-box green">Ready to mine.</div>
            )}
            <button className="button" type="submit" disabled={mining || cooldownSeconds > 0}>
              {mining
                ? "Mining Block..."
                : cooldownSeconds > 0
                  ? `Cooling Down (${cooldownSeconds}s)`
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
              <p className="green">You will receive 50 VLQ as a reward in the next block.</p>
              <p>
                The 50 VLQ reward will appear in your balance after the next block is mined
                because the reward is added as a pending transaction first.
              </p>
            </div>
          ) : (
            !mining && <div className="empty-state">Mine a block to see the result here.</div>
          )}
        </section>
      </div>
    </div>
  );
}

export default Mine;
