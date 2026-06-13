import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";

import ErrorMessage from "../components/ErrorMessage";
import RevealSection from "../components/RevealSection";
import { useAuth } from "../context/AuthContext";
import { apiErrorMessage } from "../helpers/errors";
import { hasWallet, importEncryptedWalletBackup } from "../helpers/storage";

function Login() {
  const navigate = useNavigate();
  const { clearLocalWallet, createAndSaveWallet, isLoggedIn, login } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [safetyConfirmed, setSafetyConfirmed] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importPassword, setImportPassword] = useState("");
  const [importing, setImporting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [walletExists, setWalletExists] = useState(() => hasWallet());
  const [clearWalletConfirmed, setClearWalletConfirmed] = useState(false);

  async function createWallet(event) {
    event.preventDefault();

    if (!password) {
      toast.error("Choose a password for your wallet.");
      return;
    }

    if (password !== confirmPassword) {
      toast.error("Passwords do not match.");
      return;
    }

    if (!safetyConfirmed) {
      toast.error("Confirm that you understand Vorliq cannot recover your private key.");
      return;
    }

    setLoading(true);
    try {
      await createAndSaveWallet(password);
      setErrorMessage("");
      toast.success("Wallet created and saved securely.");
      navigate("/account");
    } catch (error) {
      const message = apiErrorMessage(error, "Unable to create wallet.");
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  async function importWallet(event) {
    event.preventDefault();

    if (!importFile) {
      toast.error("Choose a Vorliq wallet backup JSON file.");
      return;
    }

    if (!importPassword) {
      toast.error("Enter the wallet backup password.");
      return;
    }

    setImporting(true);
    try {
      const text = await importFile.text();
      const backup = JSON.parse(text);
      await importEncryptedWalletBackup(backup, importPassword);
      await login(importPassword);
      setWalletExists(true);
      setErrorMessage("");
      toast.success("Wallet backup imported and unlocked.");
      navigate("/account");
    } catch (error) {
      setErrorMessage("Wallet backup is invalid or the password is incorrect.");
      toast.error("Wallet backup is invalid or the password is incorrect.");
    } finally {
      setImporting(false);
    }
  }

  async function unlockWallet(event) {
    event.preventDefault();

    if (!password) {
      toast.error("Enter your wallet password.");
      return;
    }

    setLoading(true);
    try {
      await login(password);
      setErrorMessage("");
      toast.success("Wallet unlocked.");
      navigate("/account");
    } catch (error) {
      setErrorMessage("incorrect password");
      toast.error("incorrect password");
    } finally {
      setLoading(false);
    }
  }

  function clearSavedWallet() {
    if (!clearWalletConfirmed) {
      toast.error("Confirm that you want to remove the encrypted wallet backup from this browser.");
      return;
    }
    clearLocalWallet();
    setWalletExists(false);
    setPassword("");
    setConfirmPassword("");
    setImportFile(null);
    setImportPassword("");
    setClearWalletConfirmed(false);
    setErrorMessage("");
    toast.success("Encrypted wallet backup removed from this browser.");
  }

  if (isLoggedIn) {
    return <Navigate to="/account" replace />;
  }

  return (
    <div className="page auth-page">
      <section className="hero">
        <span className="eyebrow">Member Access</span>
        <h1>{walletExists ? "Unlock saved wallet" : "Create or restore your Vorliq wallet"}</h1>
        <p className="subtitle">
          Vorliq wallets are encrypted in this browser with your password. Unlocking or
          importing decrypts locally; Vorliq does not send your backup password or private key
          to the server.
        </p>
      </section>

      <ErrorMessage message={errorMessage} />

      <RevealSection className="auth-card stack">
        {walletExists ? (
          <>
            <section className="card card-pad stack wallet-entry-panel primary">
              <div>
                <span className="eyebrow">Saved in this browser</span>
                <h2>Unlock saved wallet</h2>
                <p className="help-text">
                  Use the password for the encrypted wallet already stored in this browser.
                  Decryption happens locally so you can reach Dashboard, Account, and Send
                  without uploading a backup file.
                </p>
              </div>
              <form className="form" onSubmit={unlockWallet}>
                <div className="field">
                  <label htmlFor="unlock-password">Wallet Password</label>
                  <input
                    id="unlock-password"
                    className="input"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="current-password"
                  />
                </div>
                <button className="button" type="submit" disabled={loading}>
                  {loading ? "Unlocking..." : "Unlock Saved Wallet"}
                </button>
              </form>
            </section>

            <section className="card card-pad stack wallet-entry-panel">
              <div>
                <span className="eyebrow">Restore</span>
                <h2>Import encrypted wallet backup</h2>
                <p className="help-text">
                  Use this when restoring your wallet on this browser or another device. Choose
                  your <strong>vorliq-wallet-backup.json</strong> file and enter the backup
                  password. Vorliq checks it locally and never asks for a raw private key paste.
                </p>
              </div>
              <ImportWalletForm
                importFile={importFile}
                importPassword={importPassword}
                importing={importing}
                onFileChange={setImportFile}
                onPasswordChange={setImportPassword}
                onSubmit={importWallet}
              />
            </section>

            <section className="card card-pad stack wallet-entry-panel">
              <div>
                <span className="eyebrow">Start over</span>
                <h2>Create new wallet or clear saved wallet</h2>
                <p className="help-text">
                  To create a different wallet in this browser, first remove the saved encrypted
                  backup below. Clearing local data does not change public blockchain records or
                  recover a lost backup.
                </p>
              </div>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={clearWalletConfirmed}
                  onChange={(event) => setClearWalletConfirmed(event.target.checked)}
                />
                <span>I understand this removes the encrypted wallet backup from this browser.</span>
              </label>
              <div className="button-row">
                <button className="button secondary" type="button" disabled={!clearWalletConfirmed} onClick={clearSavedWallet}>
                  Clear Saved Wallet
                </button>
              </div>
            </section>
          </>
        ) : (
          <>
            <section className="card card-pad stack wallet-entry-panel primary">
              <div>
                <span className="eyebrow">New wallet</span>
                <h2>Create your Vorliq wallet</h2>
                <p className="help-text">
                  Create a new VLQ wallet for this browser. You will choose a password that
                  encrypts the private key locally.
                </p>
              </div>
              <form className="form" onSubmit={createWallet}>
                <div className="wallet-safety-box">
                  <strong>Private keys are self-custody</strong>
                  <p>
                    Vorliq cannot recover your private key or password. Anyone with your private
                    key can control this wallet. Save your encrypted backup and keep your
                    password somewhere safe.
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
                <div className="field">
                  <label htmlFor="create-password">Password</label>
                  <input
                    id="create-password"
                    className="input"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="new-password"
                  />
                </div>
                <div className="field">
                  <label htmlFor="confirm-password">Confirm Password</label>
                  <input
                    id="confirm-password"
                    className="input"
                    type="password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    autoComplete="new-password"
                  />
                </div>
                <button className="button" type="submit" disabled={loading || !safetyConfirmed}>
                  {loading ? "Creating..." : "Create Wallet and Set Password"}
                </button>
              </form>
            </section>

            <section className="card card-pad stack wallet-entry-panel">
              <div>
                <span className="eyebrow">Restore</span>
                <h2>Import encrypted wallet backup</h2>
                <p className="help-text">
                  Already have a <strong>vorliq-wallet-backup.json</strong> file? Restore it on
                  this browser or another device with the backup password. The file and password
                  are used locally; Vorliq does not send them to the server.
                </p>
              </div>
              <ImportWalletForm
                importFile={importFile}
                importPassword={importPassword}
                importing={importing}
                onFileChange={setImportFile}
                onPasswordChange={setImportPassword}
                onSubmit={importWallet}
              />
            </section>
          </>
        )}
      </RevealSection>
    </div>
  );
}

function ImportWalletForm({ importFile, importPassword, importing, onFileChange, onPasswordChange, onSubmit }) {
  return (
    <form className="form wallet-import-panel" onSubmit={onSubmit}>
      <div className="field">
        <label htmlFor="wallet-import-file">Encrypted Wallet Backup JSON</label>
        <input
          id="wallet-import-file"
          className="input"
          type="file"
          accept="application/json,.json"
          onChange={(event) => onFileChange(event.target.files?.[0] || null)}
        />
        <p className="help-text">{importFile ? importFile.name : "Use the encrypted backup exported from Vorliq."}</p>
      </div>
      <div className="field">
        <label htmlFor="wallet-import-password">Backup Password</label>
        <input
          id="wallet-import-password"
          className="input"
          type="password"
          value={importPassword}
          onChange={(event) => onPasswordChange(event.target.value)}
          autoComplete="current-password"
        />
        <p className="help-text">This password is used locally to decrypt the backup and is not sent to Vorliq.</p>
      </div>
      <button className="button secondary" type="submit" disabled={importing}>
        {importing ? "Importing..." : "Import Encrypted Backup"}
      </button>
    </form>
  );
}

export default Login;
