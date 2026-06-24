// Lending page inside the new app shell (/preview/app/lending). Carries forward
// the existing Lending page's real data model and APIs exactly:
//   - GET  /lending/summary           aggregate lifecycle counts
//   - GET  /lending/loans             all loans (we bucket pending-vote vs active)
//   - GET  /lending/my?address        this wallet's borrowed / voted loans
//   - POST /lending/vote   (signed)   yes/no on a pending-vote loan
//   - POST /lending/request (signed)  open a new community loan request
// Votes are VLQ-weighted (yes_vote_weight / no_vote_weight) and every write is
// signed locally with the wallet password (helpers/signedAuthority.js). The
// real model has amount + reason + due block + repayment amount — there is no
// "term in days" or fixed interest field, so we show only real values.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Coins, Landmark, ThumbsDown, ThumbsUp, Vote as VoteIcon } from "lucide-react";

import "../../styles/vnext.css";
import AppShell from "../../components/vnext/AppShell";
import AuthorityAction from "../../components/vnext/AuthorityAction";
import SummaryCard from "../../components/vnext/SummaryCard";
import VoteBar from "../../components/vnext/VoteBar";
import ProfileAvatar from "../../components/ProfileAvatar";
import { Button, Card, CardSkeleton, InlineError } from "../../components/vnext/primitives";
import { useAuth } from "../../context/AuthContext";
import api from "../../helpers/api";
import { authorityErrorMessage, postSignedAuthority } from "../../helpers/signedAuthority";
import { formatHash, formatNumber, formatVlq } from "../../helpers/publicApi";

const PENDING_VOTE = "pending_vote";
const ACTIVE_STATUSES = ["approved_pending_issue", "active", "repayment_pending", "overdue"];
// Terminal loan states, shown in a read-only "Closed loans" section so a repaid
// or rejected loan's final state stays visible after it leaves the active list.
const CLOSED_STATUSES = ["repaid", "rejected"];

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Resolve whether (and how) this wallet has voted on a loan from the votes map.
function voteFor(loan, address) {
  if (!address) return null;
  const record = loan?.votes?.[address];
  if (!record) return null;
  return typeof record === "string" ? record : record.vote || "yes";
}

// The borrower may repay an active/overdue loan that has not been repaid yet.
function canRepay(loan, address) {
  return Boolean(
    address &&
      loan.requester_address === address &&
      ["active", "overdue"].includes(loan.status) &&
      !loan.repayment_tx_id
  );
}

function useLending(address) {
  const [state, setState] = useState({ loading: true, error: "", summary: null, loans: [], mine: null });

  const load = useCallback(
    async (signal) => {
      setState((s) => ({ ...s, loading: true, error: "" }));
      const requests = [
        api.get("/lending/summary", { signal }),
        api.get("/lending/loans", { params: { limit: 200 }, signal }),
      ];
      if (address) requests.push(api.get("/lending/my", { params: { address }, signal }));

      const [summaryRes, loansRes, mineRes] = await Promise.allSettled(requests);
      if (signal?.aborted) return;

      if (summaryRes.status === "rejected" && loansRes.status === "rejected") {
        setState((s) => ({ ...s, loading: false, error: "We couldn't load community lending right now." }));
        return;
      }
      setState({
        loading: false,
        error: "",
        summary: summaryRes.status === "fulfilled" ? summaryRes.value.data?.summary || null : null,
        loans: loansRes.status === "fulfilled" ? loansRes.value.data?.loans || [] : [],
        mine: mineRes && mineRes.status === "fulfilled" ? mineRes.value.data || null : null,
      });
    },
    [address]
  );

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return { ...state, reload: () => load() };
}

function LoanCard({ loan, address, isLoggedIn, onVote, onRepay, busyId, feedback }) {
  const [pending, setPending] = useState(null); // "yes" | "no" | null
  const [repayOpen, setRepayOpen] = useState(false);
  const repayable = canRepay(loan, address);
  const alreadyVoted = voteFor(loan, address);
  const isOpen = loan.status === PENDING_VOTE;
  const fb = feedback[loan.loan_id];

  return (
    <Card className="vn-prop">
      <div className="vn-prop__head">
        <h3 className="vn-prop__title">Loan {formatHash(loan.loan_id, 6, 4)}</h3>
        <span className="vn-badge vn-badge--accent">{String(loan.status || "").replace(/_/g, " ")}</span>
      </div>
      {loan.reason && <p className="vn-prop__desc">{loan.reason}</p>}
      <div className="vn-prop__meta">
        <span className="vn-prop__author">
          <ProfileAvatar address={loan.requester_address} size="small" />
          Borrower <b className="vn-mono" title={loan.requester_address}>{formatHash(loan.requester_address, 6, 4)}</b>
        </span>
        <span>
          Amount <b>{formatVlq(loan.amount)}</b>
        </span>
        <span>
          Repayment <b>{formatVlq(loan.repayment_amount)}</b>
        </span>
        <span>
          Due block <b>{loan.due_block ?? "Not set"}</b>
        </span>
      </div>

      <VoteBar yesWeight={loan.yes_vote_weight} noWeight={loan.no_vote_weight} />

      {fb && <InlineError message={fb} />}

      {isOpen &&
        (alreadyVoted ? (
          <span className={`vn-badge vn-badge--${alreadyVoted === "yes" ? "yes" : "no"}`}>
            <Check size={14} aria-hidden="true" /> You voted {alreadyVoted}
          </span>
        ) : !isLoggedIn ? (
          <p className="vn-prop__desc" style={{ margin: 0 }}>
            <Link className="vn-block-link" to="/login">Sign in</Link> to vote on this request.
          </p>
        ) : !pending ? (
          <div className="vn-prop__actions">
            <Button variant="primary" onClick={() => setPending("yes")}>
              <ThumbsUp size={16} aria-hidden="true" /> Vote Yes
            </Button>
            <Button variant="secondary" onClick={() => setPending("no")}>
              <ThumbsDown size={16} aria-hidden="true" /> Vote No
            </Button>
          </div>
        ) : (
          <AuthorityAction
            isLoggedIn={isLoggedIn}
            busy={busyId === loan.loan_id}
            submitLabel={`Sign and submit ${pending} vote`}
            onSubmit={(password) => onVote(loan, pending, password).then(() => setPending(null))}
          />
        ))}

      {/* Repay (borrower only, active/overdue, not yet repaid). Same signed
          authority pattern as vote/request. Repayment submits VLQ movement to
          the pending pool and still needs mining confirmation. */}
      {repayable &&
        (!repayOpen ? (
          <div className="vn-prop__actions">
            <Button variant="primary" onClick={() => setRepayOpen(true)}>
              <Coins size={16} aria-hidden="true" /> Repay {formatVlq(loan.repayment_amount)}
            </Button>
          </div>
        ) : (
          <AuthorityAction
            isLoggedIn={isLoggedIn}
            busy={busyId === loan.loan_id}
            submitLabel="Sign and submit repayment"
            note="Repayment is signed locally and submitted to the pending pool; it stays pending until mined."
            onSubmit={(password) => onRepay(loan, password).then(() => setRepayOpen(false))}
          />
        ))}

      <div className="vn-prop__actions">
        {loan.issuance_tx_id && (
          <Link className="vn-block-link" to={`/tx/${loan.issuance_tx_id}`}>Issuance tx</Link>
        )}
        {loan.repayment_tx_id && (
          <Link className="vn-block-link" to={`/tx/${loan.repayment_tx_id}`}>Repayment tx</Link>
        )}
      </div>
    </Card>
  );
}

function RequestForm({ isLoggedIn, address, onSubmitted }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (!isLoggedIn) {
    return (
      <Card style={{ marginTop: 20 }}>
        <p className="vn-empty-note" style={{ margin: 0 }}>
          <Link className="vn-block-link" to="/login">Sign in</Link> to request a community loan.
        </p>
      </Card>
    );
  }

  async function submit(password) {
    setError("");
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setError("Enter a loan amount greater than zero.");
      return;
    }
    if (!reason.trim()) {
      setError("Add a short reason for the request.");
      return;
    }
    setBusy(true);
    try {
      await postSignedAuthority({
        action: "lending.request",
        walletPassword: password,
        body: { amount: amt, reason: reason.trim() },
      });
      setAmount("");
      setReason("");
      setOpen(false);
      await onSubmitted();
    } catch (err) {
      setError(authorityErrorMessage(err, "Unable to submit loan request."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ marginTop: 20 }}>
      <div className="vn-prop__head">
        <h2 className="vn-panel-title" style={{ margin: 0 }}>Request a community loan</h2>
        <Button variant="secondary" onClick={() => setOpen((v) => !v)}>
          {open ? "Cancel" : "New request"}
        </Button>
      </div>
      {open && (
        <div className="vn-send-form" style={{ marginTop: 16 }}>
          {error && <InlineError message={error} />}
          <div className="vn-field">
            <label htmlFor="vn-loan-amount">Amount in VLQ</label>
            <input
              id="vn-loan-amount"
              className="vn-input"
              type="number"
              min="0.000001"
              step="0.000001"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
          </div>
          <div className="vn-field">
            <label htmlFor="vn-loan-reason">Reason</label>
            <input
              id="vn-loan-reason"
              className="vn-input"
              type="text"
              maxLength={160}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="What is this loan for?"
            />
            <p className="vn-field__hint">
              Approval opens an issuance transaction from the community lending pool; funds are not
              confirmed until that transaction is mined.
            </p>
          </div>
          <AuthorityAction isLoggedIn={isLoggedIn} busy={busy} submitLabel="Sign and submit request" onSubmit={submit} />
        </div>
      )}
    </Card>
  );
}

export default function Lending() {
  const { isLoggedIn, wallet } = useAuth();
  const address = wallet?.address;
  const { loading, error, summary, loans, mine, reload } = useLending(address);
  const [busyId, setBusyId] = useState("");
  const [feedback, setFeedback] = useState({});

  const openLoans = useMemo(() => loans.filter((l) => l.status === PENDING_VOTE), [loans]);
  const activeLoans = useMemo(() => loans.filter((l) => ACTIVE_STATUSES.includes(l.status)), [loans]);
  const closedLoans = useMemo(() => loans.filter((l) => CLOSED_STATUSES.includes(l.status)), [loans]);

  const myBorrowed = mine?.borrowed || [];
  const myActiveTotal = myBorrowed
    .filter((l) => ["active", "approved_pending_issue", "overdue"].includes(l.status))
    .reduce((sum, l) => sum + num(l.amount), 0);
  const myVotedCount = (mine?.voted || []).length;

  const cards = [
    {
      label: "Open for voting",
      value: summary ? formatNumber(summary.pending_vote_count ?? 0) : null,
      icon: VoteIcon,
    },
    {
      label: "VLQ active",
      value: summary && summary.total_vlq_active != null ? formatVlq(summary.total_vlq_active) : null,
      icon: Coins,
    },
    {
      label: "Your active borrowing",
      value: mine ? formatVlq(myActiveTotal) : isLoggedIn ? null : "—",
      icon: Landmark,
      trend: mine ? { direction: "flat", label: `${myVotedCount} votes cast` } : null,
    },
    {
      label: "Approval threshold",
      value: summary && summary.voting_threshold != null ? formatVlq(summary.voting_threshold) : null,
      icon: VoteIcon,
    },
  ];

  async function castVote(loan, vote, password) {
    setBusyId(loan.loan_id);
    setFeedback((f) => ({ ...f, [loan.loan_id]: "" }));
    try {
      await postSignedAuthority({
        action: "lending.vote",
        walletPassword: password,
        body: { loan_id: loan.loan_id, vote },
      });
      await reload();
    } catch (err) {
      setFeedback((f) => ({ ...f, [loan.loan_id]: authorityErrorMessage(err, "Unable to cast vote.") }));
      throw err;
    } finally {
      setBusyId("");
    }
  }

  async function repayLoan(loan, password) {
    setBusyId(loan.loan_id);
    setFeedback((f) => ({ ...f, [loan.loan_id]: "" }));
    try {
      await postSignedAuthority({
        action: "lending.repay",
        walletPassword: password,
        body: { loan_id: loan.loan_id },
      });
      await reload();
    } catch (err) {
      setFeedback((f) => ({ ...f, [loan.loan_id]: authorityErrorMessage(err, "Unable to repay loan.") }));
      throw err;
    } finally {
      setBusyId("");
    }
  }

  return (
    <AppShell active="lending">
      <div className="vn-page-head">
        <h1>Lending</h1>
        <div className="vn-page-head__meta">Community loans, VLQ-weighted votes, and repayment lifecycle</div>
      </div>

      {error ? (
        <InlineError message={error} onRetry={reload} />
      ) : (
        <div className="vn-summary-grid">
          {cards.map((c) => (
            <SummaryCard key={c.label} label={c.label} value={c.value} icon={c.icon} trend={c.trend} loading={loading} />
          ))}
        </div>
      )}

      {/* Open loan requests (votable) */}
      <Card style={{ marginTop: 20 }}>
        <h2 className="vn-panel-title">Active loan requests</h2>
        {loading ? (
          <div className="vn-card-grid">
            <CardSkeleton />
            <CardSkeleton />
          </div>
        ) : openLoans.length === 0 ? (
          <p className="vn-empty-note" style={{ margin: 0 }}>No loans are open for voting right now.</p>
        ) : (
          <div className="vn-card-grid">
            {openLoans.map((loan) => (
              <LoanCard
                key={loan.loan_id}
                loan={loan}
                address={address}
                isLoggedIn={isLoggedIn}
                onVote={castVote}
                busyId={busyId}
                feedback={feedback}
              />
            ))}
          </div>
        )}
      </Card>

      {/* Active / issued loans */}
      {!loading && activeLoans.length > 0 && (
        <Card style={{ marginTop: 20 }}>
          <h2 className="vn-panel-title">Active loans</h2>
          <div className="vn-card-grid">
            {activeLoans.map((loan) => (
              <LoanCard
                key={loan.loan_id}
                loan={loan}
                address={address}
                isLoggedIn={isLoggedIn}
                onVote={castVote}
                onRepay={repayLoan}
                busyId={busyId}
                feedback={feedback}
              />
            ))}
          </div>
        </Card>
      )}

      {/* Closed loans (repaid / rejected): read-only, so a loan's final state
          stays visible after it leaves the active list. */}
      {!loading && closedLoans.length > 0 && (
        <Card style={{ marginTop: 20 }}>
          <h2 className="vn-panel-title">Closed loans</h2>
          <div className="vn-card-grid">
            {closedLoans.map((loan) => (
              <LoanCard
                key={loan.loan_id}
                loan={loan}
                address={address}
                isLoggedIn={isLoggedIn}
                onVote={castVote}
                onRepay={repayLoan}
                busyId={busyId}
                feedback={feedback}
              />
            ))}
          </div>
        </Card>
      )}

      <RequestForm isLoggedIn={isLoggedIn} address={address} onSubmitted={reload} />
    </AppShell>
  );
}
