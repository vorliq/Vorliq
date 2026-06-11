import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";

import AddressIdentity from "../components/AddressIdentity";
import AuthorityWriteNotice, { AUTHORITY_WRITES_DISABLED } from "../components/AuthorityWriteNotice";
import ErrorMessage from "../components/ErrorMessage";
import RiskNotice from "../components/RiskNotice";
import Spinner from "../components/Spinner";
import { useAuth } from "../context/AuthContext";
import api from "../helpers/api";
import { apiErrorMessage } from "../helpers/errors";

const categories = [
  ["mining_reward", "Mining Reward"],
  ["difficulty", "Block Difficulty"],
  ["loan_limit", "Maximum Loan Amount"],
  ["loan_interest", "Loan Interest Rate"],
  ["exchange_limit", "Community Request Limit"],
  ["general", "General Proposal"],
];

const tabs = [
  ["active", "Active Proposals"],
  ["propose", "Propose Change"],
  ["mine", "My Governance"],
  ["rules", "Rule Changes"],
  ["history", "All History"],
];

const categoryGuidance = {
  mining_reward: "Mining reward must be greater than 0 and no more than 1000 VLQ.",
  difficulty: "Difficulty must be an integer between 2 and 8.",
  loan_limit: "Loan limit must be greater than 0 and no more than 1000000 VLQ.",
  loan_interest: "Loan interest must be between 0 and 100 percent. Existing decimal-style values are still accepted.",
  exchange_limit: "Community request limit must be between 1 and 1000.",
  general: "General proposals are advisory. They can pass, but they do not automatically execute settings.",
};

const lifecycleStates = [
  ["active", "Open for VLQ-weighted voting before the proposal deadline."],
  ["passed_pending_execution", "Passed quorum and approval rules, then waits for the existing execution path to record the outcome."],
  ["executed", "The supported setting change or advisory record was applied and recorded."],
  ["rejected", "No vote weight reached the rejection threshold."],
  ["expired", "The voting deadline passed before the proposal reached a final outcome."],
  ["cancelled", "The proposer cancelled before votes were cast."],
];

const governanceLinks = [
  ["/treasury", "Treasury", "Community funding proposals and payout records"],
  ["/lending", "Lending", "Community loan votes and repayment lifecycle"],
  ["/blockchain", "Blockchain", "Blocks, transactions, and pending records"],
  ["/readiness", "Readiness", "Deployment and network readiness checks"],
  ["/audit", "Audit", "Public verification and audit records"],
];

const initialForm = {
  proposerAddress: "",
  title: "",
  category: "mining_reward",
  parameter: "",
  description: "",
};

function categoryLabel(category) {
  return categories.find(([value]) => value === category)?.[1] || String(category || "").replace(/_/g, " ");
}

function statusLabel(status) {
  const labels = {
    active: "Active",
    passed_pending_execution: "Passed pending execution",
    executed: "Executed",
    rejected: "Rejected",
    expired: "Expired",
    cancelled: "Cancelled",
  };
  return labels[status] || String(status || "unknown").replace(/_/g, " ");
}

function statusMeaning(status) {
  return lifecycleStates.find(([value]) => value === status)?.[1] || "This proposal is using a legacy or unknown status from the public API.";
}

function formatDate(timestamp) {
  if (!timestamp) return "Not recorded";
  return new Date(Number(timestamp) * 1000).toLocaleString();
}

function formatValue(value) {
  if (value === null || value === undefined || value === "") return "Not set";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function Governance() {
  const { wallet } = useAuth();
  const [activeTab, setActiveTab] = useState("active");
  const [activeProposals, setActiveProposals] = useState([]);
  const [allProposals, setAllProposals] = useState([]);
  const [settings, setSettings] = useState({});
  const [ruleChanges, setRuleChanges] = useState([]);
  const [summary, setSummary] = useState(null);
  const [myAddress, setMyAddress] = useState(wallet?.address || "");
  const [myGovernance, setMyGovernance] = useState({ created: [], voted: [], proposals: [] });
  const [form, setForm] = useState({ ...initialForm, proposerAddress: wallet?.address || "" });
  const [voteInputs, setVoteInputs] = useState({});
  const [expanded, setExpanded] = useState({});
  const [loading, setLoading] = useState(true);
  const [myLoading, setMyLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [cancellingId, setCancellingId] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  async function loadGovernance() {
    try {
      const [activeResponse, allResponse, settingsResponse, ruleChangesResponse, summaryResponse] = await Promise.all([
        api.get("/governance/proposals", { params: { status: "active", limit: 100 } }),
        api.get("/governance/all", { params: { limit: 200 } }),
        api.get("/governance/settings"),
        api.get("/governance/rule-changes", { params: { limit: 50 } }),
        api.get("/governance/summary"),
      ]);
      setActiveProposals(activeResponse.data.proposals || []);
      setAllProposals(allResponse.data.proposals || []);
      setSettings(settingsResponse.data.settings || {});
      setRuleChanges(ruleChangesResponse.data.rule_changes || []);
      setSummary(summaryResponse.data.summary || null);
      setErrorMessage("");
    } catch (error) {
      const message = apiErrorMessage(error, "Unable to load governance data.");
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadGovernance();
  }, []);

  useEffect(() => {
    if (wallet?.address) {
      setMyAddress(wallet.address);
      setForm((current) => ({ ...current, proposerAddress: current.proposerAddress || wallet.address }));
    }
  }, [wallet?.address]);

  async function loadMyGovernance(address = myAddress) {
    if (!address.trim()) {
      toast.error("Enter a wallet address.");
      return;
    }
    setMyLoading(true);
    try {
      const response = await api.get("/governance/my", { params: { address: address.trim() } });
      setMyGovernance({
        created: response.data.created || [],
        voted: response.data.voted || [],
        proposals: response.data.proposals || [],
      });
      setErrorMessage("");
    } catch (error) {
      const message = apiErrorMessage(error, "Unable to load governance activity.");
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setMyLoading(false);
    }
  }

  useEffect(() => {
    if (activeTab === "mine" && myAddress) {
      loadMyGovernance(myAddress);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submitProposal(event) {
    event.preventDefault();

    if (
      !form.proposerAddress.trim() ||
      !form.title.trim() ||
      !String(form.parameter).trim() ||
      form.description.trim().length < 50
    ) {
      toast.error("Fill in every field. The description must be at least 50 characters.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await api.post("/governance/propose", {
        proposer_address: form.proposerAddress.trim(),
        title: form.title.trim(),
        description: form.description.trim(),
        category: form.category,
        parameter: form.parameter,
      });
      toast.success(`Proposal created: ${response.data.proposal_id}`);
      setForm({ ...initialForm, proposerAddress: wallet?.address || "" });
      await loadGovernance();
      setActiveTab("active");
    } catch (error) {
      const message = apiErrorMessage(error, "Unable to create proposal.");
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  function showVoteInput(proposalId, vote) {
    setVoteInputs((current) => ({
      ...current,
      [proposalId]: {
        vote,
        address: current[proposalId]?.address || wallet?.address || "",
      },
    }));
  }

  async function submitVote(proposalId) {
    const voteInput = voteInputs[proposalId];
    if (!voteInput?.address.trim()) {
      toast.error("Enter the voter wallet address.");
      return;
    }

    try {
      await api.post("/governance/vote", {
        proposal_id: proposalId,
        voter_address: voteInput.address.trim(),
        voter_wallet_address: voteInput.address.trim(),
        vote: voteInput.vote,
      });
      toast.success("Vote cast successfully.");
      setVoteInputs((current) => ({ ...current, [proposalId]: undefined }));
      await loadGovernance();
      if (activeTab === "mine") {
        await loadMyGovernance();
      }
    } catch (error) {
      const message = apiErrorMessage(error, "Unable to cast vote.");
      setErrorMessage(message);
      toast.error(message);
    }
  }

  async function cancelProposal(proposalId, proposerAddress) {
    setCancellingId(proposalId);
    try {
      await api.post("/governance/cancel", {
        proposal_id: proposalId,
        proposer_address: proposerAddress,
      });
      toast.success("Proposal cancelled.");
      await loadGovernance();
      await loadMyGovernance(proposerAddress);
    } catch (error) {
      const message = apiErrorMessage(error, "Unable to cancel proposal.");
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setCancellingId("");
    }
  }

  const selectedSetting = settings[form.category];
  const placeholder = selectedSetting ? `Current value: ${selectedSetting.current}` : "Current value";

  const historyProposals = useMemo(
    () => allProposals.filter((proposal) => proposal.status !== "active"),
    [allProposals]
  );
  const settingsEntries = useMemo(() => Object.entries(settings || {}), [settings]);

  return (
    <div className="page">
      <section className="hero">
        <span className="eyebrow">Community Governance</span>
        <h1>Governance</h1>
        <p className="subtitle">
          Review supported network rule proposals, VLQ-weighted vote records, and exactly which software
          settings were executed.
        </p>
      </section>

      <ErrorMessage message={errorMessage} />
      <AuthorityWriteNotice />
      <RiskNotice />

      {summary && (
        <section className="grid stats-grid">
          <SummaryCard label="Active Proposals" value={summary.active_count || 0} />
          <SummaryCard label="Pending Execution" value={summary.passed_pending_execution_count || 0} />
          <SummaryCard label="Executed Rule Changes" value={summary.executed_count || 0} />
          <SummaryCard label="Total Votes" value={summary.total_votes || 0} />
        </section>
      )}

      <section className="card card-pad stack" aria-label="Governance lifecycle clarity">
        <div className="section-title">
          <div>
            <span className="eyebrow">Lifecycle</span>
            <h2>How governance works</h2>
          </div>
        </div>
        <p>
          Governance is Vorliq's public rule-change and community decision record for its own blockchain.
          Members can read proposals, review current governable settings, and inspect executed rule-change
          history without wallet context.
        </p>
        <div className="lifecycle-grid">
          {lifecycleStates.map(([state, meaning]) => (
            <article className="lifecycle-step" key={state}>
              <span className={`status-badge ${state}`}>{statusLabel(state)}</span>
              <p>{meaning}</p>
            </article>
          ))}
        </div>
        <div className="risk-box">
          <strong>Wallet and operator context</strong>
          <p>
            Proposals and votes use a public wallet address and existing wallet context. This page does not
            ask for raw private keys or backup passwords. Public users can load their own governance
            records. Proposal, vote, and cancellation writes remain disabled until signed
            wallet authorization is verified; admin-only execution controls are not shown here.
          </p>
        </div>
        <div className="button-row" aria-label="Related governance areas">
          {governanceLinks.map(([to, label, detail]) => (
            <Link className="button secondary small-button" to={to} key={to} title={detail}>
              {label}
            </Link>
          ))}
        </div>
      </section>

      <section className="card card-pad stack" aria-label="Current governable settings">
        <div className="section-title">
          <div>
            <span className="eyebrow">Current Settings</span>
            <h2>Governable Settings</h2>
          </div>
        </div>
        {settingsEntries.length === 0 ? (
          <div className="empty-state">Current governable settings are unavailable from the public API right now.</div>
        ) : (
          <div className="governance-grid">
            {settingsEntries.map(([key, setting]) => (
              <article className="lifecycle-step" key={key}>
                <h3>{categoryLabel(key)}</h3>
                <div className="meta-item">
                  <span className="meta-label">Current</span>
                  <span className="meta-value">{formatValue(setting.current)}</span>
                </div>
                <div className="meta-item">
                  <span className="meta-label">Default</span>
                  <span className="meta-value">{formatValue(setting.default)}</span>
                </div>
                <p className="muted-text">{setting.changed ? "Changed by an executed governance record." : "Still matches the default setting."}</p>
              </article>
            ))}
          </div>
        )}
      </section>

      <div className="tab-list">
        {tabs.map(([value, label]) => (
          <button className={`tab-button ${activeTab === value ? "active" : ""}`} type="button" onClick={() => setActiveTab(value)} key={value}>
            {label}
          </button>
        ))}
      </div>

      {loading && <Spinner label="Loading governance..." />}

      {!loading && activeTab === "active" && (
        <section className="governance-grid" aria-label="Active proposals">
          {activeProposals.length === 0 ? (
            <div className="empty-state">No active proposals are open for voting.</div>
          ) : (
            activeProposals.map((proposal) => (
              <ProposalCard
                key={proposal.proposal_id}
                proposal={proposal}
                expanded={Boolean(expanded[proposal.proposal_id])}
                onToggle={() => setExpanded((current) => ({ ...current, [proposal.proposal_id]: !current[proposal.proposal_id] }))}
                voteInput={voteInputs[proposal.proposal_id]}
                onShowVote={showVoteInput}
                onVoteAddressChange={(value) =>
                  setVoteInputs((current) => ({
                    ...current,
                    [proposal.proposal_id]: { ...current[proposal.proposal_id], address: value },
                  }))
                }
                onSubmitVote={submitVote}
              />
            ))
          )}
        </section>
      )}

      {!loading && activeTab === "propose" && (
        <section className="card card-pad stack">
          <div className="section-title">
            <div>
              <span className="eyebrow">Governable Settings</span>
              <h2>Propose Change</h2>
            </div>
          </div>
          <div className="risk-box">
            <strong>Validation guidance</strong>
            <p>{categoryGuidance[form.category]}</p>
          </div>
          <div className="risk-box">
            <strong>Wallet context</strong>
            <p>Submit proposals with a public wallet address. Do not enter private keys or backup passwords in governance forms.</p>
          </div>
          <form className="form" onSubmit={submitProposal}>
            <div className="field">
              <label htmlFor="governance-proposer">Proposer Wallet Address</label>
              <input id="governance-proposer" className="input" value={form.proposerAddress} onChange={(event) => updateForm("proposerAddress", event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="governance-title">Title</label>
              <input id="governance-title" className="input" maxLength={160} value={form.title} onChange={(event) => updateForm("title", event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="governance-category">Category</label>
              <select id="governance-category" className="input" value={form.category} onChange={(event) => updateForm("category", event.target.value)}>
                {categories.map(([value, label]) => (
                  <option value={value} key={value}>{label}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="governance-parameter">Proposed Value</label>
              <input id="governance-parameter" className="input" type={form.category === "general" ? "text" : "number"} placeholder={placeholder} value={form.parameter} onChange={(event) => updateForm("parameter", event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="governance-description">Description</label>
              <textarea id="governance-description" className="textarea" minLength={50} value={form.description} onChange={(event) => updateForm("description", event.target.value)} />
            </div>
            <button className="button" type="submit" disabled={AUTHORITY_WRITES_DISABLED || submitting}>
              {submitting ? "Submitting..." : "Submit Proposal"}
            </button>
          </form>
        </section>
      )}

      {!loading && activeTab === "mine" && (
        <section className="card card-pad stack">
          <div className="section-title">
            <div>
              <span className="eyebrow">My Governance</span>
              <h2>Created Proposals and Votes</h2>
            </div>
          </div>
          <div className="inline-form">
            <input className="input" aria-label="Governance wallet address" value={myAddress} onChange={(event) => setMyAddress(event.target.value)} placeholder="Wallet address" />
            <button className="button" type="button" onClick={() => loadMyGovernance()}>
              Load Activity
            </button>
          </div>
          {myLoading && <Spinner label="Loading governance activity..." />}
          {!myLoading && myGovernance.proposals.length === 0 && <div className="empty-state">No proposals or votes found for this wallet.</div>}
          <div className="governance-grid">
            {myGovernance.proposals.map((proposal) => (
              <ProposalCard
                key={`my-${proposal.proposal_id}`}
                proposal={proposal}
                compact
                canCancel={
                  proposal.status === "active" &&
                  proposal.proposer_address === myAddress &&
                  Object.keys(proposal.votes || {}).length === 0
                }
                cancelling={cancellingId === proposal.proposal_id}
                onCancel={() => cancelProposal(proposal.proposal_id, proposal.proposer_address)}
              />
            ))}
          </div>
        </section>
      )}

      {!loading && activeTab === "rules" && (
        <RuleChanges ruleChanges={ruleChanges} />
      )}

      {!loading && activeTab === "history" && (
        <section className="card card-pad stack">
          <div className="section-title">
            <div>
              <span className="eyebrow">Proposal History</span>
              <h2>All Lifecycle Records</h2>
            </div>
          </div>
          {historyProposals.length === 0 ? (
            <div className="empty-state">No completed governance history yet.</div>
          ) : (
            <div className="governance-grid">
              {historyProposals.map((proposal) => (
                <ProposalCard key={`history-${proposal.proposal_id}`} proposal={proposal} compact />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function SummaryCard({ label, value }) {
  return (
    <div className="card card-pad stat-card compact-stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}

function ProposalCard({
  proposal,
  expanded = false,
  onToggle,
  voteInput,
  onShowVote,
  onVoteAddressChange,
  onSubmitVote,
  compact = false,
  canCancel = false,
  cancelling = false,
  onCancel,
}) {
  const votes = proposal.votes || {};
  const totalWeight = Number(proposal.yes_vote_weight || 0) + Number(proposal.no_vote_weight || 0);
  const quorum = Number(proposal.quorum || 0);
  const yesPercent = totalWeight > 0 ? (Number(proposal.yes_vote_weight || 0) / totalWeight) * 100 : 0;
  const noPercent = totalWeight > 0 ? 100 - yesPercent : 0;
  const quorumPercent = quorum > 0 ? Math.min((totalWeight / quorum) * 100, 100) : 0;
  const proposalDescription = proposal.description || "No governance proposal description provided.";
  const description =
    expanded || compact || proposalDescription.length <= 220
      ? proposalDescription
      : `${proposalDescription.slice(0, 220)}...`;

  return (
    <article className="governance-card">
      <div className="section-title">
        <div>
          <h2>{proposal.title || "Untitled governance proposal"}</h2>
          <span className={`status-badge ${proposal.status}`}>{statusLabel(proposal.status)}</span>
        </div>
        <span className={`governance-badge ${proposal.category}`}>{categoryLabel(proposal.category)}</span>
      </div>
      <p>{description}</p>
      {!compact && proposalDescription.length > 220 && onToggle && (
        <button className="text-button" type="button" onClick={onToggle}>
          {expanded ? "Show Less" : "Read More"}
        </button>
      )}
      <p className="muted-text">{statusMeaning(proposal.status)}</p>
      <div className="meta-item">
        <span className="meta-label">Proposal ID</span>
        <span className="meta-value mono-wrap">{proposal.proposal_id}</span>
      </div>
      <div className="meta-item">
        <span className="meta-label">Proposer</span>
        <span className="meta-value"><AddressIdentity address={proposal.proposer_address} compact /></span>
      </div>
      <div className="meta-item">
        <span className="meta-label">Deadline</span>
        <span className="meta-value">{formatDate(proposal.voting_deadline)}</span>
      </div>
      <div className="meta-item">
        <span className="meta-label">Current Value</span>
        <span className="meta-value">{formatValue(proposal.current_value)}</span>
      </div>
      <div className="meta-item">
        <span className="meta-label">Proposed Value</span>
        <span className="meta-value">{formatValue(proposal.parameter)}</span>
      </div>
      {proposal.execution_result && (
        <div className="risk-box">
          <strong>Execution status</strong>
          <p>{proposal.execution_result.message || "Proposal executed."}</p>
        </div>
      )}
      {proposal.execution_error && (
        <div className="error-message">Execution error: {proposal.execution_error}</div>
      )}
      <div className="vote-bar-wrap">
        <div className="vote-bar" aria-label="Vote split">
          <span className="vote-yes" style={{ width: `${yesPercent}%` }} />
          <span className="vote-no" style={{ width: `${noPercent}%` }} />
        </div>
        <div className="vote-weights">
          <span>Yes: {proposal.yes_vote_weight || 0} VLQ</span>
          <span>No: {proposal.no_vote_weight || 0} VLQ</span>
        </div>
        <p className="muted-text">Quorum progress: {quorumPercent.toFixed(0)}% ({totalWeight} / {quorum} VLQ)</p>
      </div>
      {!compact && proposal.status === "active" && (
        <div className="risk-box">
          <strong>Voting context</strong>
          <p>Votes use public wallet addresses and VLQ balance weight. This form never needs a raw private key.</p>
        </div>
      )}
      {proposal.rule_change_id && (
        <p className="muted-text">Rule change: <span className="mono-wrap">{proposal.rule_change_id}</span></p>
      )}
      {proposal.status_history?.length > 0 && (
        <details>
          <summary>Status history</summary>
          <div className="governance-timeline">
            {proposal.status_history.map((entry, index) => (
              <article className="timeline-entry" key={`${proposal.proposal_id}-history-${index}`}>
                <strong>{statusLabel(entry.status)}</strong>
                <p>{entry.note}</p>
                <span className="muted-text">{formatDate(entry.timestamp)}</span>
              </article>
            ))}
          </div>
        </details>
      )}
      {!compact && proposal.status === "active" && (
        <>
          <div className="button-row">
            <button className="button" type="button" disabled={AUTHORITY_WRITES_DISABLED} onClick={() => onShowVote(proposal.proposal_id, "yes")}>
              Vote Yes
            </button>
            <button className="button secondary" type="button" disabled={AUTHORITY_WRITES_DISABLED} onClick={() => onShowVote(proposal.proposal_id, "no")}>
              Vote No
            </button>
          </div>
          {voteInput && (
            <div className="inline-form">
              <input className="input" aria-label="Voter wallet address" value={voteInput.address || ""} onChange={(event) => onVoteAddressChange(event.target.value)} placeholder="Voter wallet address" />
              <button className="button" type="button" disabled={AUTHORITY_WRITES_DISABLED} onClick={() => onSubmitVote(proposal.proposal_id)}>
                Submit {voteInput.vote}
              </button>
            </div>
          )}
        </>
      )}
      {canCancel && (
        <button className="button secondary" type="button" disabled={AUTHORITY_WRITES_DISABLED || cancelling} onClick={onCancel}>
          {cancelling ? "Cancelling..." : "Cancel Proposal"}
        </button>
      )}
      {Object.keys(votes).length > 0 && compact && (
        <p className="muted-text">{Object.keys(votes).length} vote record(s)</p>
      )}
    </article>
  );
}

function RuleChanges({ ruleChanges }) {
  return (
    <section className="card card-pad stack">
      <div className="section-title">
        <div>
          <span className="eyebrow">Rule Changes</span>
          <h2>Executed Settings Timeline</h2>
        </div>
      </div>
      {ruleChanges.length === 0 ? (
        <div className="empty-state">No executed rule changes have been recorded yet.</div>
      ) : (
        <div className="governance-timeline">
          {ruleChanges.map((change) => (
            <article className="timeline-entry" key={change.rule_change_id}>
              <h3>{categoryLabel(change.category)}</h3>
              <p>{formatValue(change.old_value)} to {formatValue(change.new_value)}</p>
              <p className="muted-text">Proposal <span className="mono-wrap">{change.proposal_id}</span></p>
              <p className="muted-text">Rule change <span className="mono-wrap">{change.rule_change_id}</span></p>
              <p className="muted-text">Applied {formatDate(change.applied_at)} at block {change.applied_block_height}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export default Governance;
