import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-toastify";

import ErrorMessage from "../components/ErrorMessage";
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

const initialVote = {
  loanId: "",
  voterAddress: "",
  vote: "yes",
};

const initialRepay = {
  loanId: "",
  repayerAddress: "",
};

function Lending() {
  const { isLoggedIn, wallet } = useAuth();
  const { addNotification } = useNotifications();
  const previousLoanStatusesRef = useRef(null);
  const [requestForm, setRequestForm] = useState(initialRequest);
  const [voteForm, setVoteForm] = useState(initialVote);
  const [repayForm, setRepayForm] = useState(initialRepay);
  const [loans, setLoans] = useState([]);
  const [loadingLoans, setLoadingLoans] = useState(true);
  const [submittingRequest, setSubmittingRequest] = useState(false);
  const [castingVote, setCastingVote] = useState(false);
  const [repaying, setRepaying] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function loadLoans({ quiet = false } = {}) {
    try {
      const response = await api.get("/lending/loans");
      setLoans(response.data.loans || []);
      setErrorMessage("");
    } catch (error) {
      if (!quiet) {
        const message = apiErrorMessage(error, "Unable to load loan requests.");
        setErrorMessage(message);
        toast.error(message);
      }
    } finally {
      setLoadingLoans(false);
    }
  }

  useEffect(() => {
    loadLoans();
  }, []);

  useEffect(() => {
    if (!isLoggedIn || !wallet?.address || loadingLoans) {
      return;
    }

    const myLoans = loans.filter((loan) => loan.requester_address === wallet.address);
    const currentStatuses = new Map(myLoans.map((loan) => [loan.loan_id, loan.status]));

    if (previousLoanStatusesRef.current === null) {
      previousLoanStatusesRef.current = currentStatuses;
      return;
    }

    myLoans.forEach((loan) => {
      const previousStatus = previousLoanStatusesRef.current.get(loan.loan_id);
      if (previousStatus === "pending" && loan.status === "approved") {
        addNotification(
          "success",
          "Loan Approved",
          `Loan ${loan.loan_id.slice(0, 12)} for ${loan.amount} VLQ was approved.`
        );
      }
    });

    previousLoanStatusesRef.current = currentStatuses;
  }, [addNotification, isLoggedIn, loadingLoans, loans, wallet]);

  function updateRequest(field, value) {
    setRequestForm((current) => ({ ...current, [field]: value }));
  }

  function updateVote(field, value) {
    setVoteForm((current) => ({ ...current, [field]: value }));
  }

  function updateRepay(field, value) {
    setRepayForm((current) => ({ ...current, [field]: value }));
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
      await loadLoans({ quiet: true });
    } catch (error) {
      const message = apiErrorMessage(error, "Unable to submit loan request.");
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setSubmittingRequest(false);
    }
  }

  async function castVote(event) {
    event.preventDefault();

    if (!voteForm.loanId.trim() || !voteForm.voterAddress.trim()) {
      toast.error("Enter the loan ID and voter wallet address.");
      return;
    }

    setCastingVote(true);
    try {
      await api.post("/lending/vote", {
        loan_id: voteForm.loanId.trim(),
        voter_address: voteForm.voterAddress.trim(),
        voter_wallet_address: voteForm.voterAddress.trim(),
        vote: voteForm.vote,
      });
      toast.success("Vote cast successfully.");
      setErrorMessage("");
      setVoteForm(initialVote);
      await loadLoans({ quiet: true });
    } catch (error) {
      const message = apiErrorMessage(error, "Unable to cast vote.");
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setCastingVote(false);
    }
  }

  async function repayLoan(event) {
    event.preventDefault();

    if (!repayForm.loanId.trim() || !repayForm.repayerAddress.trim()) {
      toast.error("Enter the loan ID and repayer wallet address.");
      return;
    }

    setRepaying(true);
    try {
      const response = await api.post("/lending/repay", {
        loan_id: repayForm.loanId.trim(),
        repayer_address: repayForm.repayerAddress.trim(),
      });
      toast.success(`Loan repaid. Repayment amount: ${response.data.repayment_amount} VLQ.`);
      setErrorMessage("");
      setRepayForm(initialRepay);
      await loadLoans({ quiet: true });
    } catch (error) {
      const message = apiErrorMessage(error, "Unable to repay loan.");
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setRepaying(false);
    }
  }

  return (
    <div className="page">
      <section className="hero">
        <span className="eyebrow">Community Lending</span>
        <h1>Lending</h1>
        <p className="subtitle">
          Request a VLQ loan, vote with wallet balance as voting weight, and let the community
          decide which loans should be issued.
        </p>
      </section>

      <ErrorMessage message={errorMessage} />

      <div className="grid two-column">
        <section className="card card-pad stack">
          <h2>Request a Loan</h2>
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
            <button className="button" type="submit" disabled={submittingRequest}>
              {submittingRequest ? "Submitting..." : "Submit Loan Request"}
            </button>
          </form>
        </section>

        <section className="card card-pad stack">
          <h2>Vote on a Loan</h2>
          <form className="form" onSubmit={castVote}>
            <div className="field">
              <label htmlFor="vote-loan-id">Loan ID</label>
              <input
                id="vote-loan-id"
                className="input"
                value={voteForm.loanId}
                onChange={(event) => updateVote("loanId", event.target.value)}
                type="text"
                autoComplete="off"
              />
            </div>
            <div className="field">
              <label htmlFor="voter-address">Voter Wallet Address</label>
              <input
                id="voter-address"
                className="input"
                value={voteForm.voterAddress}
                onChange={(event) => updateVote("voterAddress", event.target.value)}
                type="text"
                autoComplete="off"
              />
            </div>
            <div className="field">
              <label htmlFor="vote-choice">Vote</label>
              <select
                id="vote-choice"
                className="input"
                value={voteForm.vote}
                onChange={(event) => updateVote("vote", event.target.value)}
              >
                <option value="yes">yes</option>
                <option value="no">no</option>
              </select>
            </div>
            <button className="button" type="submit" disabled={castingVote}>
              {castingVote ? "Casting..." : "Cast Vote"}
            </button>
          </form>
        </section>
      </div>

      <section className="card card-pad lending-section">
        <div className="section-title">
          <h2>Active Loan Requests</h2>
          <button className="button secondary small-button" type="button" onClick={() => loadLoans()}>
            Refresh
          </button>
        </div>

        {loadingLoans && <Spinner label="Loading loan requests..." />}

        {!loadingLoans && loans.length === 0 && (
          <div className="empty-state">No loan requests have been created yet.</div>
        )}

        <div className="loan-grid">
          {loans.map((loan) => (
            <LoanCard loan={loan} key={loan.loan_id} />
          ))}
        </div>
      </section>

      <section className="card card-pad lending-section stack">
        <h2>Repay a Loan</h2>
        <form className="form" onSubmit={repayLoan}>
          <div className="field">
            <label htmlFor="repay-loan-id">Loan ID</label>
            <input
              id="repay-loan-id"
              className="input"
              value={repayForm.loanId}
              onChange={(event) => updateRepay("loanId", event.target.value)}
              type="text"
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label htmlFor="repayer-address">Repayer Wallet Address</label>
            <input
              id="repayer-address"
              className="input"
              value={repayForm.repayerAddress}
              onChange={(event) => updateRepay("repayerAddress", event.target.value)}
              type="text"
              autoComplete="off"
            />
          </div>
          <button className="button" type="submit" disabled={repaying}>
            {repaying ? "Repaying..." : "Repay Loan"}
          </button>
        </form>
      </section>
    </div>
  );
}

function LoanCard({ loan }) {
  const totalWeight = Number(loan.yes_vote_weight) + Number(loan.no_vote_weight);
  const yesPercent = totalWeight > 0 ? (Number(loan.yes_vote_weight) / totalWeight) * 100 : 0;
  const noPercent = totalWeight > 0 ? 100 - yesPercent : 0;

  const created = useMemo(() => new Date(loan.timestamp * 1000).toLocaleString(), [loan.timestamp]);

  return (
    <article className="loan-card">
      <div className="section-title">
        <h3>Loan {loan.loan_id.slice(0, 12)}</h3>
        <span className={`status-badge ${loan.status}`}>{loan.status}</span>
      </div>

      <div className="meta-item">
        <span className="meta-label">Requester</span>
        <span className="meta-value">{loan.requester_address}</span>
      </div>
      <div className="meta-item">
        <span className="meta-label">Amount Requested</span>
        <span className="meta-value">{loan.amount} VLQ</span>
      </div>
      <div className="meta-item">
        <span className="meta-label">Reason</span>
        <span className="meta-value">{loan.reason}</span>
      </div>
      <div className="meta-item">
        <span className="meta-label">Created</span>
        <span className="meta-value">{created}</span>
      </div>

      <div className="vote-bar-wrap">
        <div className="vote-bar">
          <span className="vote-yes" style={{ width: `${yesPercent}%` }} />
          <span className="vote-no" style={{ width: `${noPercent}%` }} />
        </div>
        <div className="vote-weights">
          <span>Yes: {loan.yes_vote_weight} VLQ</span>
          <span>No: {loan.no_vote_weight} VLQ</span>
        </div>
      </div>
    </article>
  );
}

export default Lending;
