import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";

import AddressIdentity from "../components/AddressIdentity";
import AuthorityWriteNotice, { AUTHORITY_WRITES_DISABLED } from "../components/AuthorityWriteNotice";
import ErrorMessage from "../components/ErrorMessage";
import RiskNotice from "../components/RiskNotice";
import Spinner from "../components/Spinner";
import { useAuth } from "../context/AuthContext";
import { useNotifications } from "../context/NotificationContext";
import api from "../helpers/api";
import { apiErrorMessage } from "../helpers/errors";

const initialRequest = {
  requesterAddress: "",
  amount: "",
  reason: "",
};

const tabs = [
  ["request", "Request Loan"],
  ["votes", "Active Votes"],
  ["active", "Active Loans"],
  ["mine", "My Loans"],
  ["history", "Loan History"],
];

const lifecycleSteps = [
  {
    status: "pending_vote",
    title: "Pending vote",
    body: "This request is awaiting votes. No lending pool VLQ has moved yet.",
  },
  {
    status: "approved_pending_issue",
    title: "Approved, pending issuance",
    body: "The vote passed and an issuance transaction is waiting for mining confirmation.",
  },
  {
    status: "active",
    title: "Active",
    body: "Issuance is confirmed on-chain and repayment is expected by the due block.",
  },
  {
    status: "repayment_pending",
    title: "Repayment pending",
    body: "A repayment transaction is visible but still pending mining confirmation.",
  },
  {
    status: "repaid",
    title: "Repaid",
    body: "Repayment has been confirmed on-chain.",
  },
  {
    status: "overdue",
    title: "Overdue",
    body: "The due block has passed and repayment is still needed or unconfirmed.",
  },
  {
    status: "rejected",
    title: "Rejected",
    body: "The loan did not pass voting and no issuance should occur.",
  },
  {
    status: "expired",
    title: "Expired",
    body: "The request is no longer open and should not issue VLQ.",
  },
  {
    status: "cancelled",
    title: "Cancelled",
    body: "The request was cancelled and should not issue VLQ.",
  },
];

const historyStatuses = new Set(["repaid", "rejected", "expired", "cancelled"]);

function Lending() {
  const { isLoggedIn, wallet } = useAuth();
  const { addNotification } = useNotifications();
  const previousLoanStatusesRef = useRef(null);
  const [activeTab, setActiveTab] = useState("request");
  const [requestForm, setRequestForm] = useState(initialRequest);
  const [myAddress, setMyAddress] = useState(wallet?.address || "");
  const [loans, setLoans] = useState([]);
  const [myLoans, setMyLoans] = useState({ borrowed: [], voted: [], loans: [] });
  const [summary, setSummary] = useState(null);
  const [loadingLoans, setLoadingLoans] = useState(true);
  const [loadingMyLoans, setLoadingMyLoans] = useState(false);
  const [submittingRequest, setSubmittingRequest] = useState(false);
  const [loanActionId, setLoanActionId] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  async function loadLoans({ quiet = false } = {}) {
    try {
      const [loansResponse, summaryResponse] = await Promise.all([
        api.get("/lending/loans", { params: { limit: 200 } }),
        api.get("/lending/summary"),
      ]);
      setLoans(loansResponse.data.loans || []);
      setSummary(summaryResponse.data.summary || null);
      setErrorMessage("");
    } catch (error) {
      if (!quiet) {
        const message = apiErrorMessage(error, "Unable to load lending lifecycle.");
        setErrorMessage(message);
        toast.error(message);
      }
    } finally {
      setLoadingLoans(false);
    }
  }

  async function loadMyLoans(address = myAddress, { quiet = false } = {}) {
    if (!address.trim()) {
      setMyLoans({ borrowed: [], voted: [], loans: [] });
      return;
    }
    setLoadingMyLoans(true);
    try {
      const response = await api.get("/lending/my", { params: { address: address.trim() } });
      setMyLoans({
        borrowed: response.data.borrowed || [],
        voted: response.data.voted || [],
        loans: response.data.loans || [],
      });
      setErrorMessage("");
    } catch (error) {
      if (!quiet) {
        const message = apiErrorMessage(error, "Unable to load member loans.");
        setErrorMessage(message);
        toast.error(message);
      }
    } finally {
      setLoadingMyLoans(false);
    }
  }

  useEffect(() => {
    loadLoans();
  }, []);

  useEffect(() => {
    if (wallet?.address && !myAddress) {
      setMyAddress(wallet.address);
    }
  }, [myAddress, wallet?.address]);

  useEffect(() => {
    if (!isLoggedIn || !wallet?.address || loadingLoans) {
      return;
    }

    const ownedLoans = loans.filter((loan) => loan.requester_address === wallet.address);
    const currentStatuses = new Map(ownedLoans.map((loan) => [loan.loan_id, loan.status]));

    if (previousLoanStatusesRef.current === null) {
      previousLoanStatusesRef.current = currentStatuses;
      return;
    }

    ownedLoans.forEach((loan) => {
      const previousStatus = previousLoanStatusesRef.current.get(loan.loan_id);
      if (previousStatus === "pending_vote" && loan.status === "approved_pending_issue") {
        addNotification(
          "success",
          "Loan approved",
          `Loan ${loan.loan_id.slice(0, 12)} has an issuance transaction waiting to be mined.`
        );
      }
      if (previousStatus === "approved_pending_issue" && loan.status === "active") {
        addNotification(
          "success",
          "Loan active",
          `Loan ${loan.loan_id.slice(0, 12)} was confirmed on-chain.`
        );
      }
    });

    previousLoanStatusesRef.current = currentStatuses;
  }, [addNotification, isLoggedIn, loadingLoans, loans, wallet]);

  const buckets = useMemo(() => ({
    activeVotes: loans.filter((loan) => loan.status === "pending_vote"),
    activeLoans: loans.filter((loan) => ["approved_pending_issue", "active", "repayment_pending", "overdue"].includes(loan.status)),
    history: loans.filter((loan) => historyStatuses.has(loan.status)),
  }), [loans]);

  function updateRequest(field, value) {
    setRequestForm((current) => ({ ...current, [field]: value }));
  }

  async function submitLoanRequest(event) {
    event.preventDefault();

    if (!requestForm.requesterAddress.trim() || !requestForm.amount || !requestForm.reason.trim()) {
      toast.error("Fill in every loan request field.");
      return;
    }

    setSubmittingRequest(true);
    try {
      const response = await api.post("/lending/request", {
        requester_address: requestForm.requesterAddress.trim(),
        amount: Number(requestForm.amount),
        reason: requestForm.reason.trim(),
      });
      toast.success(`Loan request submitted: ${response.data.loan_id}`);
      setErrorMessage("");
      setRequestForm(initialRequest);
      setActiveTab("votes");
      await loadLoans({ quiet: true });
      await loadMyLoans(myAddress || requestForm.requesterAddress, { quiet: true });
    } catch (error) {
      const message = apiErrorMessage(error, "Unable to submit loan request.");
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setSubmittingRequest(false);
    }
  }

  async function castVote(loan, vote) {
    const voterAddress = myAddress.trim() || wallet?.address || "";
    if (!voterAddress) {
      toast.error("Enter your wallet address in My Loans before voting.");
      setActiveTab("mine");
      return;
    }

    setLoanActionId(`${loan.loan_id}:vote:${vote}`);
    try {
      const response = await api.post("/lending/vote", {
        loan_id: loan.loan_id,
        voter_address: voterAddress,
        voter_wallet_address: voterAddress,
        vote,
      });
      const issuanceTx = response.data.issuance_tx_id;
      toast.success(issuanceTx ? "Vote cast. Loan issuance is pending mining." : "Vote cast.");
      setErrorMessage("");
      await loadLoans({ quiet: true });
      await loadMyLoans(voterAddress, { quiet: true });
    } catch (error) {
      const message = apiErrorMessage(error, "Unable to cast vote.");
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setLoanActionId("");
    }
  }

  return (
    <div className="page">
      <section className="hero">
        <span className="eyebrow">Community Lending</span>
        <h1>Lending</h1>
        <p className="subtitle">
          Review community lending requests, VLQ-weighted vote records, and each loan from pending vote through confirmed repayment.
        </p>
        <p className="help-text">
          <Link to="/vlq">Review how VLQ lending movement becomes confirmed.</Link>{" "}
          <Link to="/blockchain">Open explorer.</Link>
        </p>
      </section>

      <ErrorMessage message={errorMessage} />
      <AuthorityWriteNotice />
      <RiskNotice />

      <section className="grid lending-guide-grid">
        <div className="card card-pad stack">
          <span className="eyebrow">Read-only status</span>
          <h2>Lending lifecycle</h2>
          <p className="help-text">
            Lending records come from the existing public lending APIs. Counts and loans are shown only when those APIs return data; missing data is marked unavailable rather than shown as zero.
          </p>
          <div className="lifecycle-grid">
            {lifecycleSteps.map((step) => (
              <div className="lifecycle-step" key={step.status}>
                <span className={`status-badge ${step.status}`}>{step.title}</span>
                <p>{step.body}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="card card-pad stack">
          <span className="eyebrow">Wallet actions</span>
          <h2>Wallet requirements</h2>
          <p className="help-text">
            Loan request and vote writes remain disabled until signed wallet authorization is verified.
            Repayment is a VLQ movement, so use the Send page to review and sign locally with a saved wallet.
          </p>
          <div className="button-row">
            <Link className="button small-button" to={isLoggedIn ? "/send" : "/login"}>
              {isLoggedIn ? "Open Send Review" : "Unlock Wallet"}
            </Link>
            <Link className="button secondary small-button" to="/wallet">
              Wallet Tools
            </Link>
          </div>
        </div>
      </section>

      {summary ? (
        <section className="card card-pad">
          <div className="grid stats-grid">
            <SummaryStat label="Pending Votes" value={summaryValue(summary, "pending_vote_count")} />
            <SummaryStat label="Approved Pending" value={summaryValue(summary, "approved_pending_issue_count")} />
            <SummaryStat label="Active Loans" value={sumSummary(summary, ["active_count", "overdue_count", "repayment_pending_count"])} />
            <SummaryStat label="Repaid" value={summaryValue(summary, "repaid_count")} />
            <SummaryStat label="VLQ Active" value={summaryValue(summary, "total_vlq_active", " VLQ")} />
            <SummaryStat label="VLQ Repaid" value={summaryValue(summary, "total_vlq_repaid", " VLQ")} />
          </div>
        </section>
      ) : !loadingLoans ? (
        <section className="empty-state" role="status">
          Lending summary is unavailable right now. Loan records below will show only if the loan list API returned safely.
        </section>
      ) : null}

      <section className="card card-pad stack">
        <h2>Pending vs confirmed lending movement</h2>
        <div className="grid meta-grid">
          <div className="meta-item">
            <span className="meta-label">Pending movement</span>
            <span className="meta-value">Approved issuance or repayment transactions that are not mined yet.</span>
          </div>
          <div className="meta-item">
            <span className="meta-label">Confirmed movement</span>
            <span className="meta-value">Issuance or repayment transactions with explorer records in a confirmed block.</span>
          </div>
        </div>
      </section>

      <nav className="tabs" aria-label="Lending sections">
        {tabs.map(([key, label]) => (
          <button
            className={`tab-button ${activeTab === key ? "active" : ""}`}
            key={key}
            type="button"
            onClick={() => setActiveTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>

      {activeTab === "request" && (
        <section className="card card-pad stack">
          <h2>Request a Loan</h2>
          <p className="help-text">
            Approval opens an issuance transaction from the community lending pool. Funds are not confirmed until that transaction is mined into a block. Use your public wallet address, not a private key.
          </p>
          {!isLoggedIn && (
            <div className="wallet-safety-box">
              <strong>Wallet needed for lending</strong>
              <p>Create or unlock a saved wallet first if you want Vorliq to prefill your public address and keep repayment signing local.</p>
              <div className="button-row">
                <Link className="button small-button" to="/login">Unlock Wallet</Link>
                <Link className="button secondary small-button" to="/register">Create Wallet</Link>
              </div>
            </div>
          )}
          <form className="form" onSubmit={submitLoanRequest}>
            <div className="field">
              <label htmlFor="loan-requester">Requester Wallet Address</label>
              <input
                id="loan-requester"
                className="input"
                value={requestForm.requesterAddress}
                onChange={(event) => updateRequest("requesterAddress", event.target.value)}
                type="text"
                autoComplete="off"
              />
            </div>
            <div className="field">
              <label htmlFor="loan-amount">VLQ Amount</label>
              <input
                id="loan-amount"
                className="input"
                value={requestForm.amount}
                onChange={(event) => updateRequest("amount", event.target.value)}
                type="number"
                min="0.000001"
                max="10000"
                step="0.000001"
              />
            </div>
            <div className="field">
              <label htmlFor="loan-reason">Reason</label>
              <textarea
                id="loan-reason"
                className="textarea"
                value={requestForm.reason}
                onChange={(event) => updateRequest("reason", event.target.value)}
              />
            </div>
            <button className="button" type="submit" disabled={AUTHORITY_WRITES_DISABLED || submittingRequest}>
              {submittingRequest ? "Submitting..." : "Submit Loan Request"}
            </button>
          </form>
        </section>
      )}

      {activeTab === "votes" && (
        <LoanSection
          title="Active Votes"
          empty="No loans are open for voting right now."
          loans={buckets.activeVotes}
          loading={loadingLoans}
          renderActions={(loan) => (
            <div className="button-row">
              <button
                className="button small-button"
                type="button"
                disabled={AUTHORITY_WRITES_DISABLED || loanActionId === `${loan.loan_id}:vote:yes`}
                onClick={() => castVote(loan, "yes")}
              >
                Vote Yes
              </button>
              <button
                className="button secondary small-button"
                type="button"
                disabled={AUTHORITY_WRITES_DISABLED || loanActionId === `${loan.loan_id}:vote:no`}
                onClick={() => castVote(loan, "no")}
              >
                Vote No
              </button>
            </div>
          )}
        />
      )}

      {activeTab === "active" && (
        <LoanSection
          title="Active Loans"
          empty="No loans are active or waiting for issuance."
          loans={buckets.activeLoans}
          loading={loadingLoans}
          renderActions={(loan) => (
            canRepay(loan, myAddress || wallet?.address) ? (
              <RepaymentAction loan={loan} />
            ) : null
          )}
        />
      )}

      {activeTab === "mine" && (
        <section className="card card-pad stack">
          <div className="section-title">
            <h2>My Loans</h2>
            <button className="button secondary small-button" type="button" onClick={() => loadMyLoans()}>
              Refresh
            </button>
          </div>
          <div className="inline-form">
            <div className="field">
              <label htmlFor="my-loan-address">Wallet Address</label>
              <input
                id="my-loan-address"
                className="input"
                value={myAddress}
                onChange={(event) => setMyAddress(event.target.value)}
                type="text"
                autoComplete="off"
              />
            </div>
            <button className="button secondary" type="button" onClick={() => loadMyLoans()}>
              Load
            </button>
          </div>
          {loadingMyLoans && <Spinner label="Loading member loans..." />}
          {!loadingMyLoans && myLoans.loans.length === 0 && (
            <div className="empty-state">No borrowed or voted loans for this address.</div>
          )}
          {!loadingMyLoans && myLoans.borrowed.length > 0 && (
            <>
              <h3>Borrowed Loans</h3>
              <div className="loan-grid">
                {myLoans.borrowed.map((loan) => (
                  <LoanCard
                    loan={loan}
                    key={loan.loan_id}
                    actions={canRepay(loan, myAddress) ? (
                      <RepaymentAction loan={loan} />
                    ) : null}
                  />
                ))}
              </div>
            </>
          )}
          {!loadingMyLoans && myLoans.voted.length > 0 && (
            <>
              <h3>Voted Loans</h3>
              <div className="loan-grid">
                {myLoans.voted.map((loan) => <LoanCard loan={loan} key={loan.loan_id} />)}
              </div>
            </>
          )}
        </section>
      )}

      {activeTab === "history" && (
        <LoanSection
          title="Loan History"
          empty="No final loan records yet."
          loans={buckets.history}
          loading={loadingLoans}
        />
      )}
    </div>
  );
}

function LoanSection({ empty, loading, loans, renderActions, title }) {
  return (
    <section className="card card-pad lending-section">
      <div className="section-title">
        <h2>{title}</h2>
      </div>
      {loading && <Spinner label={`Loading ${title.toLowerCase()}...`} />}
      {!loading && loans.length === 0 && <div className="empty-state">{empty}</div>}
      <div className="loan-grid">
        {loans.map((loan) => (
          <LoanCard loan={loan} key={loan.loan_id} actions={renderActions?.(loan)} />
        ))}
      </div>
    </section>
  );
}

function LoanCard({ actions, loan }) {
  const totalWeight = Number(loan.yes_vote_weight || 0) + Number(loan.no_vote_weight || 0);
  const yesPercent = totalWeight > 0 ? (Number(loan.yes_vote_weight || 0) / totalWeight) * 100 : 0;
  const noPercent = totalWeight > 0 ? 100 - yesPercent : 0;
  const created = useMemo(() => formatDate(loan.created_at || loan.timestamp), [loan.created_at, loan.timestamp]);

  return (
    <article className="loan-card">
      <div className="section-title">
        <h3>Loan {loan.loan_id.slice(0, 12)}</h3>
        <span className={`status-badge ${loan.status}`}>{statusLabel(loan.status)}</span>
      </div>

      <div className="meta-item">
        <span className="meta-label">Borrower</span>
        <span className="meta-value"><AddressIdentity address={loan.requester_address} compact /></span>
      </div>
      <div className="meta-item">
        <span className="meta-label">Amount</span>
        <span className="meta-value">{formatNumber(loan.amount)} VLQ</span>
      </div>
      <div className="meta-item">
        <span className="meta-label">Repayment</span>
        <span className="meta-value">{formatNumber(loan.repayment_amount)} VLQ</span>
      </div>
      <div className="meta-item">
        <span className="meta-label">Reason</span>
        <span className="meta-value">{loan.reason}</span>
      </div>
      <div className="meta-item">
        <span className="meta-label">Created</span>
        <span className="meta-value">{created}</span>
      </div>
      <div className="meta-item">
        <span className="meta-label">Due Block</span>
        <span className="meta-value">
          {loan.due_block ?? "Not set"}
          {loan.blocks_until_due !== null && loan.blocks_until_due !== undefined ? ` (${loan.blocks_until_due} blocks)` : ""}
        </span>
      </div>
      <div className="meta-item">
        <span className="meta-label">VLQ Movement</span>
        <span className="meta-value">{movementLabel(loan)}</span>
      </div>

      <div className="button-row">
        {loan.issuance_tx_id && <Link className="button secondary small-button" to={`/tx/${loan.issuance_tx_id}`}>Issuance Tx</Link>}
        {loan.repayment_tx_id && <Link className="button secondary small-button" to={`/tx/${loan.repayment_tx_id}`}>Repayment Tx</Link>}
        <Link className="button secondary small-button" to="/blockchain">Explorer</Link>
      </div>

      <div className="vote-bar-wrap">
        <div className="vote-bar" aria-label="Vote weight">
          <span className="vote-yes" style={{ width: `${yesPercent}%` }} />
          <span className="vote-no" style={{ width: `${noPercent}%` }} />
        </div>
        <div className="vote-weights">
          <span>Yes: {formatNumber(loan.yes_vote_weight || 0)} VLQ</span>
          <span>No: {formatNumber(loan.no_vote_weight || 0)} VLQ</span>
        </div>
      </div>

      {actions}

      {(loan.status_history || []).length > 0 && (
        <details className="status-history">
          <summary>Status history</summary>
          <ol>
            {(loan.status_history || []).map((entry, index) => (
              <li key={`${entry.status}-${entry.timestamp || index}`}>
                <strong>{statusLabel(entry.status)}</strong> - {entry.message || "Status updated."}
              </li>
            ))}
          </ol>
        </details>
      )}
    </article>
  );
}

function RepaymentAction({ loan }) {
  return (
    <div className="wallet-safety-box lending-action-box">
      <strong>Repayment uses local send review</strong>
      <p>
        Repay {formatNumber(loan.repayment_amount)} VLQ only after reviewing the borrower, amount,
        and any lending pool instructions exposed by the current network state. The Send page signs
        locally with your saved wallet.
      </p>
      <Link className="button small-button" to="/send">
        Review Repayment In Send
      </Link>
    </div>
  );
}

function SummaryStat({ label, value }) {
  return (
    <div className="card card-pad stat-card compact-stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value ?? 0}</span>
    </div>
  );
}

function canRepay(loan, address) {
  return Boolean(
    address &&
    loan.requester_address === address.trim() &&
    ["active", "overdue"].includes(loan.status) &&
    !loan.repayment_tx_id
  );
}

function statusLabel(status) {
  return String(status || "").replace(/_/g, " ");
}

function movementLabel(loan) {
  if (loan.repayment_tx_id) return "Repayment transaction visible; confirmation depends on block inclusion.";
  if (loan.issuance_tx_id && loan.status === "active") return "Issuance confirmed; repayment is outstanding.";
  if (loan.issuance_tx_id) return "Issuance transaction pending confirmation.";
  if (loan.status === "pending_vote") return "No lending pool VLQ has moved.";
  if (historyStatuses.has(loan.status)) return "No active lending movement.";
  return "Movement state unavailable from the public loan record.";
}

function summaryValue(summary, key, suffix = "") {
  if (!summary || summary[key] === null || summary[key] === undefined || summary[key] === "") {
    return "Unavailable";
  }
  return `${formatNumber(summary[key])}${suffix}`;
}

function sumSummary(summary, keys) {
  if (!summary || keys.some((key) => summary[key] === null || summary[key] === undefined || summary[key] === "")) {
    return "Unavailable";
  }
  return formatNumber(keys.reduce((total, key) => total + Number(summary[key] || 0), 0));
}

function formatDate(timestamp) {
  if (!timestamp) return "Unknown";
  return new Date(Number(timestamp) * 1000).toLocaleString();
}

function formatNumber(value) {
  const number = Number(value || 0);
  return Number.isInteger(number) ? String(number) : number.toFixed(4).replace(/\.?0+$/, "");
}

export default Lending;
