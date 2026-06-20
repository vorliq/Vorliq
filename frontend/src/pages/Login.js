import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";

import ErrorMessage from "../components/ErrorMessage";
import RevealSection from "../components/RevealSection";
import { useAuth } from "../context/AuthContext";
import api from "../helpers/api";
import { apiErrorMessage } from "../helpers/errors";
import { createEncryptedWalletBackup, hasWallet, importEncryptedWalletBackup } from "../helpers/storage";
import { deriveWalletFromPrivateKey } from "../helpers/walletFromPrivateKey";

function Login() {
  const navigate = useNavigate();
  const { adoptImportedWallet, clearLocalWallet, createAndSaveWallet, isLoggedIn, login } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [safetyConfirmed, setSafetyConfirmed] = useState(false);
  const [importMode, setImportMode] = useState("backup");
  const [importFile, setImportFile] = useState(null);
  const [importPassword, setImportPassword] = useState("");
  const [importing, setImporting] = useState(false);
  // Private-key import state. `pkKey` holds the pasted key only until the address
  // and encrypted backup are derived, then it is cleared immediately.
  const [pkKey, setPkKey] = useState("");
  const [pkPassword, setPkPassword] = useState("");
  const [pkConfirm, setPkConfirm] = useState("");
  const [pkSafety, setPkSafety] = useState(false);
  const [pkBusy, setPkBusy] = useState(false);
  const [pkNoRecord, setPkNoRecord] = useState(null);
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

  // Finalise a private-key import: persist the already-encrypted backup and start
  // the session. No raw key is involved here.
  function finishPrivateKeyImport(backup, publicInfo) {
    adoptImportedWallet(backup, publicInfo);
    setPkPassword("");
    setPkConfirm("");
    setPkSafety(false);
    setPkNoRecord(null);
    setWalletExists(true);
    setErrorMessage("");
    toast.success("Wallet imported and signed in.");
    navigate("/account");
  }

  async function importPrivateKey(event) {
    event.preventDefault();
    setErrorMessage("");

    if (!pkKey.trim()) {
      toast.error("Paste your private key.");
      return;
    }
    if (!pkPassword) {
      toast.error("Choose a password to encrypt this wallet in your browser.");
      return;
    }
    if (pkPassword !== pkConfirm) {
      toast.error("Passwords do not match.");
      return;
    }
    if (!pkSafety) {
      toast.error("Confirm that you understand you are responsible for your private key.");
      return;
    }

    setPkBusy(true);
    let derived;
    let backup;
    try {
      // Derive the address + signing material locally, then immediately produce
      // the encrypted backup and wipe the raw key from state and memory. From
      // here on only the encrypted envelope and the public address are held.
      derived = deriveWalletFromPrivateKey(pkKey);
      backup = await createEncryptedWalletBackup(derived, pkPassword);
      derived.private_key = null;
      setPkKey("");
    } catch (error) {
      setPkBusy(false);
      setPkKey("");
      const message = error?.message || "That private key could not be read.";
      setErrorMessage(message);
      toast.error(message);
      return;
    }

    const publicInfo = { address: derived.address, public_key: derived.public_key };

    // Check whether the address has any chain record. A failure to check (e.g.
    // the blockchain service is down) is treated as "no record found" so the
    // user is informed rather than blocked.
    let hasRecord = false;
    try {
      const response = await api.get("/wallet/history", { params: { address: publicInfo.address, limit: 1, offset: 0 } });
      const total = Number(response.data?.total ?? response.data?.transaction_count ?? 0);
      const balance = Number(response.data?.balance ?? 0);
      hasRecord = total > 0 || balance > 0;
    } catch (error) {
      hasRecord = false;
    }

    setPkBusy(false);
    if (hasRecord) {
      finishPrivateKeyImport(backup, publicInfo);
    } else {
      setPkNoRecord({ ...publicInfo, backup });
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

  const restoreCard = (
    <RestoreWalletCard
      importMode={importMode}
      onModeChange={(mode) => {
        setImportMode(mode);
        setPkNoRecord(null);
      }}
      backupProps={{
        importFile,
        importPassword,
        importing,
        onFileChange: setImportFile,
        onPasswordChange: setImportPassword,
        onSubmit: importWallet,
      }}
      privateKeyProps={{
        pkKey,
        pkPassword,
        pkConfirm,
        pkSafety,
        pkBusy,
        pkNoRecord,
        onKeyChange: setPkKey,
        onPasswordChange: setPkPassword,
        onConfirmChange: setPkConfirm,
        onSafetyChange: setPkSafety,
        onSubmit: importPrivateKey,
        onProceedNoRecord: () => finishPrivateKeyImport(pkNoRecord.backup, { address: pkNoRecord.address, public_key: pkNoRecord.public_key }),
        onCancelNoRecord: () => setPkNoRecord(null),
      }}
    />
  );

  return (
    <div className="page auth-page">
      <section className="hero">
        <span className="eyebrow">Member Access</span>
        <h1>{walletExists ? "Unlock saved wallet" : "Create or restore your Vorliq wallet"}</h1>
        <p className="subtitle">
          Vorliq wallets are encrypted in this browser with your password. Unlocking, importing,
          or pasting a private key all happen locally; Vorliq never sends your backup password or
          private key to the server.
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

            {restoreCard}

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

            {restoreCard}
          </>
        )}
      </RevealSection>
    </div>
  );
}

function RestoreWalletCard({ importMode, onModeChange, backupProps, privateKeyProps }) {
  return (
    <section className="card card-pad stack wallet-entry-panel">
      <div>
        <span className="eyebrow">Sign in with an existing wallet</span>
        <h2>Import a wallet</h2>
        <p className="help-text">
          Restore an encrypted backup file, or sign in by pasting your private key. Both methods
          run entirely in this browser — nothing is sent to Vorliq.
        </p>
      </div>
      <div className="button-row" role="tablist" aria-label="Import method">
        <button
          type="button"
          role="tab"
          aria-selected={importMode === "backup"}
          className={`button ${importMode === "backup" ? "" : "secondary"}`}
          onClick={() => onModeChange("backup")}
        >
          Backup file
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={importMode === "privatekey"}
          className={`button ${importMode === "privatekey" ? "" : "secondary"}`}
          onClick={() => onModeChange("privatekey")}
        >
          Private key
        </button>
      </div>
      {importMode === "backup" ? (
        <ImportWalletForm {...backupProps} />
      ) : (
        <PrivateKeyImportForm {...privateKeyProps} />
      )}
    </section>
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

function PrivateKeyImportForm({
  pkKey,
  pkPassword,
  pkConfirm,
  pkSafety,
  pkBusy,
  pkNoRecord,
  onKeyChange,
  onPasswordChange,
  onConfirmChange,
  onSafetyChange,
  onSubmit,
  onProceedNoRecord,
  onCancelNoRecord,
}) {
  if (pkNoRecord) {
    return (
      <div className="form wallet-import-panel stack" role="alert">
        <div className="wallet-safety-box">
          <strong>No chain record found for this address</strong>
          <p>
            <code>{pkNoRecord.address}</code> hasn&apos;t appeared on the Vorliq chain yet. That is
            normal if you are importing a wallet that predates this chain, or one you intend to use
            to receive funds for the first time. You can sign in anyway — your balance will show
            once the wallet has activity.
          </p>
        </div>
        <div className="button-row">
          <button className="button" type="button" onClick={onProceedNoRecord}>
            Sign in anyway
          </button>
          <button className="button secondary" type="button" onClick={onCancelNoRecord}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <form className="form wallet-import-panel" onSubmit={onSubmit}>
      <div className="wallet-safety-box">
        <strong>You are responsible for your private key</strong>
        <p>
          Your key never leaves this browser and is never sent to Vorliq. Only ever paste it here,
          on the real Vorliq site. Pasting your private key into any other site, chat, or app can
          let someone drain your wallet. It is cleared from this page as soon as your address is
          derived.
        </p>
      </div>
      <div className="field">
        <label htmlFor="pk-import-key">Private Key (PEM)</label>
        <input
          id="pk-import-key"
          className="input"
          type="password"
          value={pkKey}
          onChange={(event) => onKeyChange(event.target.value)}
          autoComplete="off"
          spellCheck="false"
          placeholder="-----BEGIN PRIVATE KEY-----"
        />
        <p className="help-text">Paste the full PEM including the BEGIN and END lines.</p>
      </div>
      <div className="field">
        <label htmlFor="pk-import-password">New Browser Password</label>
        <input
          id="pk-import-password"
          className="input"
          type="password"
          value={pkPassword}
          onChange={(event) => onPasswordChange(event.target.value)}
          autoComplete="new-password"
        />
        <p className="help-text">Encrypts the imported wallet in this browser so you can unlock it next time.</p>
      </div>
      <div className="field">
        <label htmlFor="pk-import-confirm">Confirm Browser Password</label>
        <input
          id="pk-import-confirm"
          className="input"
          type="password"
          value={pkConfirm}
          onChange={(event) => onConfirmChange(event.target.value)}
          autoComplete="new-password"
        />
      </div>
      <label className="checkbox-row">
        <input type="checkbox" checked={pkSafety} onChange={(event) => onSafetyChange(event.target.checked)} />
        <span>I understand I am responsible for keeping my private key safe and that Vorliq cannot recover it.</span>
      </label>
      <button className="button secondary" type="submit" disabled={pkBusy}>
        {pkBusy ? "Importing..." : "Import Private Key and Sign In"}
      </button>
    </form>
  );
}

export default Login;
