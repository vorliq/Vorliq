import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "react-toastify";

import AddressIdentity from "../components/AddressIdentity";
import ErrorMessage from "../components/ErrorMessage";
import Spinner from "../components/Spinner";
import { useAuth } from "../context/AuthContext";
import api from "../helpers/api";
import { apiErrorMessage } from "../helpers/errors";

function Faucet() {
  const { wallet } = useAuth();
  const [searchParams] = useSearchParams();
  const queryAddress = searchParams.get("address") || "";
  const [summary, setSummary] = useState(null);
  const [recentClaims, setRecentClaims] = useState([]);
  const [myClaims, setMyClaims] = useState([]);
  const [walletAddress, setWalletAddress] = useState(wallet?.address || queryAddress || "");
  const [claiming, setClaiming] = useState(false);
  const [loading, setLoading] = useState(true);
  const [claimResult, setClaimResult] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (wallet?.address || queryAddress) {
      setWalletAddress(wallet?.address || queryAddress);
    }
  }, [queryAddress, wallet?.address]);

  useEffect(() => {
    loadFaucet();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadFaucet(address = walletAddress) {
    setLoading(true);
    try {
      const [summaryResponse, recentResponse] = await Promise.all([
        api.get("/faucet/summary"),
        api.get("/faucet/recent", { params: { limit: 10 } }),
      ]);
      setSummary(summaryResponse.data.summary || {});
      setRecentClaims(recentResponse.data.claims || []);
      if (address?.trim()) {
        const claimsResponse = await api.get("/faucet/claims", { params: { address: address.trim() } });
        setMyClaims(claimsResponse.data.claims || []);
      }
      setErrorMessage("");
    } catch (error) {
      const message = apiErrorMessage(error, "Unable to load faucet data.");
      setErrorMessage(message);
    } finally {
      setLoading(false);
    }
  }

  async function submitClaim(event) {
    event.preventDefault();
    const address = walletAddress.trim();
    if (!address) {
      toast.error("Enter a wallet address first.");
      return;
    }

    setClaiming(true);
    setClaimResult(null);
    try {
      const response = await api.post("/faucet/claim", { wallet_address: address });
      setClaimResult(response.data.claim);
      toast.success("Starter VLQ claim submitted.");
      await loadFaucet(address);
    } catch (error) {
      const claim = error.response?.data?.claim;
      if (claim) {
        setClaimResult(claim);
      }
      const message = apiErrorMessage(error, "Unable to submit faucet claim.");
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setClaiming(false);
    }
  }

  return (
    <div className="page">
      <section className="hero">
        <span className="eyebrow">Starter VLQ</span>
        <h1>Starter VLQ Faucet</h1>
        <p className="subtitle">
          The faucet sends a small starter amount from the community treasury when funds are available. It does not mint new VLQ, and the transaction must be mined before it is confirmed.
        </p>
        <p className="help-text">
          <Link to="/vlq">See how starter VLQ moves from pending to confirmed.</Link>
        </p>
      </section>

      <ErrorMessage message={errorMessage} />

      {loading ? (
        <Spinner label="Loading faucet..." />
      ) : (
        <section className="grid stats-grid" aria-label="Faucet summary">
          <div className="card card-pad stat-card">
            <span className="stat-label">Starter Amount</span>
            <span className="stat-value">{summary?.starter_amount ?? 1} VLQ</span>
          </div>
          <div className="card card-pad stat-card">
            <span className="stat-label">Treasury Balance</span>
            <span className="stat-value">{summary?.treasury_balance ?? 0} VLQ</span>
          </div>
          <div className="card card-pad stat-card">
            <span className="stat-label">Pending Claims</span>
            <span className="stat-value">{summary?.pending_claims ?? 0}</span>
          </div>
          <div className="card card-pad stat-card">
            <span className="stat-label">Confirmed Claims</span>
            <span className="stat-value">{summary?.confirmed_claims ?? 0}</span>
          </div>
        </section>
      )}

      <section className="card card-pad stack">
        <div className="section-title">
          <div>
            <span className="eyebrow">Claim</span>
            <h2>Request Starter VLQ</h2>
          </div>
        </div>
        <p className="help-text">
          Claims are limited to one per wallet every 24 hours and three per request fingerprint every 24 hours. Vorliq never asks for your private key for faucet claims.
        </p>
        <form className="form" onSubmit={submitClaim}>
          <div className="field">
            <label htmlFor="faucet-wallet">Wallet Address</label>
            <input
              id="faucet-wallet"
              className="input"
              value={walletAddress}
              onChange={(event) => setWalletAddress(event.target.value)}
              autoComplete="off"
              placeholder="Paste your VLQ wallet address"
            />
          </div>
          <button className="button" type="submit" disabled={claiming}>
            {claiming ? "Submitting..." : "Claim Starter VLQ"}
          </button>
        </form>

        {claimResult && (
          <div className="value-box">
            Status: {claimResult.status}
            {"\n"}
            Amount: {claimResult.amount} VLQ
            {"\n"}
            {claimResult.reason}
            {claimResult.tx_id && (
              <>
                {"\n"}
                Transaction: <Link to={`/tx/${claimResult.tx_id}`}>{claimResult.tx_id}</Link>
              </>
            )}
          </div>
        )}
      </section>

      <section className="grid two-column">
        <ClaimList title="My Faucet Claims" claims={myClaims} empty="No faucet claims found for this wallet yet." />
        <ClaimList title="Recent Public Claims" claims={recentClaims} empty="No public faucet claims yet." />
      </section>
    </div>
  );
}

function ClaimList({ title, claims, empty }) {
  return (
    <section className="card card-pad stack faucet-claim-list">
      <h2>{title}</h2>
      {claims.length === 0 ? (
        <div className="empty-state">{empty}</div>
      ) : (
        <div className="history-list">
          {claims.map((claim) => (
            <div className="history-row faucet-claim-row" key={claim.claim_id}>
              <div className="faucet-claim-status">
                <span className={`status-badge ${claim.status}`}>{formatClaimStatus(claim.status)}</span>
              </div>
              <div className="faucet-claim-member">
                <span className="meta-label">Claimant</span>
                <AddressIdentity address={claim.wallet_address} compact />
              </div>
              <div className="faucet-claim-amount">
                <span className="meta-label">Amount</span>
                <strong>{claim.amount} VLQ</strong>
              </div>
              <div className="faucet-claim-tx">
                <span className="meta-label">Transaction</span>
                {claim.tx_id ? <Link className="hash-text" to={`/tx/${claim.tx_id}`}>View Tx</Link> : <span>No tx</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function formatClaimStatus(status) {
  if (!status) return "Unknown";
  return String(status).replace(/_/g, " ");
}

export default Faucet;
