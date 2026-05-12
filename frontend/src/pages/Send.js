import { useState } from "react";
import { toast } from "react-toastify";

import api from "../helpers/api";
import { signTransaction } from "../helpers/signer";

const initialForm = {
  senderAddress: "",
  senderPrivateKey: "",
  senderPublicKey: "",
  receiverAddress: "",
  amount: "",
};

function Send() {
  const [form, setForm] = useState(initialForm);
  const [sending, setSending] = useState(false);

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function sendVlq(event) {
    event.preventDefault();

    if (
      !form.senderAddress.trim() ||
      !form.senderPrivateKey.trim() ||
      !form.senderPublicKey.trim() ||
      !form.receiverAddress.trim() ||
      !form.amount
    ) {
      toast.error("Fill in every transaction field.");
      return;
    }

    setSending(true);
    try {
      const payload = await signTransaction({
        senderAddress: form.senderAddress.trim(),
        senderPrivateKey: form.senderPrivateKey.trim(),
        senderPublicKey: form.senderPublicKey.trim(),
        receiverAddress: form.receiverAddress.trim(),
        amount: form.amount,
      });
      const response = await api.post("/transaction/send", payload);

      if (response.data?.success === false) {
        throw new Error(response.data.error || "Transaction was rejected.");
      }

      toast.success("Transaction signed and sent to the pending pool.");
      setForm(initialForm);
    } catch (error) {
      toast.error(error.response?.data?.error || error.message || "Unable to send VLQ.");
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="page">
      <section className="hero">
        <span className="eyebrow">Send VLQ</span>
        <h1>Sign and submit a transaction</h1>
        <p className="subtitle">
          Transactions are signed locally in your browser before they are submitted to the
          Vorliq blockchain API.
        </p>
      </section>

      <section className="card card-pad">
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
            />
          </div>

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

          <div className="field">
            <label htmlFor="sender-public-key">Sender Public Key</label>
            <textarea
              id="sender-public-key"
              className="textarea"
              value={form.senderPublicKey}
              onChange={(event) => updateField("senderPublicKey", event.target.value)}
              autoComplete="off"
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

          <button className="button" type="submit" disabled={sending}>
            {sending ? "Sending..." : "Send VLQ"}
          </button>
        </form>
      </section>
    </main>
  );
}

export default Send;
