// Governance page inside the new app shell (/preview/app/governance). Carries
// forward the existing Governance APIs and VLQ-weighted vote model exactly:
//   - GET  /governance/proposals?status=active   open proposals
//   - GET  /governance/all                        full history (closed = non-active)
//   - GET  /governance/summary                    aggregate counts
//   - POST /governance/vote  (signed)             yes/no on an active proposal
// Active proposals show a live countdown to the voting deadline and the shared
// VLQ-weighted vote split bar. Closed proposals reuse the same card, muted, with
// a Closed badge. Every vote is signed locally with the wallet password.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Ban, Check, CheckCircle2, FileText, ThumbsDown, ThumbsUp } from "lucide-react";

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
import { formatHash, formatNumber } from "../../helpers/publicApi";
import { useSharedWalletBalance } from "../../context/WalletBalanceContext";

function voteFor(proposal, address) {
  if (!address) return null;
  const record = proposal?.votes?.[address];
  if (!record) return null;
  return typeof record === "string" ? record : record.vote || "yes";
}

// The proposer may cancel their own active proposal before any votes are cast.
function canCancel(proposal, address) {
  return Boolean(
    address &&
      proposal.status === "active" &&
      proposal.proposer_address === address &&
      Object.keys(proposal.votes || {}).length === 0
  );
}

// Governable settings (carried forward from the existing Governance page).
const CATEGORIES = [
  ["mining_reward", "Mining Reward"],
  ["difficulty", "Block Difficulty"],
  ["loan_limit", "Maximum Loan Amount"],
  ["loan_interest", "Loan Interest Rate"],
  ["exchange_limit", "Community Request Limit"],
  ["general", "General Proposal"],
];
const CATEGORY_GUIDANCE = {
  mining_reward: "Mining reward must be greater than 0 and no more than 1000 VLQ.",
  difficulty: "Difficulty must be an integer between 2 and 8.",
  loan_limit: "Loan limit must be greater than 0 and no more than 1,000,000 VLQ.",
  loan_interest: "Loan interest must be between 0 and 100 percent.",
  exchange_limit: "Community request limit must be between 1 and 1000.",
  general: "General proposals are advisory — they can pass but do not automatically execute a setting.",
};

// Live countdown to a unix-seconds deadline; ticks every second, cleared on unmount.
function Countdown({ deadline }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const target = Number(deadline);
  if (!Number.isFinite(target)) return <span className="vn-countdown vn-countdown--ended">No deadline</span>;
  const remaining = target * 1000 - now;
  if (remaining <= 0) return <span className="vn-countdown vn-countdown--ended">Voting closed</span>;

  const totalSeconds = Math.floor(remaining / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const label = days > 0 ? `${days}d ${hours}h ${minutes}m` : hours > 0 ? `${hours}h ${minutes}m ${seconds}s` : `${minutes}m ${seconds}s`;
  return <span className="vn-countdown">{label} left</span>;
}

function useGovernance(address) {
  const [state, setState] = useState({ loading: true, error: "", active: [], closed: [], summary: null });

  const load = useCallback(async (signal) => {
    setState((s) => ({ ...s, loading: true, error: "" }));
    const [activeRes, allRes, summaryRes] = await Promise.allSettled([
      api.get("/governance/proposals", { params: { status: "active", limit: 100 }, signal }),
      api.get("/governance/all", { params: { limit: 200 }, signal }),
      api.get("/governance/summary", { signal }),
    ]);
    if (signal?.aborted) return;

    if (activeRes.status === "rejected" && allRes.status === "rejected") {
      setState((s) => ({ ...s, loading: false, error: "We couldn't load governance right now." }));
      return;
    }
    const all = allRes.status === "fulfilled" ? allRes.value.data?.proposals || [] : [];
    setState({
      loading: false,
      error: "",
      active: activeRes.status === "fulfilled" ? activeRes.value.data?.proposals || [] : [],
      closed: all.filter((p) => p.status !== "active"),
      summary: summaryRes.status === "fulfilled" ? summaryRes.value.data?.summary || null : null,
    });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return { ...state, reload: () => load() };
}

function ProposalCard({ proposal, address, isLoggedIn, closed, onVote, onCancel, busyId, feedback }) {
  const [pending, setPending] = useState(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const cancellable = !closed && canCancel(proposal, address);
  const voted = voteFor(proposal, address);
  const fb = feedback[proposal.proposal_id];
  const description = proposal.description || "No description provided.";
  const shortDesc = description.length > 200 ? `${description.slice(0, 200)}…` : description;

  return (
    <Card className={`vn-prop ${closed ? "vn-prop--closed" : ""}`}>
      <div className="vn-prop__head">
        <h3 className="vn-prop__title">{proposal.title || "Untitled proposal"}</h3>
        {closed ? (
          <span className="vn-badge vn-badge--muted">{String(proposal.status || "closed").replace(/_/g, " ")}</span>
        ) : (
          <Countdown deadline={proposal.voting_deadline} />
        )}
      </div>
      <p className="vn-prop__desc">{shortDesc}</p>
      <div className="vn-prop__meta">
        <span className="vn-prop__author">
          <ProfileAvatar address={proposal.proposer_address} size="small" />
          Proposer{" "}
          <b className="vn-mono" title={proposal.proposer_address}>{formatHash(proposal.proposer_address, 6, 4)}</b>
        </span>
        {proposal.parameter != null && proposal.parameter !== "" && (
          <span>Proposed <b>{String(proposal.parameter)}</b></span>
        )}
      </div>

      <VoteBar yesWeight={proposal.yes_vote_weight} noWeight={proposal.no_vote_weight} />
      {Number(proposal.quorum) > 0 && (
        <p className="vn-field__hint" style={{ margin: 0 }}>
          Quorum {formatNumber((Number(proposal.yes_vote_weight) || 0) + (Number(proposal.no_vote_weight) || 0))} /{" "}
          {formatNumber(proposal.quorum)} VLQ
        </p>
      )}

      {fb && <InlineError message={fb} />}

      {!closed &&
        (voted ? (
          <span className={`vn-badge vn-badge--${voted === "yes" ? "yes" : "no"}`}>
            <Check size={14} aria-hidden="true" /> You voted {voted}
          </span>
        ) : !isLoggedIn ? (
          <p className="vn-prop__desc" style={{ margin: 0 }}>
            <Link className="vn-block-link" to="/login">Sign in</Link> to vote on this proposal.
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
            busy={busyId === proposal.proposal_id}
            submitLabel={`Sign and submit ${pending} vote`}
            onSubmit={(password) => onVote(proposal, pending, password).then(() => setPending(null))}
          />
        ))}

      {/* Cancel (proposer only, active, no votes yet). Same signed pattern. */}
      {cancellable &&
        (!cancelOpen ? (
          <div className="vn-prop__actions">
            <Button variant="secondary" onClick={() => setCancelOpen(true)}>
              <Ban size={16} aria-hidden="true" /> Cancel proposal
            </Button>
          </div>
        ) : (
          <AuthorityAction
            isLoggedIn={isLoggedIn}
            busy={busyId === proposal.proposal_id}
            submitLabel="Sign and submit cancellation"
            note="Cancelling is signed locally. It is only possible before any votes are cast."
            onSubmit={(password) => onCancel(proposal, password).then(() => setCancelOpen(false))}
          />
        ))}

      {closed && proposal.rule_change_id && (
        <span className="vn-badge vn-badge--accent">
          <CheckCircle2 size={14} aria-hidden="true" /> Executed
        </span>
      )}
    </Card>
  );
}

// Create-proposal form, mirroring the Lending request form's signed-authority
// pattern. Real categories + validation from the existing Governance page.
function ProposeForm({ isLoggedIn, walletBalance, onSubmitted }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("mining_reward");
  const [parameter, setParameter] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (!isLoggedIn) {
    return (
      <Card style={{ marginTop: 20 }}>
        <p className="vn-empty-note" style={{ margin: 0 }}>
          <Link className="vn-block-link" to="/login">Sign in</Link> to propose a rule change.
        </p>
      </Card>
    );
  }

  // Creating a proposal requires holding VLQ (the core gates this server-side).
  // Tell the user up front rather than letting them fill out the form and hit a
  // rejection — and the submit path still translates the backend reason if the
  // balance changes between this check and submission.
  const noVlq = walletBalance != null && walletBalance <= 0;

  async function submit(password) {
    setError("");
    if (!title.trim()) {
      setError("Add a proposal title.");
      return;
    }
    if (!String(parameter).trim()) {
      setError("Enter a proposed value.");
      return;
    }
    if (description.trim().length < 50) {
      setError("The description must be at least 50 characters.");
      return;
    }
    setBusy(true);
    try {
      await postSignedAuthority({
        action: "governance.propose",
        walletPassword: password,
        body: { title: title.trim(), description: description.trim(), category, parameter },
      });
      setTitle("");
      setParameter("");
      setDescription("");
      setOpen(false);
      await onSubmitted();
    } catch (err) {
      setError(authorityErrorMessage(err, "Unable to create proposal."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ marginTop: 20 }}>
      <div className="vn-prop__head">
        <h2 className="vn-panel-title" style={{ margin: 0 }}>Propose a rule change</h2>
        <Button variant="secondary" disabled={noVlq} onClick={() => setOpen((v) => !v)}>
          {open ? "Cancel" : "New proposal"}
        </Button>
      </div>
      {noVlq && (
        <p className="vn-empty-note" style={{ marginTop: 12, marginBottom: 0 }}>
          You need to hold some VLQ before you can create a governance proposal. Receive or earn VLQ first, then you
          can propose a rule change.
        </p>
      )}
      {open && !noVlq && (
        <div className="vn-send-form" style={{ marginTop: 16 }}>
          {error && <InlineError message={error} />}
          <div className="vn-field">
            <label htmlFor="vn-gov-title">Title</label>
            <input id="vn-gov-title" className="vn-input" type="text" maxLength={160}
              value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Short, specific title" />
          </div>
          <div className="vn-field">
            <label htmlFor="vn-gov-category">Category</label>
            <select id="vn-gov-category" className="vn-input" value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          <div className="vn-field">
            <label htmlFor="vn-gov-parameter">Proposed value</label>
            <input id="vn-gov-parameter" className="vn-input"
              type={category === "general" ? "text" : "number"}
              value={parameter} onChange={(e) => setParameter(e.target.value)} placeholder="Proposed value" />
            <p className="vn-field__hint">{CATEGORY_GUIDANCE[category]}</p>
          </div>
          <div className="vn-field">
            <label htmlFor="vn-gov-description">Description</label>
            <input id="vn-gov-description" className="vn-input" type="text"
              value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="At least 50 characters explaining the change" />
          </div>
          <AuthorityAction isLoggedIn={isLoggedIn} busy={busy} submitLabel="Sign and submit proposal" onSubmit={submit} />
        </div>
      )}
    </Card>
  );
}

export default function Governance() {
  const { isLoggedIn, wallet } = useAuth();
  const address = wallet?.address;
  const { loading, error, active, closed, summary, reload } = useGovernance(address);
  // Total (pending-inclusive) balance — the propose gate the core enforces uses
  // this figure, so it drives the proactive "you need VLQ to propose" guidance.
  const { total: walletBalance } = useSharedWalletBalance();
  const [busyId, setBusyId] = useState("");
  const [feedback, setFeedback] = useState({});

  const cards = useMemo(
    () => [
      { label: "Active proposals", value: summary ? formatNumber(summary.active_count ?? active.length) : null },
      { label: "Quorum", value: summary && summary.quorum != null ? `${formatNumber(summary.quorum)} VLQ` : null },
      { label: "Executed changes", value: summary ? formatNumber(summary.executed_count ?? 0) : null },
    ],
    [summary, active.length]
  );

  async function castVote(proposal, vote, password) {
    setBusyId(proposal.proposal_id);
    setFeedback((f) => ({ ...f, [proposal.proposal_id]: "" }));
    try {
      await postSignedAuthority({
        action: "governance.vote",
        walletPassword: password,
        body: { proposal_id: proposal.proposal_id, vote },
      });
      await reload();
    } catch (err) {
      setFeedback((f) => ({ ...f, [proposal.proposal_id]: authorityErrorMessage(err, "Unable to cast vote.") }));
      throw err;
    } finally {
      setBusyId("");
    }
  }

  async function cancelProposal(proposal, password) {
    setBusyId(proposal.proposal_id);
    setFeedback((f) => ({ ...f, [proposal.proposal_id]: "" }));
    try {
      await postSignedAuthority({
        action: "governance.cancel",
        walletPassword: password,
        body: { proposal_id: proposal.proposal_id },
      });
      await reload();
    } catch (err) {
      setFeedback((f) => ({ ...f, [proposal.proposal_id]: authorityErrorMessage(err, "Unable to cancel proposal.") }));
      throw err;
    } finally {
      setBusyId("");
    }
  }

  return (
    <AppShell active="governance">
      <div className="vn-page-head">
        <h1>Governance</h1>
        <div className="vn-page-head__meta">VLQ-weighted rule-change proposals and community decisions</div>
      </div>

      {error ? (
        <InlineError message={error} onRetry={reload} />
      ) : (
        <div className="vn-summary-grid vn-summary-grid--3">
          {cards.map((c) => (
            <SummaryCard key={c.label} label={c.label} value={c.value} icon={FileText} loading={loading} />
          ))}
        </div>
      )}

      <Card style={{ marginTop: 20 }}>
        <h2 className="vn-panel-title">How governance works</h2>
        <p className="vn-prop__desc" style={{ marginTop: 0 }}>
          Anyone holding VLQ can propose a change to a network rule — like the mining reward or block
          difficulty. Members vote, weighted by the VLQ they hold. To pass, a proposal needs at least{" "}
          <b>{summary?.quorum != null ? formatNumber(summary.quorum) : 100} VLQ</b> of total votes (quorum)
          with <b>{Math.round((summary?.approval_threshold ?? 0.6) * 100)}% or more voting yes</b> before
          its deadline. When a proposal passes, its rule change is applied to the live chain automatically
          — there is no extra step, and you can see the change reflected in the network settings.
        </p>
        <dl className="vn-gov-legend">
          <div><dt><span className="vn-badge vn-badge--muted">active</span></dt><dd>Open for voting right now.</dd></div>
          <div><dt><span className="vn-badge vn-badge--muted">passed pending execution</span></dt><dd>Passed the vote; the rule change is queued and applies on the next governance sync.</dd></div>
          <div><dt><span className="vn-badge vn-badge--accent">executed</span></dt><dd>Passed and the rule change is now live on the chain.</dd></div>
          <div><dt><span className="vn-badge vn-badge--muted">rejected</span></dt><dd>The community voted it down — not enough yes-weight to pass.</dd></div>
          <div><dt><span className="vn-badge vn-badge--muted">expired</span></dt><dd>Voting ended without reaching the {summary?.quorum != null ? formatNumber(summary.quorum) : 100} VLQ quorum, so nothing changed.</dd></div>
          <div><dt><span className="vn-badge vn-badge--muted">cancelled</span></dt><dd>The proposer withdrew it before any votes were cast.</dd></div>
        </dl>
      </Card>

      <Card style={{ marginTop: 20 }}>
        <h2 className="vn-panel-title">Active proposals</h2>
        {loading ? (
          <div className="vn-card-grid">
            <CardSkeleton />
            <CardSkeleton />
          </div>
        ) : active.length === 0 ? (
          <p className="vn-empty-note" style={{ margin: 0 }}>No active proposals are open for voting.</p>
        ) : (
          <div className="vn-card-grid">
            {active.map((p) => (
              <ProposalCard
                key={p.proposal_id}
                proposal={p}
                address={address}
                isLoggedIn={isLoggedIn}
                onVote={castVote}
                onCancel={cancelProposal}
                busyId={busyId}
                feedback={feedback}
              />
            ))}
          </div>
        )}
      </Card>

      <ProposeForm isLoggedIn={isLoggedIn} walletBalance={walletBalance} onSubmitted={reload} />

      {!loading && closed.length > 0 && (
        <Card style={{ marginTop: 20 }}>
          <h2 className="vn-panel-title">Closed proposals</h2>
          <div className="vn-card-grid">
            {closed.map((p) => (
              <ProposalCard
                key={p.proposal_id}
                proposal={p}
                address={address}
                isLoggedIn={isLoggedIn}
                onVote={castVote}
                busyId={busyId}
                feedback={feedback}
                closed
              />
            ))}
          </div>
        </Card>
      )}
    </AppShell>
  );
}
