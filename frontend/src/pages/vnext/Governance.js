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
import { Check, CheckCircle2, FileText, ThumbsDown, ThumbsUp } from "lucide-react";

import "../../styles/vnext.css";
import AppShell from "../../components/vnext/AppShell";
import AuthorityAction from "../../components/vnext/AuthorityAction";
import SummaryCard from "../../components/vnext/SummaryCard";
import VoteBar from "../../components/vnext/VoteBar";
import { Button, Card, InlineError } from "../../components/vnext/primitives";
import { useAuth } from "../../context/AuthContext";
import api from "../../helpers/api";
import { authorityErrorMessage, postSignedAuthority } from "../../helpers/signedAuthority";
import { formatHash, formatNumber } from "../../helpers/publicApi";

function voteFor(proposal, address) {
  if (!address) return null;
  const record = proposal?.votes?.[address];
  if (!record) return null;
  return typeof record === "string" ? record : record.vote || "yes";
}

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

function ProposalCard({ proposal, address, isLoggedIn, closed, onVote, busyId, feedback }) {
  const [pending, setPending] = useState(null);
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
        <span>
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

      {closed && proposal.rule_change_id && (
        <span className="vn-badge vn-badge--accent">
          <CheckCircle2 size={14} aria-hidden="true" /> Executed
        </span>
      )}
    </Card>
  );
}

export default function Governance() {
  const { isLoggedIn, wallet } = useAuth();
  const address = wallet?.address;
  const { loading, error, active, closed, summary, reload } = useGovernance(address);
  const [busyId, setBusyId] = useState("");
  const [feedback, setFeedback] = useState({});

  const cards = useMemo(
    () => [
      { label: "Active proposals", value: summary ? formatNumber(summary.active_count ?? active.length) : null },
      { label: "Pending execution", value: summary ? formatNumber(summary.passed_pending_execution_count ?? 0) : null },
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
        <h2 className="vn-panel-title">Active proposals</h2>
        {loading ? (
          <p className="vn-empty-note" style={{ margin: 0 }}>Loading proposals…</p>
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
                busyId={busyId}
                feedback={feedback}
              />
            ))}
          </div>
        )}
      </Card>

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
