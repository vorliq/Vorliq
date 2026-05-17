import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";

import ErrorMessage from "../components/ErrorMessage";
import QRPayment from "../components/QRPayment";
import { useAuth } from "../context/AuthContext";
import api from "../helpers/api";
import { apiErrorMessage } from "../helpers/errors";
import { signTransaction } from "../helpers/signer";
import { loadWallet } from "../helpers/storage";

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

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function handleQrScan(payment) {
    setForm((current) => ({
      ...current,
      receiverAddress: payment.to,
      amount: payment.amount || current.amount,
    }));
    setScannerOpen(false);
  }

  async function sendVlq(event) {
    event.preventDefault();

    if (!form.senderAddress.trim() || !form.senderPublicKey.trim() || !form.receiverAddress.trim() || !form.amount) {
      toast.error("Fill in every transaction field.");
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
        senderAddress: form.senderAddress.trim(),
        senderPrivateKey,
        senderPublicKey: form.senderPublicKey.trim(),
        receiverAddress: form.receiverAddress.trim(),
        amount: form.amount,
      });
      const response = await api.post("/transaction/send", payload);

      if (response.data?.success === false) {
        throw new Error(response.data.error || "Transaction was rejected.");
      }

      setSubmittedTransaction(response.data.transaction || { tx_id: response.data.tx_id, status: "pending" });
      toast.success("Transaction signed and sent to the pending pool.");
      setErrorMessage("");
      setWalletPassword("");
      setForm(isLoggedIn && wallet?.address ? { ...initialForm, senderAddress: wallet.address, senderPublicKey: wallet.public_key } : initialForm);
    } catch (error) {
      const message = apiErrorMessage(error, "Unable to send VLQ.");
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setSending(false);
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
          <h2>Payment Details</h2>
          <button className="button secondary compact" type="button" onClick={() => setScannerOpen((current) => !current)}>
            {scannerOpen ? "Close Scanner" : "Scan QR Code"}
          </button>
        </div>

        {scannerOpen && (
          <div className="scanner-panel">
            <QRPayment
              walletAddress={form.senderAddress || "scan-mode"}
              defaultScanMode
              onScanComplete={handleQrScan}
            />
          </div>
        )}

        {isLoggedIn ? (
          <div className="wallet-safety-box">
            <strong>Signed with your saved wallet</strong>
            <p>
              Your sender address and public key are filled from your unlocked account. Enter
              your wallet password only when you are ready to sign; the private key is decrypted
              locally for this transaction and is not shown on the page.
            </p>
          </div>
        ) : (
          <div className="private-key-warning">
            <strong>Manual private key mode</strong>
            <p>
              Pasting private keys into any website is risky. Use manual mode only on trusted
              local Vorliq nodes or the official https://vorliq.org app, and never share your key.
            </p>
          </div>
        )}

        <form className="form" onSubmit={sendVlq}>
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
          </div>

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
            </div>
          )}

          <button className="button" type="submit" disabled={sending}>
            {sending ? "Sending..." : "Send VLQ"}
          </button>
          <p className="help-text">
            Saved wallets sign locally after password confirmation. Manual mode is available
            only when you are not logged in.
          </p>
        </form>

        {submittedTransaction?.tx_id && (
          <div className="success-box transaction-submit-result">
            <strong>Transaction submitted to the pending pool</strong>
            <p>
              Transaction ID: <span className="hash-text">{submittedTransaction.tx_id}</span>
            </p>
            <p>
              Status is pending until a miner includes it in a valid block. Mining confirms
              pending transactions.
            </p>
            <Link className="button secondary small-button" to={`/tx/${submittedTransaction.tx_id}`}>
              View Transaction
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}

export default Send;
