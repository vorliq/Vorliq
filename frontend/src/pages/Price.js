import { useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";

import ErrorMessage from "../components/ErrorMessage";
import RiskNotice from "../components/RiskNotice";
import Spinner from "../components/Spinner";
import api from "../helpers/api";
import { apiErrorMessage } from "../helpers/errors";

const currencies = ["GBP", "USD", "EUR"];

function Price() {
  const [signals, setSignals] = useState([]);
  const [medians, setMedians] = useState({});
  const [form, setForm] = useState({ walletAddress: "", currency: "", priceValue: "" });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function loadPriceData() {
    try {
      const [signalsResponse, ...medianResponses] = await Promise.all([
        api.get("/price/signals"),
        ...currencies.map((currency) => api.get("/price/median", { params: { currency } })),
      ]);
      setSignals(signalsResponse.data.signals || []);
      setMedians(
        Object.fromEntries(medianResponses.map((response) => [response.data.currency, response.data]))
      );
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(apiErrorMessage(error, "Unable to load price signals."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPriceData();
  }, []);

  async function submitSignal(event) {
    event.preventDefault();
    if (!form.walletAddress.trim() || !form.currency.trim() || !form.priceValue) {
      toast.error("Enter your wallet address, currency, and price value.");
      return;
    }

    setSubmitting(true);
    try {
      await api.post("/price/signal", {
        submitter_address: form.walletAddress.trim(),
        currency: form.currency.trim(),
        price_value: Number(form.priceValue),
      });
      toast.success("Price signal submitted.");
      setForm({ walletAddress: "", currency: "", priceValue: "" });
      await loadPriceData();
    } catch (error) {
      const message = apiErrorMessage(error, "Unable to submit price signal.");
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  const sortedSignals = useMemo(
    () => [...signals].sort((a, b) => Number(b.timestamp) - Number(a.timestamp)),
    [signals]
  );

  if (loading) {
    return (
      <div className="page">
        <Spinner label="Loading price discovery..." />
      </div>
    );
  }

  return (
    <div className="page">
      <section className="hero">
        <span className="eyebrow">Community Sentiment</span>
        <h1>VLQ Price Discovery</h1>
        <p className="subtitle">
          Share what VLQ is worth in your local currency, goods, services, or time. These are
          community signals, not a centralized oracle or official exchange rate.
        </p>
      </section>

      <ErrorMessage message={errorMessage} />
      <RiskNotice />

      <section className="grid two-column">
        <div className="card card-pad stack">
          <h2>Community Price Signals</h2>
          {sortedSignals.length === 0 ? (
            <div className="empty-state">No active price signals yet.</div>
          ) : (
            sortedSignals.map((signal) => (
              <article className="reply-card" key={signal.signal_id}>
                <strong>{signal.price_value} {signal.currency}</strong>
                <span>Submitted by {shortAddress(signal.submitter_address)} · {timeAgo(signal.timestamp)}</span>
              </article>
            ))
          )}
        </div>

        <div className="card card-pad stack">
          <h2>Submit a Price Signal</h2>
          <form className="form" onSubmit={submitSignal}>
            <div className="field">
              <label>Wallet Address</label>
              <input className="input" value={form.walletAddress} onChange={(event) => setForm((current) => ({ ...current, walletAddress: event.target.value }))} />
            </div>
            <div className="field">
              <label>Currency or Unit</label>
              <input className="input" placeholder="GBP USD EUR hours" value={form.currency} onChange={(event) => setForm((current) => ({ ...current, currency: event.target.value }))} />
            </div>
            <div className="field">
              <label>Price Value</label>
              <input className="input" type="number" min="0" step="0.0001" value={form.priceValue} onChange={(event) => setForm((current) => ({ ...current, priceValue: event.target.value }))} />
            </div>
            <button className="button" type="submit" disabled={submitting}>
              {submitting ? "Submitting..." : "Submit Signal"}
            </button>
          </form>
        </div>
      </section>

      <section className="card card-pad stats-section">
        <h2>Median Prices</h2>
        <div className="grid stats-grid">
          {currencies.map((currency) => {
            const median = medians[currency];
            return (
              <div className="card card-pad stat-card compact-stat" key={currency}>
                <span className="stat-label">{currency}</span>
                <span className="stat-value">
                  {median?.has_enough_data ? `${median.median_price} ${currency}` : "Not enough data yet"}
                </span>
                <p>{median?.signal_count || 0} active signals</p>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function shortAddress(address) {
  return address && address.length > 12 ? `${address.slice(0, 12)}...` : address || "Unknown";
}

function timeAgo(timestamp) {
  const seconds = Math.max(Math.floor(Date.now() / 1000 - Number(timestamp)), 0);
  if (seconds < 60) return `${seconds} seconds ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hours ago`;
}

export default Price;
