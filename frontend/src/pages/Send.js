import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";

import ErrorMessage from "../components/ErrorMessage";
import QRPayment from "../components/QRPayment";
import { useAuth } from "../context/AuthContext";
import api from "../helpers/api";
import { validateTransactionReview } from "../helpers/address";
import { apiErrorMessage } from "../helpers/errors";
import { signTransaction } from "../helpers/signer";
import { loadWallet } from "../helpers/storage";

const DUPLICATE_WINDOW_MS = 60_000;

const initialForm = {
  senderAddress: "",
  senderPrivateKey: "",
  senderPublicKey: "",
  receiverAddress: "",
  amount: "",
};

function Send() {
  const { isLoggedIn, wallet } = useAuth();
  const [form, setForm] = useState(initialForm);
  const [walletPassword, setWalletPassword] = useState("");
  const [sending, setSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [submittedTransaction, setSubmittedTransaction] = useState(null);
  const [step, setStep] = useState("details");
  const [balance, setBalance] = useState(null);
  const [lastSubmitted, setLastSubmitted] = useState(null);
  const [duplicateOverride, setDuplicateOverride] = useState(false);

  useEffect(() => {
    if (isLoggedIn && wallet?.address) {
      setForm((current) => ({
        ...current,
        senderAddress: wallet.address,
        senderPublicKey: wallet.public_key,
        senderPrivateKey: "",
      }));
    }
  }, [isLoggedIn, wallet]);

  useEffect(() => {
    let mounted = true;
    async function loadBalanceForReview() {
      if (!isLoggedIn || !wallet?.address) {
        setBalance(null);
        return;
      }
      try {
        const response = await api.get("/wallet/balance", { params: { address: wallet.address } });
        if (mounted) setBalance(Number(response.data?.balance ?? 0));
      } catch {
        if (mounted) setBalance(null);
      }
    }
    loadBalanceForReview();
    return () => {
      mounted = false;
    };
  }, [isLoggedIn, wallet?.address]);

  const review = useMemo(
    () =>
      validateTransactionReview({
        senderAddress: form.senderAddress,
        receiverAddress: form.receiverAddress,
        amount: form.amount,
        balance,
      }),
    [balance, form.amount, form.receiverAddress, form.senderAddress]
  );

  const transactionFingerprint = useMemo(() => {
    return [
      form.senderAddress.trim(),
      form.receiverAddress.trim(),
      Number(form.amount),
    ].join("|");
  }, [form.amount, form.receiverAddress, form.senderAddress]);

  const duplicateAttempt =
    lastSubmitted?.fingerprint === transactionFingerprint &&
    Date.now() - lastSubmitted.submittedAt < DUPLICATE_WINDOW_MS;

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
    setSubmittedTransaction(null);
    setDuplicateOverride(false);
    if (step !== "details") setStep("details");
  }

  function handleQrScan(payment) {
    setForm((current) => ({
      ...current,
      receiverAddress: payment.to,
      amount: payment.amount || current.amount,
    }));
    setScannerOpen(false);
    setSubmittedTransaction(null);
    setStep("details");
  }

  function continueToReview(event) {
    event.preventDefault();
    setErrorMessage("");

    if (!form.senderAddress.trim() || !form.senderPublicKey.trim() || !form.receiverAddress.trim() || !form.amount) {
      toast.error("Fill in every transaction field.");
      return;
    }

    if (!review.canSubmit) {
      const message = review.errors[0] || "Review the transaction details before continuing.";
      setErrorMessage(message);
      toast.error(message);
      return;
    }

    setStep("review");
  }

  async function sendVlq(event) {
    event.preventDefault();

    if (sending) return;
    if (!review.canSubmit) {
      const message = review.errors[0] || "Review the transaction details before sending.";
      setErrorMessage(message);
      toast.error(message);
      return;
    }

    if (duplicateAttempt && !duplicateOverride) {
      const message = "This matches a transaction you just submitted. Confirm that you want to send the same details again.";
      setErrorMessage(message);
      toast.error(message);
      return;
    }

    if (isLoggedIn && !walletPassword) {
      toast.error("Enter your wallet password to sign this transaction locally.");
      return;
    }

    if (!isLoggedIn && !form.senderPrivateKey.trim()) {
      toast.error("Enter the sender private key for manual signing.");
      return;
    }

    setSending(true);
    try {
      const senderPrivateKey = isLoggedIn
        ? (await loadWallet(walletPassword)).private_key
        : form.senderPrivateKey.trim();
      const payload = await signTransaction({
        senderAddress: review.sender.address,
        senderPrivateKey,
        senderPublicKey: form.senderPublicKey.trim(),
        receiverAddress: review.receiver.address,
        amount: form.amount,
      });
      const response = await api.post("/transaction/send", payload);

      if (response.data?.success === false) {
        throw new Error(response.data.error || response.data.message || "Transaction was rejected.");
      }

      const transaction = response.data.transaction || { tx_id: response.data.tx_id, status: "pending" };
      setSubmittedTransaction(transaction);
      setLastSubmitted({
        fingerprint: transactionFingerprint,
        txId: transaction.tx_id || response.data.tx_id,
        submittedAt: Date.now(),
      });
      toast.success("Transaction signed locally and submitted to the pending pool.");
      setErrorMessage("");
      setWalletPassword("");
      setStep("result");
      setDuplicateOverride(false);
      setForm(
        isLoggedIn && wallet?.address
          ? { ...initialForm, senderAddress: wallet.address, senderPublicKey: wallet.public_key }
          : initialForm
      );
    } catch (error) {
      const message = apiErrorMessage(error, "Unable to send VLQ.");
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setSending(false);
      setWalletPassword("");
      if (!isLoggedIn) {
        setForm((current) => ({ ...current, senderPrivateKey: "" }));
      }
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

  return (
    <div className="page">
      <section className="hero">
        <span className="eyebrow">Send VLQ</span>
        <h1>Sign and submit a transaction</h1>
        <p className="subtitle">
          Transactions are signed locally in your browser before they are submitted to the
          Vorliq blockchain API.
        </p>
      </section>

      <ErrorMessage message={errorMessage} />

      <section className="card card-pad">
        <div className="section-title">
          <div>
            <span className="eyebrow">Step {step === "details" ? "1" : step === "review" ? "2" : "3"} of 3</span>
            <h2>{step === "details" ? "Enter Transaction Details" : step === "review" ? "Review Transaction" : "Pending Transaction"}</h2>
          </div>
          {step === "details" && (
            <button className="button secondary compact" type="button" onClick={() => setScannerOpen((current) => !current)}>
              {scannerOpen ? "Close Scanner" : "Scan QR Code"}
            </button>
          )}
        </div>

        {scannerOpen && step === "details" && (
          <div className="scanner-panel">
            <QRPayment
              walletAddress={form.senderAddress || "scan-mode"}
              defaultScanMode
              onScanComplete={handleQrScan}
            />
          </div>
        )}

        {step === "details" && (
          <>
            {isLoggedIn ? (
              <div className="wallet-safety-box">
                <strong>Signed with your saved wallet</strong>
                <p>
                  Your private key stays in this browser. It is decrypted locally after password
                  confirmation only long enough to sign this transaction, and it is not sent to
                  the backend.
                </p>
              </div>
            ) : (
              <div className="private-key-warning">
                <strong>Manual private key mode</strong>
                <p>
                  Avoid manual mode unless necessary. Pasted private keys are never saved by this
                  form and are cleared after a send attempt, but any private key exposure can put
                  the wallet at risk.
                </p>
              </div>
            )}

            <form className="form" onSubmit={continueToReview}>
              <div className="field">
                <label htmlFor="sender-address">Sender Address</label>
                <input
                  id="sender-address"
                  className="input"
                  type="text"
                  value={form.senderAddress}
                  onChange={(event) => updateField("senderAddress", event.target.value)}
                  autoComplete="off"
                  readOnly={isLoggedIn}
                />
              </div>

              {!isLoggedIn && (
                <div className="field">
                  <label htmlFor="sender-private-key">Sender Private Key</label>
                  <textarea
                    id="sender-private-key"
                    className="textarea"
                    value={form.senderPrivateKey}
                    onChange={(event) => updateField("senderPrivateKey", event.target.value)}
                    autoComplete="off"
                  />
                  <p className="warning">Do not paste a private key on untrusted sites. Vorliq cannot recover stolen funds.</p>
                </div>
              )}

              <div className="field">
                <label htmlFor="sender-public-key">Sender Public Key</label>
                <textarea
                  id="sender-public-key"
                  className="textarea"
                  value={form.senderPublicKey}
                  onChange={(event) => updateField("senderPublicKey", event.target.value)}
                  autoComplete="off"
                  readOnly={isLoggedIn}
                />
              </div>

              <div className="field">
                <label htmlFor="receiver-address">Receiver Address</label>
                <input
                  id="receiver-address"
                  className="input"
                  type="text"
                  value={form.receiverAddress}
                  onChange={(event) => updateField("receiverAddress", event.target.value)}
                  autoComplete="off"
                />
                {form.receiverAddress.trim() && (
                  <p className={review.receiver.looksValid ? "help-text" : "warning"}>
                    Receiver address {review.receiver.looksValid ? "looks valid." : "needs careful review."}
                  </p>
                )}
              </div>

              <div className="field">
                <label htmlFor="amount">Amount of VLQ</label>
                <input
                  id="amount"
                  className="input"
                  type="number"
                  min="0.000001"
                  step="0.000001"
                  value={form.amount}
                  onChange={(event) => updateField("amount", event.target.value)}
                />
                {Number.isFinite(Number(balance)) && <p className="help-text">Confirmed balance available for review: {balance} VLQ.</p>}
              </div>

              {review.errors.map((error) => (
                <p className="warning" key={error}>{error}</p>
              ))}
              {review.warnings.map((warning) => (
                <p className="warning" key={warning}>{warning}</p>
              ))}

              <button className="button" type="submit">
                Review Transaction
              </button>
            </form>
          </>
        )}

        {step === "review" && (
          <form className="form" onSubmit={sendVlq}>
            <div className="wallet-safety-box">
              <strong>Confirm and send</strong>
              <p>
                Transactions cannot be reversed. Verify the receiver address and amount before
                signing. Status will be pending until a miner includes the transaction in a block.
              </p>
            </div>

            <div className="grid explorer-summary-grid">
              <ReviewItem label="Sender address" value={review.sender.address} />
              <ReviewItem label="Receiver address" value={review.receiver.address} />
              <ReviewItem label="Amount" value={`${review.amount} VLQ`} />
              <ReviewItem label="Estimated status" value="Pending until mined" />
              <ReviewItem label="Receiver validation" value={review.receiver.looksValid ? "Looks valid" : "Warnings present"} />
              <ReviewItem label="Local signing" value={isLoggedIn ? "Private key stays in browser" : "Manual key is not persisted"} />
            </div>

            {review.errors.map((error) => (
              <p className="warning" key={error}>{error}</p>
            ))}
            {review.warnings.map((warning) => (
              <p className="warning" key={warning}>{warning}</p>
            ))}

            {duplicateAttempt && (
              <label className="checkbox-row private-key-warning">
                <input
                  type="checkbox"
                  checked={duplicateOverride}
                  onChange={(event) => setDuplicateOverride(event.target.checked)}
                />
                <span>I understand this repeats the same send details submitted moments ago.</span>
              </label>
            )}

            {isLoggedIn && (
              <div className="field">
                <label htmlFor="wallet-password">Wallet Password</label>
                <input
                  id="wallet-password"
                  className="input"
                  type="password"
                  value={walletPassword}
                  onChange={(event) => setWalletPassword(event.target.value)}
                  autoComplete="current-password"
                />
                <p className="help-text">Your private key stays in browser storage and is never sent to the backend.</p>
              </div>
            )}

            <div className="button-row">
              <button className="button secondary" type="button" onClick={() => setStep("details")} disabled={sending}>
                Back
              </button>
              <button className="button" type="submit" disabled={sending || !review.canSubmit || (duplicateAttempt && !duplicateOverride)}>
                {sending ? "Sending..." : "Confirm and Send"}
              </button>
            </div>
          </form>
        )}

        {step === "result" && submittedTransaction?.tx_id && (
          <div className="success-box transaction-submit-result">
            <strong>Transaction submitted to the pending pool</strong>
            <p>
              Transaction ID: <span className="hash-text">{submittedTransaction.tx_id}</span>
            </p>
            <p>
              Status: pending. Mining confirmation is required before this transaction is
              confirmed in a block.
            </p>
            <div className="button-row">
              <button className="button secondary small-button" type="button" onClick={() => copyText(submittedTransaction.tx_id, "Transaction ID")}>
                Copy Tx ID
              </button>
              <Link className="button secondary small-button" to={`/tx/${submittedTransaction.tx_id}`}>
                Open Transaction Detail
              </Link>
              <button className="button small-button" type="button" onClick={() => setStep("details")}>
                Send Another
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function ReviewItem({ label, value }) {
  return (
    <div className="meta-item">
      <span className="meta-label">{label}</span>
      <span className="meta-value">{value}</span>
    </div>
  );
}

export default Send;
