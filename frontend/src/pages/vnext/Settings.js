// Settings page inside the new app shell (/preview/app/settings). Three sections
// separated by horizontal rules:
//   Account       wallet address (copy) + a hardened private-key reveal flow
//   Notifications real, local preferences only (in-app notices + anonymous
//                 analytics) — Vorliq does not send email or push, so no fake
//                 email/push endpoints are invented here
//   Network       current node connection URL (editable, persisted per device)
//                 and a live Synced / Unreachable indicator
//
// Private-key reveal is hardened: the user must type an exact confirmation
// phrase AND their wallet password. The phrase gate cannot be bypassed (the
// reveal action is blocked until it matches), and the key auto-hides after 60s.
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Eye, EyeOff, KeyRound, Lock, ShieldAlert } from "lucide-react";

import "../../styles/vnext.css";
import AppShell from "../../components/vnext/AppShell";
import Modal from "../../components/vnext/Modal";
import { Button, Card, CopyButton, InlineError } from "../../components/vnext/primitives";
import { useAuth } from "../../context/AuthContext";
import { useNotifications } from "../../context/NotificationContext";
import { isAnalyticsEnabled, setAnalyticsEnabled } from "../../helpers/analytics";
import api, { getNodeUrl, setNodeUrl } from "../../helpers/api";
import { loadWallet, saveWallet } from "../../helpers/storage";

const CONFIRM_PHRASE = "REVEAL MY PRIVATE KEY";
const REVEAL_TIMEOUT_MS = 60000;

function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`vn-switch ${checked ? "is-on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span className="vn-switch__dot" aria-hidden="true" />
    </button>
  );
}

/* --------------------------------------------------- Private key reveal --- */
function RevealKeyModal({ onClose }) {
  const [phrase, setPhrase] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [privateKey, setPrivateKey] = useState("");
  const [shown, setShown] = useState(false);
  const timeoutRef = useRef(null);

  const phraseOk = phrase.trim() === CONFIRM_PHRASE;

  const clearKey = useCallback(() => {
    setPrivateKey("");
    setShown(false);
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  useEffect(() => clearKey, [clearKey]);

  async function reveal(event) {
    event.preventDefault();
    setError("");
    // Hard gate: never proceed unless the exact phrase was typed.
    if (!phraseOk) {
      setError(`Type the exact phrase "${CONFIRM_PHRASE}" to continue.`);
      return;
    }
    if (!password) {
      setError("Enter your wallet password.");
      return;
    }
    setBusy(true);
    try {
      const unlocked = await loadWallet(password);
      setPrivateKey(unlocked.private_key);
      setShown(false);
      setPassword("");
      timeoutRef.current = setTimeout(() => clearKey(), REVEAL_TIMEOUT_MS);
    } catch {
      setError("Unable to reveal private key. Check your password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Reveal private key" onClose={onClose}>
      {!privateKey ? (
        <form className="vn-send-form" onSubmit={reveal}>
          <div className="vn-error" role="note" style={{ alignItems: "flex-start" }}>
            <span>
              Anyone with your private key controls your wallet. Only reveal it when you are alone on a
              trusted device. It auto-hides after 60 seconds.
            </span>
          </div>
          {error && <InlineError message={error} />}
          <div className="vn-field">
            <label htmlFor="vn-reveal-phrase">
              Type <strong>{CONFIRM_PHRASE}</strong> to confirm
            </label>
            <input
              id="vn-reveal-phrase"
              className="vn-input"
              type="text"
              autoComplete="off"
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              placeholder={CONFIRM_PHRASE}
            />
          </div>
          <div className="vn-field">
            <label htmlFor="vn-reveal-pw">Wallet password</label>
            <input
              id="vn-reveal-pw"
              className="vn-input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <Button variant="primary" type="submit" disabled={!phraseOk || !password || busy}>
            {busy ? "Revealing…" : "Reveal for 60 seconds"}
          </Button>
        </form>
      ) : (
        <div className="vn-send-form">
          <div className={`vn-key-field ${shown ? "" : "vn-key-field--blurred"}`}>
            <span className="vn-key-field__value vn-mono">{privateKey}</span>
          </div>
          <div className="vn-btn-row">
            <Button variant="primary" onClick={() => setShown((v) => !v)}>
              {shown ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
              {shown ? "Hide" : "Click to reveal"}
            </Button>
            <CopyButton value={privateKey} label="Copy key" />
            <Button variant="secondary" onClick={clearKey}>
              Done
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------------------------ Change password --------- */
// Re-encrypts the EXISTING key under a new password, entirely on this device.
// The project previously only offered "create new wallet" (a fresh keypair) or
// "import backup" (keeps the old password) -- there was no way to re-wrap the
// same key under a new password. This fills that gap. The raw private key is
// decrypted and re-encrypted locally via WebCrypto and never sent anywhere.
function ChangePasswordModal({ onClose }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (!current) {
      setError("Enter your current password.");
      return;
    }
    if (!next) {
      setError("Choose a new password.");
      return;
    }
    if (next !== confirm) {
      setError("New passwords do not match.");
      return;
    }
    if (next === current) {
      setError("Choose a new password different from the current one.");
      return;
    }
    setBusy(true);
    try {
      // Local only: decrypt with the current password, then re-encrypt the SAME
      // keypair under the new password and store it. No network, no raw key leaves
      // the browser, and the address/balance are unchanged.
      const unlocked = await loadWallet(current);
      await saveWallet(
        { address: unlocked.address, public_key: unlocked.public_key, private_key: unlocked.private_key },
        next
      );
      setCurrent("");
      setNext("");
      setConfirm("");
      setDone(true);
    } catch {
      setError("Unable to change password. Check that your current password is correct.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Change wallet password" onClose={onClose}>
      {done ? (
        <div className="vn-send-form">
          <p className="vn-settings__hint" style={{ margin: 0 }}>
            Your wallet is now re-encrypted under the new password on this device. The key itself is
            unchanged, so your address and balance stay the same. Any older backup files still use the old
            password — create a fresh encrypted backup if the old password may be exposed.
          </p>
          <div className="vn-btn-row">
            <Button variant="primary" onClick={onClose}>Done</Button>
          </div>
        </div>
      ) : (
        <form className="vn-send-form" onSubmit={submit}>
          <div className="vn-error" role="note" style={{ alignItems: "flex-start" }}>
            <span>
              This re-wraps your existing key under a new password, entirely on this device. Your private key
              is never sent anywhere and does not change — only the password protecting it. A new password
              does not undo an already-exposed key; if the key itself may be compromised, create a new wallet
              instead.
            </span>
          </div>
          {error && <InlineError message={error} />}
          <div className="vn-field">
            <label htmlFor="vn-cp-current">Current password</label>
            <input
              id="vn-cp-current"
              className="vn-input"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </div>
          <div className="vn-field">
            <label htmlFor="vn-cp-new">New password</label>
            <input
              id="vn-cp-new"
              className="vn-input"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          </div>
          <div className="vn-field">
            <label htmlFor="vn-cp-confirm">Confirm new password</label>
            <input
              id="vn-cp-confirm"
              className="vn-input"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
          <Button variant="primary" type="submit" disabled={busy}>
            {busy ? "Updating…" : "Change password"}
          </Button>
        </form>
      )}
    </Modal>
  );
}

/* ---------------------------------------------------------- Network ------- */
function NetworkSection() {
  const [status, setStatus] = useState("checking"); // checking | synced | unreachable
  const [height, setHeight] = useState(null);
  const [urlInput, setUrlInput] = useState(getNodeUrl());
  const [savedMsg, setSavedMsg] = useState("");
  const [urlError, setUrlError] = useState("");

  const check = useCallback(async (signal) => {
    setStatus("checking");
    try {
      const res = await api.get("/chain/summary", { signal, timeout: 8000 });
      const h = res.data?.summary?.block_height;
      setHeight(Number.isFinite(Number(h)) ? Number(h) : null);
      setStatus("synced");
    } catch (err) {
      if (err?.name === "CanceledError" || err?.code === "ERR_CANCELED") return;
      setStatus("unreachable");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    check(controller.signal);
    return () => controller.abort();
  }, [check]);

  function save(event) {
    event.preventDefault();
    setUrlError("");
    setSavedMsg("");
    try {
      const applied = setNodeUrl(urlInput);
      setUrlInput(applied);
      setSavedMsg("Node URL saved for this device.");
      check();
    } catch (err) {
      setUrlError(err.message || "Enter a valid http(s) node URL.");
    }
  }

  function reset() {
    const applied = setNodeUrl("");
    setUrlInput(applied);
    setSavedMsg("Reset to the default node.");
    setUrlError("");
    check();
  }

  return (
    <section className="vn-settings__section">
      <h2>Network</h2>
      <p className="vn-settings__hint">
        The node connection is where this app reads public chain data. You can point it at a different
        Vorliq node on this device.
      </p>
      <p className="vn-settings__warn">
        Only point this at a node you run or fully trust. A node you connect to can show false balances and
        transaction confirmations, and can see which addresses you look up. It cannot move your funds — every
        transaction is still signed on your device — but it can mislead you. Nodes listed in the public registry
        are self-reported and not verified by Vorliq.
      </p>

      <div className="vn-toggle-row">
        <div className="vn-toggle-row__label">
          <strong>Node status</strong>
          <span>{height != null ? `Latest block #${height.toLocaleString()}` : "Public chain connection"}</span>
        </div>
        <span className="vn-sync">
          {status === "synced" ? (
            <>
              <span className="vn-sync__dot vn-sync__dot--synced" /> Synced
            </>
          ) : status === "checking" ? (
            <>
              <span className="vn-sync__dot vn-sync__dot--syncing" /> Checking…
            </>
          ) : (
            <>
              <span className="vn-sync__dot vn-sync__dot--syncing" /> Unreachable
            </>
          )}
        </span>
      </div>

      <form className="vn-field" onSubmit={save} style={{ marginTop: 16 }}>
        <label htmlFor="vn-node-url">Node connection URL</label>
        <div className="vn-addr-field">
          <input
            id="vn-node-url"
            className="vn-input"
            type="url"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="https://node.example/api"
          />
          <Button variant="primary" type="submit">Save</Button>
          <Button variant="secondary" type="button" onClick={reset}>Reset</Button>
        </div>
        {urlError && <p className="vn-field__hint vn-field__hint--error">{urlError}</p>}
        {savedMsg && !urlError && <p className="vn-field__hint">{savedMsg}</p>}
      </form>
    </section>
  );
}

/* ------------------------------------------------------------ Page -------- */
export default function Settings() {
  const { isLoggedIn, wallet } = useAuth();
  const address = wallet?.address;
  const { notificationsEnabled, setNotificationsEnabled } = useNotifications();
  const [analyticsOn, setAnalyticsOn] = useState(isAnalyticsEnabled());
  const [revealOpen, setRevealOpen] = useState(false);
  const [changePwOpen, setChangePwOpen] = useState(false);

  function toggleAnalytics(next) {
    setAnalyticsEnabled(next);
    setAnalyticsOn(next);
  }

  return (
    <AppShell active="settings">
      <div className="vn-page-head">
        <h1>Settings</h1>
      </div>

      <Card className="vn-settings">
        {/* Account */}
        <section className="vn-settings__section">
          <h2>Account</h2>
          <p className="vn-settings__hint">
            Your wallet is self-custody and encrypted on this device. Vorliq never stores your private key
            or password on any server.
          </p>
          {isLoggedIn && address ? (
            <>
              <div className="vn-field">
                <label>Wallet address</label>
                <div className="vn-addr-field">
                  <span className="vn-addr-field__value vn-mono">{address}</span>
                  <CopyButton value={address} label="Copy" />
                </div>
              </div>
              <div className="vn-btn-row" style={{ marginTop: 16 }}>
                <Button variant="secondary" onClick={() => setRevealOpen(true)}>
                  <KeyRound size={16} aria-hidden="true" /> Export private key
                </Button>
                <Button variant="secondary" onClick={() => setChangePwOpen(true)}>
                  <Lock size={16} aria-hidden="true" /> Change password
                </Button>
              </div>
            </>
          ) : (
            <p className="vn-empty-note" style={{ margin: 0 }}>
              <Link className="vn-block-link" to="/login">Sign in</Link> to manage your wallet account.
            </p>
          )}
        </section>

        {/* Notifications */}
        <section className="vn-settings__section">
          <h2>Notifications</h2>
          <p className="vn-settings__hint">
            Vorliq generates notices locally from public chain data while the app is open. It does not send
            email or browser push notifications, so there are no off-device notification settings.
          </p>
          <div className="vn-toggle-row">
            <div className="vn-toggle-row__label">
              <strong>In-app notices</strong>
              <span>Show wallet, lending, and mining notices on this device.</span>
            </div>
            <Toggle checked={notificationsEnabled} onChange={setNotificationsEnabled} label="In-app notices" />
          </div>
          <div className="vn-toggle-row">
            <div className="vn-toggle-row__label">
              <strong>Anonymous usage analytics</strong>
              <span>Self-hosted, no third parties; never tied to your wallet. Off disables all events.</span>
            </div>
            <Toggle checked={analyticsOn} onChange={toggleAnalytics} label="Anonymous usage analytics" />
          </div>
        </section>

        {/* Network */}
        <NetworkSection />
      </Card>

      <p className="vn-field__hint" style={{ marginTop: 14, display: "flex", gap: 8, alignItems: "center" }}>
        <ShieldAlert size={15} aria-hidden="true" /> Keep your password safe — Vorliq cannot reset it or
        recover your wallet without it.
      </p>

      {revealOpen && <RevealKeyModal onClose={() => setRevealOpen(false)} />}
      {changePwOpen && <ChangePasswordModal onClose={() => setChangePwOpen(false)} />}
    </AppShell>
  );
}
