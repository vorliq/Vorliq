import { useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";

import ErrorMessage from "../components/ErrorMessage";
import RiskNotice from "../components/RiskNotice";
import Spinner from "../components/Spinner";
import api from "../helpers/api";
import { apiErrorMessage } from "../helpers/errors";

const categories = [
  ["mining_reward", "Mining Reward"],
  ["difficulty", "Block Difficulty"],
  ["loan_limit", "Maximum Loan Amount"],
  ["loan_interest", "Loan Interest Rate"],
  ["exchange_limit", "Exchange Offer Limit"],
  ["general", "General Proposal"],
];

const initialForm = {
  proposerAddress: "",
  title: "",
  category: "mining_reward",
  parameter: "",
  description: "",
};

function shortAddress(address) {
  if (!address) return "";
  return address.length > 12 ? `${address.slice(0, 12)}...` : address;
}

function categoryLabel(category) {
  return categories.find(([value]) => value === category)?.[1] || category;
}

function formatDate(timestamp) {
  return new Date(timestamp * 1000).toLocaleString();
}

function Governance() {
  const [activeTab, setActiveTab] = useState("active");
  const [activeProposals, setActiveProposals] = useState([]);
  const [allProposals, setAllProposals] = useState([]);
  const [settings, setSettings] = useState({});
  const [form, setForm] = useState(initialForm);
  const [voteInputs, setVoteInputs] = useState({});
  const [expanded, setExpanded] = useState({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function loadGovernance() {
    try {
      const [activeResponse, allResponse, settingsResponse] = await Promise.all([
        api.get("/governance/proposals"),
        api.get("/governance/all"),
        api.get("/governance/settings"),
      ]);
      setActiveProposals(activeResponse.data.proposals || []);
      setAllProposals(allResponse.data.proposals || []);
      setSettings(settingsResponse.data.settings || {});
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

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submitProposal(event) {
    event.preventDefault();

    if (
      !form.proposerAddress.trim() ||
      !form.title.trim() ||
      !form.parameter ||
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
      setForm(initialForm);
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
        address: current[proposalId]?.address || "",
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
    } catch (error) {
      const message = apiErrorMessage(error, "Unable to cast vote.");
      setErrorMessage(message);
      toast.error(message);
    }
  }

  const passedProposals = useMemo(
    () => allProposals.filter((proposal) => proposal.status === "passed"),
    [allProposals]
  );

  const selectedSetting = settings[form.category];
  const placeholder = selectedSetting ? `Current value: ${selectedSetting.current}` : "Current value";

  return (
    <div className="page">
      <section className="hero">
        <span className="eyebrow">Community Governance</span>
        <h1>Governance</h1>
        <p className="subtitle">
          VLQ holders can propose network changes, vote with balance-weighted power, and apply
          approved changes automatically.
        </p>
      </section>

      <ErrorMessage message={errorMessage} />
      <RiskNotice />

      <div className="tab-list">
        <button className={`tab-button ${activeTab === "active" ? "active" : ""}`} type="button" onClick={() => setActiveTab("active")}>
          Active Proposals
        </button>
        <button className={`tab-button ${activeTab === "propose" ? "active" : ""}`} type="button" onClick={() => setActiveTab("propose")}>
          Propose a Change
        </button>
        <button className={`tab-button ${activeTab === "passed" ? "active" : ""}`} type="button" onClick={() => setActiveTab("passed")}>
          Passed Changes
        </button>
        <button className={`tab-button ${activeTab === "settings" ? "active" : ""}`} type="button" onClick={() => setActiveTab("settings")}>
          Current Settings
        </button>
      </div>

      {loading && <Spinner label="Loading governance..." />}

      {!loading && activeTab === "active" && (
        <section className="governance-grid">
          {activeProposals.length === 0 ? (
            <div className="empty-state">No active proposals are open for voting.</div>
          ) : (
            activeProposals.map((proposal) => (
              <ProposalCard
                key={proposal.proposal_id}
                proposal={proposal}
                expanded={Boolean(expanded[proposal.proposal_id])}
                onToggle={() =>
                  setExpanded((current) => ({
                    ...current,
                    [proposal.proposal_id]: !current[proposal.proposal_id],
                  }))
                }
                voteInput={voteInputs[proposal.proposal_id]}
                onShowVote={showVoteInput}
                onVoteAddressChange={(value) =>
                  setVoteInputs((current) => ({
                    ...current,
                    [proposal.proposal_id]: {
                      ...current[proposal.proposal_id],
                      address: value,
                    },
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
          <h2>Propose a Change</h2>
          <form className="form" onSubmit={submitProposal}>
            <div className="field">
              <label htmlFor="governance-proposer">Proposer Wallet Address</label>
              <input id="governance-proposer" className="input" value={form.proposerAddress} onChange={(event) => updateForm("proposerAddress", event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="governance-title">Title</label>
              <input id="governance-title" className="input" maxLength={100} value={form.title} onChange={(event) => updateForm("title", event.target.value)} />
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
            <button className="button" type="submit" disabled={submitting}>
              {submitting ? "Submitting..." : "Submit Proposal"}
            </button>
          </form>
        </section>
      )}

      {!loading && activeTab === "passed" && (
        <section className="card card-pad stack">
          <h2>Passed Changes</h2>
          {passedProposals.length === 0 ? (
            <div className="empty-state">No proposals have passed yet.</div>
          ) : (
            <div className="governance-timeline">
              {passedProposals.map((proposal) => (
                <article className="timeline-entry" key={proposal.proposal_id}>
                  <h3>{proposal.title}</h3>
                  <span className={`governance-badge ${proposal.category}`}>{categoryLabel(proposal.category)}</span>
                  <p>Old value: {String(proposal.current_value)}</p>
                  <p>New value: {String(proposal.parameter)}</p>
                  <p className="muted-text">Passed {formatDate(proposal.passed_timestamp || proposal.timestamp)}</p>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {!loading && activeTab === "settings" && (
        <section className="card card-pad stack">
          <h2>Current Settings</h2>
          <div className="table-wrap">
            <table className="stats-table">
              <thead>
                <tr>
                  <th>Parameter</th>
                  <th>Default Value</th>
                  <th>Current Value</th>
                  <th>Changed</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(settings).map(([key, value]) => (
                  <tr key={key} className={value.changed ? "changed-row" : ""}>
                    <td>{categoryLabel(key)}</td>
                    <td>{String(value.default)}</td>
                    <td>{String(value.current)}</td>
                    <td>{value.changed ? "Yes" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function ProposalCard({
  proposal,
  expanded,
  onToggle,
  voteInput,
  onShowVote,
  onVoteAddressChange,
  onSubmitVote,
}) {
  const totalWeight = Number(proposal.yes_vote_weight) + Number(proposal.no_vote_weight);
  const yesPercent = totalWeight > 0 ? (Number(proposal.yes_vote_weight) / totalWeight) * 100 : 0;
  const noPercent = totalWeight > 0 ? 100 - yesPercent : 0;
  const description =
    expanded || proposal.description.length <= 200
      ? proposal.description
      : `${proposal.description.slice(0, 200)}...`;

  return (
    <article className="governance-card">
      <div className="section-title">
        <h2>{proposal.title}</h2>
        <span className={`governance-badge ${proposal.category}`}>{categoryLabel(proposal.category)}</span>
      </div>
      <p>{description}</p>
      {proposal.description.length > 200 && (
        <button className="text-button" type="button" onClick={onToggle}>
          {expanded ? "Show Less" : "Read More"}
        </button>
      )}
      <div className="meta-item">
        <span className="meta-label">Proposer</span>
        <span className="meta-value">{shortAddress(proposal.proposer_address)}</span>
      </div>
      <div className="meta-item">
        <span className="meta-label">Voting Deadline</span>
        <span className="meta-value">{formatDate(proposal.voting_deadline)}</span>
      </div>
      <div className="vote-bar-wrap">
        <div className="vote-bar">
          <span className="vote-yes" style={{ width: `${yesPercent}%` }} />
          <span className="vote-no" style={{ width: `${noPercent}%` }} />
        </div>
        <div className="vote-weights">
          <span>Yes: {proposal.yes_vote_weight} VLQ</span>
          <span>No: {proposal.no_vote_weight} VLQ</span>
        </div>
      </div>
      <p className="muted-text">Total voting weight: {totalWeight} VLQ. Quorum: {proposal.quorum} VLQ.</p>
      <span className={`status-badge ${proposal.status}`}>{proposal.status}</span>
      <div className="button-row">
        <button className="button" type="button" onClick={() => onShowVote(proposal.proposal_id, "yes")}>
          Vote Yes
        </button>
        <button className="button secondary" type="button" onClick={() => onShowVote(proposal.proposal_id, "no")}>
          Vote No
        </button>
      </div>
      {voteInput && (
        <div className="inline-form">
          <input className="input" aria-label="Voter wallet address" value={voteInput.address || ""} onChange={(event) => onVoteAddressChange(event.target.value)} placeholder="Voter wallet address" />
          <button className="button" type="button" onClick={() => onSubmitVote(proposal.proposal_id)}>
            Submit {voteInput.vote}
          </button>
        </div>
      )}
    </article>
  );
}

export default Governance;
