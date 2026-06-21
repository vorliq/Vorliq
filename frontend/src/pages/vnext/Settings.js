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
import { Link, useNavigate } from "react-router-dom";
import { Eye, EyeOff, ImageUp, KeyRound, Lock, LogOut, ShieldAlert } from "lucide-react";
import { toast } from "react-toastify";

import "../../styles/vnext.css";
import AppShell from "../../components/vnext/AppShell";
import Modal from "../../components/vnext/Modal";
import ProfileAvatar from "../../components/ProfileAvatar";
import { Button, Card, CopyButton, InlineError } from "../../components/vnext/primitives";
import { useAuth } from "../../context/AuthContext";
import { useNotifications } from "../../context/NotificationContext";
import { isAnalyticsEnabled, setAnalyticsEnabled } from "../../helpers/analytics";
import api, { getNodeUrl, setNodeUrl } from "../../helpers/api";
import { bumpAvatarVersion } from "../../helpers/avatarStore";
import { resizeImageToDataUrl } from "../../helpers/resizeImage";
import { authorityErrorMessage, postSignedAuthority } from "../../helpers/signedAuthority";
import { loadWallet, saveWallet } from "../../helpers/storage";

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

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
/* ------------------------------------------------ Profile image ----------- */
// Upload a profile image / logo. The file is resized to a 256x256 PNG in the
// browser, then signed with the wallet password and posted through the existing
// signed-authority layer so only the wallet owner can set their own avatar.
function AvatarSection({ address }) {
  const [preview, setPreview] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const fileRef = useRef(null);

  async function handlePick(event) {
    setError("");
    setDone(false);
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_AVATAR_BYTES) {
      setError("Image must be 2MB or smaller.");
      return;
    }
    try {
      setPreview(await resizeImageToDataUrl(file, 256));
    } catch (err) {
      setPreview("");
      setError(err.message || "Could not read that image.");
    }
  }

  async function handleUpload(event) {
    event.preventDefault();
    if (!preview) {
      setError("Choose an image first.");
      return;
    }
    if (!password) {
      setError("Enter your wallet password to sign this upload.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await postSignedAuthority({ action: "profile.avatar", body: { image: preview }, walletPassword: password });
      bumpAvatarVersion(address); // refresh the avatar everywhere it is shown
      setPreview("");
      setPassword("");
      setDone(true);
      if (fileRef.current) fileRef.current.value = "";
      toast.success("Profile image updated.");
    } catch (err) {
      const message = authorityErrorMessage(err, "Could not upload your image. Try a different file.");
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="vn-settings__section">
      <h2>Profile image</h2>
      <p className="vn-settings__hint">
        Upload a profile image or logo (PNG or JPEG, up to 2MB). It appears on your profile, your
        forum posts, governance proposals, lending requests, and in the sidebar.
      </p>
      <div className="vn-avatar-upload">
        <div className="vn-avatar-upload__preview">
          <ProfileAvatar address={address} size="large" />
          {preview && (
            <img className="profile-avatar large avatar-image" src={preview} alt="Selected new avatar preview" style={{ objectFit: "cover" }} />
          )}
        </div>
        <form className="vn-send-form vn-avatar-upload__controls" onSubmit={handleUpload}>
          <div className="vn-field">
            <label htmlFor="vn-avatar-file">Choose image</label>
            <input
              id="vn-avatar-file"
              ref={fileRef}
              className="vn-input"
              type="file"
              accept="image/png,image/jpeg"
              onChange={handlePick}
            />
          </div>
          <div className="vn-field">
            <label htmlFor="vn-avatar-pw">Wallet password</label>
            <input
              id="vn-avatar-pw"
              className="vn-input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <InlineError message={error} />
          {done && <p className="vn-settings__hint" style={{ margin: 0 }}>Your new profile image is live.</p>}
          <div className="vn-btn-row">
            <Button variant="primary" type="submit" disabled={!preview || !password || busy}>
              <ImageUp size={16} aria-hidden="true" /> {busy ? "Uploading..." : "Upload image"}
            </Button>
          </div>
        </form>
      </div>
    </section>
  );
}

/* ------------------------------------------------ Node operator flow ------ */
// Step-by-step onboarding for someone running a Vorliq node. It detects the
// current state of their node from the public registry and shows only the steps
// that remain. Identity is proven with the signed operator claim (Thread 2), so
// registration is cryptographic, not just a URL submission.
const OPERATOR_STEPS = [
  { key: "run", title: "Run your Vorliq node" },
  { key: "register", title: "Register your node in the network registry" },
  { key: "verify", title: "Verify your node identity (cryptographic proof)" },
  { key: "heartbeat", title: "Heartbeat & monitoring" },
];

function timeAgo(seconds) {
  if (!seconds) return "never";
  const delta = Math.max(0, Math.floor(Date.now() / 1000 - Number(seconds)));
  if (delta < 90) return "just now";
  if (delta < 3600) return `${Math.floor(delta / 60)} min ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)} h ago`;
  return `${Math.floor(delta / 86400)} d ago`;
}

function NodeOperatorFlow() {
  const { isLoggedIn, wallet } = useAuth();
  const [nodeUrl, setNodeUrl] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [node, setNode] = useState(null); // registry record or null
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const detect = useCallback(async (url) => {
    const target = (url ?? nodeUrl).trim();
    if (!target) return;
    setError("");
    setBusy("detect");
    try {
      const response = await api.get("/registry/node", { params: { node_url: target } });
      setNode(response.data?.node || null);
    } catch (err) {
      setNode(null); // not found yet — that is a valid, early state
    } finally {
      setChecked(true);
      setBusy("");
    }
  }, [nodeUrl]);

  // Identity is "done" only when the operator is cryptographically VERIFIED
  // (is_verified_operator, set by a signed claim) and bound to this wallet — not
  // merely the unsigned operator_wallet_address hint that registration records.
  const operatorVerified =
    Boolean(node?.is_verified_operator) && wallet?.address && node.operator_wallet_address === wallet.address;
  const heartbeating = Boolean(node?.last_heartbeat_at);

  // Completion state per step, derived from the detected registry record.
  const done = {
    run: Boolean(node), // a registered node is, by definition, running and reachable enough to be listed
    register: Boolean(node),
    verify: operatorVerified,
    heartbeat: heartbeating,
  };
  const currentKey = OPERATOR_STEPS.find((step) => !done[step.key])?.key || null;

  async function registerNode(event) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (!nodeUrl.trim() || !displayName.trim()) {
      setError("Enter your node URL and a display name.");
      return;
    }
    setBusy("register");
    try {
      await api.post("/registry/register", {
        node_url: nodeUrl.trim(),
        display_name: displayName.trim(),
        operator_wallet_address: wallet?.address,
      });
      setMessage("Node registered. Now prove you control it below.");
      await detect(nodeUrl);
    } catch (err) {
      setError(err.response?.data?.message || "Unable to register the node.");
    } finally {
      setBusy("");
    }
  }

  async function verifyIdentity() {
    setError("");
    setMessage("");
    if (!password) {
      setError("Enter your wallet password to sign the operator claim.");
      return;
    }
    setBusy("verify");
    try {
      await postSignedAuthority({
        action: "registry.verify_operator",
        body: { node_url: nodeUrl.trim(), release: false },
        walletPassword: password,
      });
      setPassword("");
      setMessage("Operator identity verified and cryptographically bound to your wallet.");
      await detect(nodeUrl);
    } catch (err) {
      setError(authorityErrorMessage(err, "Could not verify the operator claim. Check your password and node URL."));
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="vn-settings__section">
      <h2>Run a node</h2>
      <p className="vn-settings__hint">
        Operate a Vorliq node to help secure and serve the network. Enter your node URL to detect what
        is left to do — completed steps collapse so you only see what remains.
      </p>

      {!isLoggedIn ? (
        <p className="vn-empty-note" style={{ margin: 0 }}>
          <Link className="vn-block-link" to="/login">Sign in</Link> to register and verify a node.
        </p>
      ) : (
        <>
          <div className="vn-field">
            <label htmlFor="vn-op-url">Your node URL</label>
            <div className="vn-op-detect">
              <input
                id="vn-op-url"
                className="vn-input"
                type="url"
                placeholder="https://node.example.org"
                value={nodeUrl}
                onChange={(event) => setNodeUrl(event.target.value)}
              />
              <Button variant="secondary" onClick={() => detect()} disabled={!nodeUrl.trim() || busy === "detect"}>
                {busy === "detect" ? "Checking…" : "Detect status"}
              </Button>
            </div>
          </div>

          <ol className="vn-op-steps">
            {OPERATOR_STEPS.map((step) => {
              const isDone = done[step.key];
              const isCurrent = step.key === currentKey;
              return (
                <li key={step.key} className={`vn-op-step ${isDone ? "is-done" : ""} ${isCurrent ? "is-current" : ""}`}>
                  <div className="vn-op-step__head">
                    <span className="vn-op-step__mark" aria-hidden="true">{isDone ? "✓" : "•"}</span>
                    <span className="vn-op-step__title">{step.title}</span>
                    {isDone && <span className="vn-op-step__badge">Done</span>}
                  </div>

                  {/* Completed steps collapse to just the title + checkmark. */}
                  {!isDone && (isCurrent || (checked && !node)) && (
                    <div className="vn-op-step__body">
                      {step.key === "run" && (
                        <p className="vn-field__hint" style={{ margin: 0 }}>
                          Install and start your node, then come back here. Full instructions:{" "}
                          <a className="vn-block-link" href="https://vorliq.github.io/Vorliq/run-your-own-node.html" target="_blank" rel="noopener noreferrer">
                            run your own node
                          </a>.
                        </p>
                      )}
                      {step.key === "register" && (
                        <form className="vn-send-form" onSubmit={registerNode}>
                          <div className="vn-field">
                            <label htmlFor="vn-op-name">Display name</label>
                            <input
                              id="vn-op-name"
                              className="vn-input"
                              value={displayName}
                              onChange={(event) => setDisplayName(event.target.value)}
                              placeholder="My community node"
                            />
                          </div>
                          <Button variant="primary" type="submit" disabled={busy === "register"}>
                            {busy === "register" ? "Registering…" : "Register node"}
                          </Button>
                        </form>
                      )}
                      {step.key === "verify" && (
                        <div className="vn-send-form">
                          <p className="vn-field__hint" style={{ margin: 0 }}>
                            Prove you control this node by signing a claim that binds it to your wallet. The
                            signature is created in your browser; only the signed claim is sent.
                          </p>
                          <div className="vn-field">
                            <label htmlFor="vn-op-pw">Wallet password</label>
                            <input
                              id="vn-op-pw"
                              className="vn-input"
                              type="password"
                              autoComplete="current-password"
                              value={password}
                              onChange={(event) => setPassword(event.target.value)}
                            />
                          </div>
                          <Button variant="primary" onClick={verifyIdentity} disabled={busy === "verify"}>
                            {busy === "verify" ? "Signing…" : "Verify identity"}
                          </Button>
                        </div>
                      )}
                    </div>
                  )}

                  {step.key === "heartbeat" && (
                    <div className="vn-op-step__body">
                      <p className="vn-field__hint" style={{ margin: 0 }}>
                        Your node sends a heartbeat to the registry about every 5 minutes. It reports the node
                        is online and its chain height, so the network knows it is reachable and in sync. If the
                        heartbeat stops, your node is marked stale and then inactive.
                      </p>
                      {node && (
                        <p className="vn-field__hint" style={{ marginTop: 8 }}>
                          Last heartbeat: <strong>{timeAgo(node.last_heartbeat_at || node.last_seen)}</strong>
                          {" · "}Sync: <strong>{node.sync_status || "unknown"}</strong>
                          {" · "}Reachable: <strong>{node.reachable === true ? "yes" : node.reachable === false ? "no" : "unknown"}</strong>
                        </p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>

          <InlineError message={error} />
          {message && <p className="vn-settings__hint" style={{ margin: 0 }}>{message}</p>}
        </>
      )}
    </section>
  );
}

export default function Settings() {
  const { isLoggedIn, wallet, logout } = useAuth();
  const navigate = useNavigate();
  function handleSignOut() {
    logout();
    navigate("/");
  }
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
                <Button variant="secondary" onClick={handleSignOut}>
                  <LogOut size={16} aria-hidden="true" /> Sign out
                </Button>
              </div>
            </>
          ) : (
            <p className="vn-empty-note" style={{ margin: 0 }}>
              <Link className="vn-block-link" to="/login">Sign in</Link> to manage your wallet account.
            </p>
          )}
        </section>

        {/* Profile image */}
        {isLoggedIn && address && <AvatarSection address={address} />}

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

        {/* Node operator onboarding */}
        <NodeOperatorFlow />
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
