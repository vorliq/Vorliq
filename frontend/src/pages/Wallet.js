import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";

import ErrorMessage from "../components/ErrorMessage";
import QRPayment from "../components/QRPayment";
import RiskNotice from "../components/RiskNotice";
import Spinner from "../components/Spinner";
import api from "../helpers/api";
import { apiErrorMessage } from "../helpers/errors";
import { createEncryptedWalletBackup } from "../helpers/storage";

function Wallet() {
  const [wallet, setWallet] = useState(null);
  const [creating, setCreating] = useState(false);
  const [balanceAddress, setBalanceAddress] = useState("");
  const [balance, setBalance] = useState(null);
  const [checking, setChecking] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [receiveAmount, setReceiveAmount] = useState("");
  const [safetyConfirmed, setSafetyConfirmed] = useState(false);
  const [backupPassword, setBackupPassword] = useState("");
  const [backupCreated, setBackupCreated] = useState(false);
  const [privateKeyRevealConfirmed, setPrivateKeyRevealConfirmed] = useState(false);
  const [privateKeyVisible, setPrivateKeyVisible] = useState(false);

  async function createWallet() {
    if (!safetyConfirmed) {
      toast.error("Confirm that you understand Vorliq cannot recover your private key.");
      return;
    }

    setCreating(true);
    try {
      const response = await api.post("/wallet/create");
      setWallet(response.data);
      setPrivateKeyRevealConfirmed(false);
      setPrivateKeyVisible(false);
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

  async function copyText(value, label) {
    try {
      await navigator.clipboard.writeText(String(value || ""));
      toast.success(`${label} copied.`);
    } catch {
      toast.error(`Unable to copy ${label.toLowerCase()}.`);
    }
  }

  async function downloadEncryptedBackup(event) {
    event.preventDefault();
    if (!wallet) return;
    if (!backupPassword) {
      toast.error("Enter a password to encrypt the backup.");
      return;
    }

    try {
      const backup = await createEncryptedWalletBackup(wallet, backupPassword);
      const blob = new Blob([JSON.stringify({ ...backup, exported_at: new Date().toISOString() }, null, 2)], {
        type: "application/json;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "vorliq-wallet-backup.json";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setBackupPassword("");
      setBackupCreated(true);
      toast.success("Encrypted wallet backup downloaded.");
    } catch (error) {
      toast.error("Unable to create encrypted backup.");
    }
  }

  return (
    <div className="page">
      <section className="hero">
        <span className="eyebrow">Wallets</span>
        <h1>Create and inspect VLQ wallets</h1>
        <p className="subtitle">
          Generate a new Vorliq wallet, then check the VLQ balance for any address on the chain.
        </p>
      </section>

      <ErrorMessage message={errorMessage} />
      <RiskNotice />

      <div className="grid two-column">
        <section className="card card-pad stack">
          <div className="section-title">
            <h2>New Wallet</h2>
            <button className="button" onClick={createWallet} disabled={creating || !safetyConfirmed}>
              {creating ? "Creating..." : "Create New Wallet"}
            </button>
          </div>

          <div className="wallet-safety-box">
            <strong>Before you create a wallet</strong>
            <p>
              Vorliq cannot recover your private key. Anyone with your private key can control
              this wallet and spend its VLQ. Save it somewhere safe before using the wallet.
            </p>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={safetyConfirmed}
                onChange={(event) => setSafetyConfirmed(event.target.checked)}
              />
              <span>I understand that my private key cannot be recovered by Vorliq.</span>
            </label>
          </div>

          {creating ? (
            <Spinner label="Creating wallet..." />
          ) : wallet ? (
            <div className="stack">
              <div className="wallet-safety-box">
                <strong>Backup now</strong>
                <p>
                  Copy the public address for receiving VLQ, then download an encrypted backup
                  before sending funds to this wallet. The raw private key below is shown only
                  for immediate backup; Vorliq cannot recover it later.
                </p>
              </div>
              <div className="field">
                <label>Wallet Address</label>
                <div className="value-box">{wallet.address}</div>
                <button className="button secondary small-button" type="button" onClick={() => copyText(wallet.address, "Public address")}>
                  Copy Public Address
                </button>
              </div>
              <form className="form wallet-action-panel" onSubmit={downloadEncryptedBackup}>
                <h3>Download Encrypted Backup</h3>
                <p className="help-text">
                  This backup encrypts the private key with a password you choose. Keep both the
                  file and password safe.
                </p>
                <div className="field">
                  <label htmlFor="new-wallet-backup-password">Backup Password</label>
                  <input
                    id="new-wallet-backup-password"
                    className="input"
                    type="password"
                    value={backupPassword}
                    onChange={(event) => setBackupPassword(event.target.value)}
                    autoComplete="new-password"
                  />
                </div>
                <button className="button" type="submit">
                  Download Encrypted Backup
                </button>
                {backupCreated && <p className="help-text">Backup downloaded in this browser session.</p>}
              </form>
              <div className="empty-state">
                Need starter VLQ? The faucet can send a small treasury-funded transaction when funds are available.{" "}
                <Link to={`/faucet?address=${wallet.address}`}>Open Faucet</Link>
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
                <div className="private-key-warning">
                  <strong>{privateKeyVisible ? "Private key visible" : "Private key hidden"}</strong>
                  <p>
                    Reveal the raw key only if you are on a trusted device and need it for backup. Prefer the encrypted backup file for normal wallet recovery.
                  </p>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={privateKeyRevealConfirmed}
                      onChange={(event) => setPrivateKeyRevealConfirmed(event.target.checked)}
                    />
                    <span>I am in a private place and understand anyone with this key can spend this wallet's VLQ.</span>
                  </label>
                  {privateKeyVisible ? (
                    <>
                      <div className="value-box">{wallet.private_key}</div>
                      <div className="button-row">
                        <button className="button secondary small-button" type="button" onClick={() => copyText(wallet.private_key, "Private key")}>
                          Copy Private Key
                        </button>
                        <button className="button secondary small-button" type="button" onClick={() => setPrivateKeyVisible(false)}>
                          Hide Private Key
                        </button>
                      </div>
                    </>
                  ) : (
                    <button
                      className="button secondary small-button"
                      type="button"
                      disabled={!privateKeyRevealConfirmed}
                      onClick={() => setPrivateKeyVisible(true)}
                    >
                      Reveal Private Key
                    </button>
                  )}
                </div>
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
    </div>
  );
}

export default Wallet;
