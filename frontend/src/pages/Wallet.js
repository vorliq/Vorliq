import { useState } from "react";
import { toast } from "react-toastify";

import ErrorMessage from "../components/ErrorMessage";
import QRPayment from "../components/QRPayment";
import Spinner from "../components/Spinner";
import api from "../helpers/api";
import { apiErrorMessage } from "../helpers/errors";

function Wallet() {
  const [wallet, setWallet] = useState(null);
  const [creating, setCreating] = useState(false);
  const [balanceAddress, setBalanceAddress] = useState("");
  const [balance, setBalance] = useState(null);
  const [checking, setChecking] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [receiveAmount, setReceiveAmount] = useState("");

  async function createWallet() {
    setCreating(true);
    try {
      const response = await api.post("/wallet/create");
      setWallet(response.data);
      setErrorMessage("");
      toast.success("New VLQ wallet created.");
    } catch (error) {
      const message = apiErrorMessage(error, "Unable to create wallet.");
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setCreating(false);
    }
  }

  async function checkBalance(event) {
    event.preventDefault();
    if (!balanceAddress.trim()) {
      toast.error("Enter a wallet address first.");
      return;
    }

    setChecking(true);
    try {
      const response = await api.get("/wallet/balance", {
        params: { address: balanceAddress.trim() },
      });
      setBalance(response.data);
      setErrorMessage("");
      toast.success("Balance loaded.");
    } catch (error) {
      const message = apiErrorMessage(error, "Unable to check balance.");
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setChecking(false);
    }
  }

  return (
    <main className="page">
      <section className="hero">
        <span className="eyebrow">Wallets</span>
        <h1>Create and inspect VLQ wallets</h1>
        <p className="subtitle">
          Generate a new Vorliq wallet, then check the VLQ balance for any address on the chain.
        </p>
      </section>

      <ErrorMessage message={errorMessage} />

      <div className="grid two-column">
        <section className="card card-pad stack">
          <div className="section-title">
            <h2>New Wallet</h2>
            <button className="button" onClick={createWallet} disabled={creating}>
              {creating ? "Creating..." : "Create New Wallet"}
            </button>
          </div>

          {creating ? (
            <Spinner label="Creating wallet..." />
          ) : wallet ? (
            <div className="stack">
              <div className="field">
                <label>Wallet Address</label>
                <div className="value-box">{wallet.address}</div>
              </div>
              <section className="receive-panel">
                <h2>Receive VLQ</h2>
                <div className="field">
                  <label htmlFor="receive-amount">Optional Requested Amount</label>
                  <input
                    id="receive-amount"
                    className="input"
                    type="number"
                    min="0"
                    step="0.000001"
                    value={receiveAmount}
                    onChange={(event) => setReceiveAmount(event.target.value)}
                    placeholder="Leave blank for any amount"
                  />
                </div>
                <QRPayment walletAddress={wallet.address} amount={receiveAmount} />
              </section>
              <div className="field">
                <label>Public Key</label>
                <div className="value-box">{wallet.public_key}</div>
              </div>
              <div className="field">
                <label>Private Key</label>
                <div className="value-box">{wallet.private_key}</div>
                <p className="warning">save your private key now it cannot be recovered</p>
              </div>
            </div>
          ) : (
            <div className="empty-state">Create a wallet to display its address and keys.</div>
          )}
        </section>

        <section className="card card-pad stack">
          <h2>Check Balance</h2>
          <form className="form" onSubmit={checkBalance}>
            <div className="field">
              <label htmlFor="balance-address">Wallet Address</label>
              <input
                id="balance-address"
                className="input"
                value={balanceAddress}
                onChange={(event) => setBalanceAddress(event.target.value)}
                type="text"
                autoComplete="off"
              />
            </div>
            <button className="button secondary" type="submit" disabled={checking}>
              {checking ? "Checking..." : "Check VLQ Balance"}
            </button>
          </form>

          {checking && <Spinner label="Checking balance..." />}

          {!checking && balance && (
            <div className="value-box">
              {balance.address}
              {"\n"}
              Balance: {balance.balance} {balance.coin}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

export default Wallet;
