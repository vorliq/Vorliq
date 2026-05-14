import { useState } from "react";
import { toast } from "react-toastify";

import api from "../helpers/api";

function Mine() {
  const [minerAddress, setMinerAddress] = useState("");
  const [mining, setMining] = useState(false);
  const [minedBlock, setMinedBlock] = useState(null);
  const [sessionMinedBlocks, setSessionMinedBlocks] = useState(0);

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
      toast.success("Block mined successfully.");
    } catch (error) {
      toast.error(error.response?.data?.error || "Unable to mine block.");
    } finally {
      setMining(false);
    }
  }

  return (
    <main className="page">
      <section className="hero">
        <span className="eyebrow">Proof of Work</span>
        <h1>Mine a new VLQ block</h1>
        <p className="subtitle">
          Mining collects all pending transactions into a new block and queues a 50 VLQ reward
          for the miner in the next block.
        </p>
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
            <button className="button" type="submit" disabled={mining}>
              {mining ? "Mining Block..." : "Mine Block"}
            </button>
            <div className="value-box">Blocks mined this session: {sessionMinedBlocks}</div>
          </form>
        </section>

        <section className="card card-pad stack">
          <h2>Mining Result</h2>
          {mining && <div className="empty-state">Proof of work is running. This can take a few seconds.</div>}

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
            </div>
          ) : (
            !mining && <div className="empty-state">Mine a block to see the result here.</div>
          )}
        </section>
      </div>
    </main>
  );
}

export default Mine;
