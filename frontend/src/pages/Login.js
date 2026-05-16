import { useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";

import ErrorMessage from "../components/ErrorMessage";
import { useAuth } from "../context/AuthContext";
import { apiErrorMessage } from "../helpers/errors";
import { hasWallet, importEncryptedWalletBackup } from "../helpers/storage";

function Login() {
  const navigate = useNavigate();
  const { createAndSaveWallet, isLoggedIn, login } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [safetyConfirmed, setSafetyConfirmed] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importPassword, setImportPassword] = useState("");
  const [importing, setImporting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const walletExists = useMemo(() => hasWallet(), []);

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

  if (isLoggedIn) {
    return <Navigate to="/account" replace />;
  }

  return (
    <div className="page auth-page">
      <section className="hero">
        <span className="eyebrow">Member Access</span>
        <h1>{walletExists ? "Welcome Back" : "Create Your Vorliq Wallet"}</h1>
        <p className="subtitle">
          Your wallet is encrypted in this browser with your password. Vorliq cannot recover
          the password or private key for you.
        </p>
      </section>

      <ErrorMessage message={errorMessage} />

      <section className="card card-pad auth-card">
        {walletExists ? (
          <form className="form" onSubmit={unlockWallet}>
            <h2>Welcome Back</h2>
            <div className="field">
              <label htmlFor="unlock-password">Password</label>
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
              {loading ? "Unlocking..." : "Unlock Wallet"}
            </button>
          </form>
        ) : (
          <div className="stack">
            <form className="form" onSubmit={createWallet}>
              <h2>Create Your Vorliq Wallet</h2>
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

            <form className="form wallet-import-panel" onSubmit={importWallet}>
              <h2>Import Wallet Backup</h2>
              <p className="help-text">
                Choose a <strong>vorliq-wallet-backup.json</strong> file and enter the password
                used to encrypt it. The app decrypts locally to confirm the password before
                saving anything in this browser.
              </p>
              <div className="field">
                <label htmlFor="wallet-import-file">Wallet Backup JSON</label>
                <input
                  id="wallet-import-file"
                  className="input"
                  type="file"
                  accept="application/json,.json"
                  onChange={(event) => setImportFile(event.target.files?.[0] || null)}
                />
              </div>
              <div className="field">
                <label htmlFor="wallet-import-password">Backup Password</label>
                <input
                  id="wallet-import-password"
                  className="input"
                  type="password"
                  value={importPassword}
                  onChange={(event) => setImportPassword(event.target.value)}
                  autoComplete="current-password"
                />
              </div>
              <button className="button secondary" type="submit" disabled={importing}>
                {importing ? "Importing..." : "Import Wallet Backup"}
              </button>
            </form>
          </div>
        )}
      </section>
    </div>
  );
}

export default Login;
