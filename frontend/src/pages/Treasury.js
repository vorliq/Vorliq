import { useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";

import ErrorMessage from "../components/ErrorMessage";
import RiskNotice from "../components/RiskNotice";
import Spinner from "../components/Spinner";
import api from "../helpers/api";
import { apiErrorMessage } from "../helpers/errors";

const categories = ["development", "marketing", "community", "infrastructure"];
const initialForm = {
  proposerAddress: "",
  title: "",
  category: "development",
  description: "",
  requestedAmount: "",
  recipientAddress: "",
};

function Treasury() {
  const [activeTab, setActiveTab] = useState("balance");
  const [balance, setBalance] = useState(null);
  const [activeProposals, setActiveProposals] = useState([]);
  const [allProposals, setAllProposals] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [voteInputs, setVoteInputs] = useState({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function loadTreasury() {
    try {
      const [balanceResponse, activeResponse, allResponse] = await Promise.all([
        api.get("/treasury/balance"),
        api.get("/treasury/proposals"),
        api.get("/treasury/all"),
      ]);
      setBalance(balanceResponse.data);
      setActiveProposals(activeResponse.data.proposals || []);
      setAllProposals(allResponse.data.proposals || []);
      setErrorMessage("");
    } catch (error) {
      const message = apiErrorMessage(error, "Unable to load treasury data.");
      setErrorMessage(message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTreasury();
  }, []);

  const passedProposals = useMemo(
    () => allProposals.filter((proposal) => proposal.status === "passed"),
    [allProposals]
  );

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submitProposal(event) {
    event.preventDefault();
    if (
      !form.proposerAddress.trim() ||
      !form.title.trim() ||
      !form.description.trim() ||
      !form.requestedAmount ||
      !form.recipientAddress.trim()
    ) {
      toast.error("Fill in every treasury proposal field.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await api.post("/treasury/propose", {
        proposer_address: form.proposerAddress.trim(),
        title: form.title.trim(),
        category: form.category,
        description: form.description.trim(),
        requested_amount: Number(form.requestedAmount),
        recipient_address: form.recipientAddress.trim(),
      });
      toast.success(`Treasury proposal created: ${response.data.proposal_id}`);
      setForm(initialForm);
      await loadTreasury();
      setActiveTab("active");
    } catch (error) {
      const message = apiErrorMessage(error, "Unable to submit treasury proposal.");
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  function showVote(proposalId, vote) {
    setVoteInputs((current) => ({
      ...current,
      [proposalId]: { vote, address: current[proposalId]?.address || "" },
    }));
  }

  async function submitVote(proposalId) {
    const voteInput = voteInputs[proposalId];
    if (!voteInput?.address.trim()) {
      toast.error("Enter your wallet address to vote.");
      return;
    }

    try {
      await api.post("/treasury/vote", {
        proposal_id: proposalId,
        voter_address: voteInput.address.trim(),
        vote: voteInput.vote,
      });
      toast.success("Treasury vote cast.");
      setVoteInputs((current) => ({ ...current, [proposalId]: undefined }));
      await loadTreasury();
    } catch (error) {
      const message = apiErrorMessage(error, "Unable to cast treasury vote.");
      setErrorMessage(message);
      toast.error(message);
    }
  }

  return (
    <div className="page">
      <section className="hero">
        <span className="eyebrow">Community Fund</span>
        <h1>Treasury</h1>
        <p className="subtitle">
          Five percent of every mining reward flows into the Vorliq community treasury so VLQ
          holders can fund network improvements together.
        </p>
      </section>

      <ErrorMessage message={errorMessage} />
      <RiskNotice />

      <div className="tab-list">
        {[
          ["balance", "Treasury Balance"],
          ["active", "Active Proposals"],
          ["submit", "Submit Proposal"],
          ["passed", "Passed Proposals"],
        ].map(([id, label]) => (
          <button className={`tab-button ${activeTab === id ? "active" : ""}`} type="button" onClick={() => setActiveTab(id)} key={id}>
            {label}
          </button>
        ))}
      </div>

      {loading && <Spinner label="Loading treasury..." />}

      {!loading && activeTab === "balance" && (
        <section className="card card-pad stack">
          <span className="stat-label">Current Treasury Balance</span>
          <div className="hero-number">{formatNumber(balance?.balance || 0)} VLQ</div>
          <p>
            The Vorliq treasury receives five percent of every mining reward. Those funds are held
            at the shared treasury address and can be spent only through community proposals voted
            on by VLQ holders.
          </p>
        </section>
      )}

      {!loading && activeTab === "active" && (
        <section className="governance-grid">
          {activeProposals.length === 0 ? (
            <div className="empty-state">No active treasury proposals are open.</div>
          ) : (
            activeProposals.map((proposal) => (
              <TreasuryProposalCard
                key={proposal.proposal_id}
                proposal={proposal}
                voteInput={voteInputs[proposal.proposal_id]}
                onShowVote={showVote}
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

      {!loading && activeTab === "submit" && (
        <section className="card card-pad">
          <form className="form" onSubmit={submitProposal}>
            <div className="field">
              <label>Proposer Wallet Address</label>
              <input className="input" value={form.proposerAddress} onChange={(event) => updateForm("proposerAddress", event.target.value)} />
            </div>
            <div className="field">
              <label>Title</label>
              <input className="input" value={form.title} onChange={(event) => updateForm("title", event.target.value)} />
            </div>
            <div className="field">
              <label>Category</label>
              <select className="input" value={form.category} onChange={(event) => updateForm("category", event.target.value)}>
                {categories.map((category) => (
                  <option value={category} key={category}>{titleCase(category)}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Description</label>
              <textarea className="textarea" value={form.description} onChange={(event) => updateForm("description", event.target.value)} />
            </div>
            <div className="field">
              <label>Requested Amount</label>
              <input className="input" type="number" min="0" max={balance?.balance || 0} value={form.requestedAmount} onChange={(event) => updateForm("requestedAmount", event.target.value)} placeholder={`Maximum ${formatNumber(balance?.balance || 0)} VLQ`} />
            </div>
            <div className="field">
              <label>Recipient Address</label>
              <input className="input" value={form.recipientAddress} onChange={(event) => updateForm("recipientAddress", event.target.value)} />
            </div>
            <button className="button" type="submit" disabled={submitting}>
              {submitting ? "Submitting..." : "Submit Treasury Proposal"}
            </button>
          </form>
        </section>
      )}

      {!loading && activeTab === "passed" && (
        <section className="timeline">
          {passedProposals.length === 0 ? (
            <div className="empty-state">No treasury spending proposals have passed yet.</div>
          ) : (
            passedProposals.map((proposal) => (
              <article className="card card-pad" key={proposal.proposal_id}>
                <span className="eyebrow">{titleCase(proposal.category)}</span>
                <h2>{proposal.title}</h2>
                <p>{proposal.description}</p>
                <strong>{formatNumber(proposal.requested_amount)} VLQ sent to {shortAddress(proposal.recipient_address)}</strong>
              </article>
            ))
          )}
        </section>
      )}
    </div>
  );
}

function TreasuryProposalCard({ proposal, voteInput, onShowVote, onVoteAddressChange, onSubmitVote }) {
  const yes = Number(proposal.yes_vote_weight || 0);
  const no = Number(proposal.no_vote_weight || 0);
  const total = yes + no;
  const yesPercent = total ? (yes / total) * 100 : 0;

  return (
    <article className="card card-pad stack">
      <div className="section-title">
        <h2>{proposal.title}</h2>
        <span className="badge forum-category">{titleCase(proposal.category)}</span>
      </div>
      <p>{proposal.description}</p>
      <div className="block-meta">
        <div className="meta-item"><span className="meta-label">Amount</span><span className="meta-value">{formatNumber(proposal.requested_amount)} VLQ</span></div>
        <div className="meta-item"><span className="meta-label">Recipient</span><span className="meta-value">{shortAddress(proposal.recipient_address)}</span></div>
        <div className="meta-item"><span className="meta-label">Deadline</span><span className="meta-value">{new Date(proposal.voting_deadline * 1000).toLocaleString()}</span></div>
      </div>
      <div className="vote-bar"><span style={{ width: `${yesPercent}%` }} /></div>
      <p>Yes {formatNumber(yes)} VLQ · No {formatNumber(no)} VLQ · Quorum {total >= proposal.quorum ? "met" : `${formatNumber(total)} / ${proposal.quorum} VLQ`}</p>
      <div className="actions">
        <button className="button" type="button" onClick={() => onShowVote(proposal.proposal_id, "yes")}>Vote Yes</button>
        <button className="button secondary" type="button" onClick={() => onShowVote(proposal.proposal_id, "no")}>Vote No</button>
      </div>
      {voteInput && (
        <div className="inline-form">
          <input className="input" aria-label="Your wallet address for treasury vote" placeholder="Your wallet address" value={voteInput.address} onChange={(event) => onVoteAddressChange(event.target.value)} />
          <button className="button" type="button" onClick={() => onSubmitVote(proposal.proposal_id)}>Cast Vote</button>
        </div>
      )}
    </article>
  );
}

function shortAddress(address) {
  if (!address) return "Unknown";
  return address.length > 12 ? `${address.slice(0, 12)}...` : address;
}

function titleCase(value) {
  return String(value).replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatNumber(value) {
  return Number(value).toFixed(8).replace(/\.?0+$/, "");
}

export default Treasury;
