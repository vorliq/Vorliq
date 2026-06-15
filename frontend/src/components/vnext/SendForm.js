// Reusable Send VLQ form + status panel. Used inline on the Wallet page and as
// the standalone Send route. Mirrors the existing send flow exactly: the
// transaction is signed locally in the browser (private key decrypted from the
// saved wallet with the password, never sent to the server), submitted to
// /transaction/send, then its status is polled via the existing
// /transactions/:id endpoint until it confirms in a block.
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Loader2 } from "lucide-react";

import { useAuth } from "../../context/AuthContext";
import api from "../../helpers/api";
import { validateAddress, validateTransactionReview } from "../../helpers/address";
import { apiErrorMessage } from "../../helpers/errors";
import { signTransaction } from "../../helpers/signer";
import { loadWallet } from "../../helpers/storage";
import useWalletBalance from "../../helpers/useWalletBalance";
import { formatNumber, formatVlq } from "../../helpers/publicApi";
import { Button, InlineError } from "./primitives";

const POLL_MS = 5000;
const POLL_LIMIT = 60; // ~5 minutes of polling, then stop quietly

export default function SendForm() {
  const { isLoggedIn, wallet } = useAuth();
  const address = wallet?.address;
  const { balance } = useWalletBalance(address);

  const [recipient, setRecipient] = useState("");
  const [recipientTouched, setRecipientTouched] = useState(false);
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState("");

  // status: null | "broadcasting" | "submitted" | "confirmed"
  const [status, setStatus] = useState(null);
  const [tx, setTx] = useState(null);
  const pollRef = useRef(null);

  const clearPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => clearPoll, [clearPoll]);

  const recipientCheck = recipientTouched ? validateAddress(recipient, { label: "recipient address" }) : null;

  function resetForm() {
    clearPoll();
    setRecipient("");
    setRecipientTouched(false);
    setAmount("");
    setMemo("");
    setPassword("");
    setFormError("");
    setStatus(null);
    setTx(null);
  }

  // Poll the existing transaction-status endpoint until the tx confirms.
  const startPolling = useCallback(
    (txId) => {
      clearPoll();
      let attempts = 0;
      pollRef.current = setInterval(async () => {
        attempts += 1;
        try {
          const res = await api.get(`/transactions/${encodeURIComponent(txId)}`);
          const t = res.data?.transaction;
          if (t) {
            setTx((prev) => ({ ...prev, ...t }));
            if (t.status === "confirmed" && t.block_index != null) {
              setStatus("confirmed");
              clearPoll();
              return;
            }
          }
        } catch {
          // transient; keep polling until the attempt cap
        }
        if (attempts >= POLL_LIMIT) clearPoll();
      }, POLL_MS);
    },
    [clearPoll]
  );

  async function handleSubmit(event) {
    event.preventDefault();
    setFormError("");

    const review = validateTransactionReview({
      senderAddress: address,
      receiverAddress: recipient,
      amount,
      balance,
    });
    if (!review.canSubmit) {
      setFormError(review.errors[0] || "Check the recipient and amount before sending.");
      return;
    }
    if (!password) {
      setFormError("Enter your wallet password to sign this transaction locally.");
      return;
    }

    setStatus("broadcasting");
    try {
      const { private_key: senderPrivateKey } = await loadWallet(password);
      const payload = await signTransaction({
        senderAddress: address,
        senderPrivateKey,
        senderPublicKey: wallet.public_key,
        receiverAddress: review.receiver.address,
        amount,
      });
      const response = await api.post("/transaction/send", payload);
      if (response.data?.success === false) {
        throw new Error(response.data.error || response.data.message || "Transaction was rejected.");
      }
      const transaction = response.data.transaction || { tx_id: response.data.tx_id, status: "pending" };
      setTx(transaction);
      setStatus("submitted");
      setPassword("");
      if (transaction.tx_id) startPolling(transaction.tx_id);
    } catch (error) {
      setFormError(apiErrorMessage(error, "Unable to send VLQ."));
      setStatus(null);
      setPassword("");
    }
  }

  if (!isLoggedIn || !address) {
    return (
      <div className="vn-empty-note">
        <Link className="vn-block-link" to="/login">
          Sign in
        </Link>{" "}
        to your wallet to send VLQ. Transactions are signed locally in your browser.
      </div>
    );
  }

  // After submission, show the live status panel instead of the form.
  if (status) {
    return <StatusPanel status={status} tx={tx} onReset={resetForm} />;
  }

  const amountNum = Number(amount);
  const overBalance =
    Number.isFinite(amountNum) && balance != null && Number.isFinite(balance) && amountNum > balance;

  return (
    <form className="vn-send-form" onSubmit={handleSubmit}>
      {formError && <InlineError message={formError} />}

      <div className="vn-field">
        <label htmlFor="vn-recipient">Recipient Address</label>
        <input
          id="vn-recipient"
          className="vn-input"
          type="text"
          autoComplete="off"
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          onBlur={() => setRecipientTouched(true)}
          placeholder="Vorliq wallet address"
        />
        {recipientCheck && recipient.trim() && (
          <p className={`vn-field__hint ${recipientCheck.valid ? "" : "vn-field__hint--error"}`}>
            {recipientCheck.valid
              ? recipientCheck.looksValid
                ? "Recipient address looks valid."
                : "Address is valid but unusual — verify it carefully."
              : recipientCheck.errors[0]}
          </p>
        )}
      </div>

      <div className="vn-field">
        <label htmlFor="vn-amount">Amount in VLQ</label>
        <input
          id="vn-amount"
          className="vn-input"
          type="number"
          min="0.00000001"
          step="0.00000001"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
        />
        <p className="vn-field__hint">
          Estimated network fee: <strong>0 VLQ</strong> — Vorliq does not charge a separate network fee.
          {balance != null && Number.isFinite(balance) && (
            <> Confirmed balance: {formatVlq(balance)}.</>
          )}
        </p>
        {overBalance && <p className="vn-field__hint vn-field__hint--error">Amount exceeds your confirmed balance.</p>}
      </div>

      <div className="vn-field">
        <label htmlFor="vn-memo">Memo (optional)</label>
        <input
          id="vn-memo"
          className="vn-input"
          type="text"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          placeholder="A note for yourself"
          maxLength={140}
        />
        <p className="vn-field__hint">Kept on your device only — memos are not recorded on the Vorliq chain.</p>
      </div>

      <div className="vn-field">
        <label htmlFor="vn-password">Wallet Password</label>
        <input
          id="vn-password"
          className="vn-input"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="To sign locally"
        />
        <p className="vn-field__hint">Your private key is decrypted in this browser only and never sent to the server.</p>
      </div>

      <Button variant="primary" type="submit">
        Send VLQ
      </Button>
    </form>
  );
}

function StatusPanel({ status, tx, onReset }) {
  const steps = [
    { key: "broadcasting", label: "Broadcasting transaction" },
    { key: "submitted", label: "Picked up by the network" },
    { key: "confirmed", label: "Confirmed in a block" },
  ];
  const order = { broadcasting: 0, submitted: 1, confirmed: 2 };
  const current = order[status] ?? 0;

  return (
    <div className="vn-status">
      <ol className="vn-status__steps">
        {steps.map((step, i) => {
          const done = i < current || status === "confirmed";
          const active = i === current && status !== "confirmed";
          return (
            <li key={step.key} className={`vn-status__step ${done ? "is-done" : ""} ${active ? "is-active" : ""}`}>
              <span className="vn-status__icon">
                {active ? (
                  <Loader2 size={18} className="vn-spin" aria-hidden="true" />
                ) : done ? (
                  <CheckCircle2 size={18} aria-hidden="true" />
                ) : (
                  <span className="vn-status__dot" />
                )}
              </span>
              {step.label}
            </li>
          );
        })}
      </ol>

      {tx?.tx_id && (
        <div className="vn-status__detail">
          <span className="vn-status__detail-label">Transaction hash</span>
          <span className="vn-mono vn-status__hash">{tx.tx_id}</span>
        </div>
      )}

      {status === "submitted" && (
        <p className="vn-field__hint">Waiting for a miner to include this transaction in a block…</p>
      )}

      {status === "confirmed" && tx?.block_index != null && (
        <div className="vn-status__detail">
          <span className="vn-status__detail-label">Confirmed in block</span>
          <Link className="vn-block-link" to={`/block/${tx.block_hash || tx.block_index}`}>
            #{formatNumber(tx.block_index)}
          </Link>
        </div>
      )}

      <div className="vn-btn-row" style={{ marginTop: 18 }}>
        {tx?.tx_id && (
          <Button variant="secondary" to={`/tx/${tx.tx_id}`}>
            View transaction
          </Button>
        )}
        <Button variant="primary" onClick={onReset}>
          Send another
        </Button>
      </div>
    </div>
  );
}
