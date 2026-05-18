import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";

import AddressIdentity from "../components/AddressIdentity";
import ErrorMessage from "../components/ErrorMessage";
import RiskNotice from "../components/RiskNotice";
import Spinner from "../components/Spinner";
import { useAuth } from "../context/AuthContext";
import api from "../helpers/api";
import { apiErrorMessage } from "../helpers/errors";

const categories = ["development", "marketing", "community", "infrastructure", "security", "education", "other"];
const tabs = [
  ["overview", "Overview"],
  ["active", "Active Proposals"],
  ["submit", "Submit Proposal"],
  ["mine", "My Treasury"],
  ["ledger", "Treasury Ledger"],
  ["history", "History"],
];
const initialForm = {
  proposerAddress: "",
  title: "",
  category: "development",
  description: "",
  requestedAmount: "",
  recipientAddress: "",
};

function Treasury() {
  const { wallet } = useAuth();
  const [activeTab, setActiveTab] = useState("overview");
  const [balance, setBalance] = useState(null);
  const [summary, setSummary] = useState(null);
  const [ledger, setLedger] = useState([]);
  const [activeProposals, setActiveProposals] = useState([]);
  const [allProposals, setAllProposals] = useState([]);
  const [myAddress, setMyAddress] = useState(wallet?.address || "");
  const [myTreasury, setMyTreasury] = useState({ created: [], voted: [], received: [], proposals: [] });
  const [form, setForm] = useState({ ...initialForm, proposerAddress: wallet?.address || "" });
  const [voteInputs, setVoteInputs] = useState({});
  const [expanded, setExpanded] = useState({});
  const [loading, setLoading] = useState(true);
  const [myLoading, setMyLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [cancellingId, setCancellingId] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  async function loadTreasury() {
    try {
      const [balanceResponse, summaryResponse, activeResponse, allResponse, ledgerResponse] = await Promise.all([
        api.get("/treasury/balance"),
        api.get("/treasury/summary"),
        api.get("/treasury/proposals", { params: { status: "active", limit: 100 } }),
        api.get("/treasury/all", { params: { limit: 200 } }),
        api.get("/treasury/ledger", { params: { limit: 25 } }),
      ]);
      setBalance(balanceResponse.data);
      setSummary(summaryResponse.data.summary || null);
      setActiveProposals(activeResponse.data.proposals || []);
      setAllProposals(allResponse.data.proposals || []);
      setLedger(ledgerResponse.data.entries || []);
      setErrorMessage("");
    } catch (error) {
      const message = apiErrorMessage(error, "Unable to load treasury data.");
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTreasury();
  }, []);

  useEffect(() => {
    if (wallet?.address) {
      setMyAddress(wallet.address);
      setForm((current) => ({ ...current, proposerAddress: current.proposerAddress || wallet.address }));
    }
  }, [wallet?.address]);

  async function loadMyTreasury(address = myAddress) {
    if (!address.trim()) {
      toast.error("Enter a wallet address.");
      return;
    }
    setMyLoading(true);
    try {
      const response = await api.get("/treasury/my", { params: { address: address.trim() } });
      setMyTreasury({
        created: response.data.created || [],
        voted: response.data.voted || [],
        received: response.data.received || [],
        proposals: response.data.proposals || [],
      });
      setErrorMessage("");
    } catch (error) {
      const message = apiErrorMessage(error, "Unable to load treasury activity.");
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setMyLoading(false);
    }
  }

  useEffect(() => {
    if (activeTab === "mine" && myAddress) {
      loadMyTreasury(myAddress);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const historyProposals = useMemo(
    () => allProposals.filter((proposal) => proposal.status !== "active"),
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
      form.description.trim().length < 30 ||
      !form.requestedAmount ||
      !form.recipientAddress.trim()
    ) {
      toast.error("Fill in every treasury proposal field. Description must be at least 30 characters.");
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
      setForm({ ...initialForm, proposerAddress: wallet?.address || "" });
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
      [proposalId]: { vote, address: current[proposalId]?.address || wallet?.address || "" },
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
      if (activeTab === "mine") {
        await loadMyTreasury();
      }
    } catch (error) {
      const message = apiErrorMessage(error, "Unable to cast treasury vote.");
      setErrorMessage(message);
      toast.error(message);
    }
  }

  async function cancelProposal(proposalId, proposerAddress) {
    setCancellingId(proposalId);
    try {
      await api.post("/treasury/cancel", {
        proposal_id: proposalId,
        proposer_address: proposerAddress,
      });
      toast.success("Treasury proposal cancelled.");
      await loadTreasury();
      await loadMyTreasury(proposerAddress);
    } catch (error) {
      const message = apiErrorMessage(error, "Unable to cancel proposal.");
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setCancellingId("");
    }
  }

  return (
    <div className="page">
      <section className="hero">
        <span className="eyebrow">Community Fund</span>
        <h1>Treasury</h1>
        <p className="subtitle">
          Five percent of every mining reward flows into the Vorliq community treasury. Spending is tracked through proposals, payout transactions, and a public ledger.
        </p>
      </section>

      <ErrorMessage message={errorMessage} />
      <RiskNotice />

      <div className="tab-list">
        {tabs.map(([id, label]) => (
          <button className={`tab-button ${activeTab === id ? "active" : ""}`} type="button" onClick={() => setActiveTab(id)} key={id}>
            {label}
          </button>
        ))}
      </div>

      {loading && <Spinner label="Loading treasury..." />}

      {!loading && activeTab === "overview" && (
        <Overview balance={balance} summary={summary} ledger={ledger} />
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
                expanded={Boolean(expanded[proposal.proposal_id])}
                onToggle={() => setExpanded((current) => ({ ...current, [proposal.proposal_id]: !current[proposal.proposal_id] }))}
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
        <section className="card card-pad stack">
          <div className="section-title">
            <div>
              <span className="eyebrow">Proposal Limits</span>
              <h2>Submit Treasury Proposal</h2>
            </div>
          </div>
          <div className="risk-box">
            <strong>Available treasury balance</strong>
            <p>Maximum request right now: {formatNumber(summary?.current_balance ?? balance?.balance ?? 0)} VLQ. Approval does not mean instant payout; a payout transaction must be mined before a proposal is paid.</p>
          </div>
          <form className="form" onSubmit={submitProposal}>
            <div className="field">
              <label htmlFor="treasury-proposer">Proposer Wallet Address</label>
              <input id="treasury-proposer" className="input" value={form.proposerAddress} onChange={(event) => updateForm("proposerAddress", event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="treasury-title">Title</label>
              <input id="treasury-title" className="input" maxLength={160} value={form.title} onChange={(event) => updateForm("title", event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="treasury-category">Category</label>
              <select id="treasury-category" className="input" value={form.category} onChange={(event) => updateForm("category", event.target.value)}>
                {categories.map((category) => (
                  <option value={category} key={category}>{titleCase(category)}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="treasury-description">Description</label>
              <textarea id="treasury-description" className="textarea" value={form.description} onChange={(event) => updateForm("description", event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="treasury-amount">Requested Amount</label>
              <input id="treasury-amount" className="input" type="number" min="0" max={summary?.current_balance ?? balance?.balance ?? 0} value={form.requestedAmount} onChange={(event) => updateForm("requestedAmount", event.target.value)} placeholder={`Maximum ${formatNumber(summary?.current_balance ?? balance?.balance ?? 0)} VLQ`} />
            </div>
            <div className="field">
              <label htmlFor="treasury-recipient">Recipient Address</label>
              <input id="treasury-recipient" className="input" value={form.recipientAddress} onChange={(event) => updateForm("recipientAddress", event.target.value)} />
            </div>
            <button className="button" type="submit" disabled={submitting}>
              {submitting ? "Submitting..." : "Submit Treasury Proposal"}
            </button>
          </form>
        </section>
      )}

      {!loading && activeTab === "mine" && (
        <section className="card card-pad stack">
          <div className="section-title">
            <div>
              <span className="eyebrow">My Treasury</span>
              <h2>Created, Voted, and Recipient Records</h2>
            </div>
          </div>
          <div className="inline-form">
            <input className="input" aria-label="Treasury wallet address" value={myAddress} onChange={(event) => setMyAddress(event.target.value)} placeholder="Wallet address" />
            <button className="button" type="button" onClick={() => loadMyTreasury()}>
              Load Activity
            </button>
          </div>
          {myLoading && <Spinner label="Loading treasury activity..." />}
          {!myLoading && myTreasury.proposals.length === 0 && <div className="empty-state">No treasury activity found for this wallet.</div>}
          <div className="governance-grid">
            {myTreasury.proposals.map((proposal) => (
              <TreasuryProposalCard
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

      {!loading && activeTab === "ledger" && (
        <Ledger entries={ledger} />
      )}

      {!loading && activeTab === "history" && (
        <section className="card card-pad stack">
          <div className="section-title">
            <div>
              <span className="eyebrow">Proposal History</span>
              <h2>Treasury Lifecycle Records</h2>
            </div>
          </div>
          {historyProposals.length === 0 ? (
            <div className="empty-state">No treasury history yet.</div>
          ) : (
            <div className="governance-grid">
              {historyProposals.map((proposal) => (
                <TreasuryProposalCard key={`history-${proposal.proposal_id}`} proposal={proposal} compact />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function Overview({ balance, summary, ledger }) {
  const stats = [
    ["Treasury Balance", `${formatNumber(summary?.current_balance ?? balance?.balance ?? 0)} VLQ`],
    ["Total Received", `${formatNumber(summary?.total_received ?? 0)} VLQ`],
    ["Total Paid", `${formatNumber(summary?.total_paid ?? 0)} VLQ`],
    ["Pending Payouts", `${formatNumber(summary?.pending_payouts ?? 0)} VLQ`],
    ["Active Proposals", summary?.active_proposal_count ?? 0],
    ["Paid Proposals", summary?.paid_proposal_count ?? 0],
  ];
  return (
    <section className="card card-pad stack">
      <div className="grid stats-grid">
        {stats.map(([label, value]) => (
          <div className="card card-pad stat-card compact-stat" key={label}>
            <span className="stat-label">{label}</span>
            <span className="stat-value">{value}</span>
          </div>
        ))}
      </div>
      <div className="section-title">
        <h2>Latest Ledger Entries</h2>
      </div>
      <Ledger entries={ledger.slice(0, 5)} compact />
    </section>
  );
}

function TreasuryProposalCard({
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
  const yes = Number(proposal.yes_vote_weight || 0);
  const no = Number(proposal.no_vote_weight || 0);
  const total = yes + no;
  const quorum = Number(proposal.quorum || 0);
  const yesPercent = total ? (yes / total) * 100 : 0;
  const noPercent = total ? 100 - yesPercent : 0;
  const quorumPercent = quorum ? Math.min((total / quorum) * 100, 100) : 0;
  const description = expanded || compact || proposal.description.length <= 220 ? proposal.description : `${proposal.description.slice(0, 220)}...`;

  return (
    <article className="card card-pad stack">
      <div className="section-title">
        <div>
          <h2>{proposal.title}</h2>
          <span className={`status-badge ${proposal.status}`}>{String(proposal.status).replace(/_/g, " ")}</span>
        </div>
        <span className="badge forum-category">{titleCase(proposal.category)}</span>
      </div>
      <p>{description}</p>
      {!compact && proposal.description.length > 220 && onToggle && (
        <button className="text-button" type="button" onClick={onToggle}>
          {expanded ? "Show Less" : "Read More"}
        </button>
      )}
      <div className="block-meta">
        <Meta label="Amount" value={`${formatNumber(proposal.requested_amount)} VLQ`} />
        <Meta label="Proposer" value={<AddressIdentity address={proposal.proposer_address} compact />} />
        <Meta label="Recipient" value={<AddressIdentity address={proposal.recipient_address} compact />} />
        <Meta label="Deadline" value={formatDate(proposal.voting_deadline)} />
      </div>
      <div className="vote-bar" aria-label="Treasury vote split">
        <span className="vote-yes" style={{ width: `${yesPercent}%` }} />
        <span className="vote-no" style={{ width: `${noPercent}%` }} />
      </div>
      <p className="muted-text">Yes {formatNumber(yes)} VLQ / No {formatNumber(no)} VLQ. Quorum progress {quorumPercent.toFixed(0)}% ({formatNumber(total)} / {formatNumber(quorum)} VLQ).</p>
      <div className="button-row">
        {proposal.payout_tx_id && (
          <Link className="button secondary small-button" to={`/tx/${proposal.payout_tx_id}`}>
            Payout Tx
          </Link>
        )}
        {proposal.payout_block_index !== null && proposal.payout_block_index !== undefined && (
          <Link className="button secondary small-button" to={`/block/${proposal.payout_block_index}`}>
            Block #{proposal.payout_block_index}
          </Link>
        )}
      </div>
      {proposal.status_history?.length > 0 && (
        <details>
          <summary>Status history</summary>
          <div className="governance-timeline">
            {proposal.status_history.map((entry, index) => (
              <article className="timeline-entry" key={`${proposal.proposal_id}-${index}`}>
                <strong>{String(entry.status).replace(/_/g, " ")}</strong>
                <p>{entry.note}</p>
                <span className="muted-text">{formatDate(entry.timestamp)}</span>
              </article>
            ))}
          </div>
        </details>
      )}
      {!compact && proposal.status === "active" && (
        <>
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
        </>
      )}
      {canCancel && (
        <button className="button secondary" type="button" disabled={cancelling} onClick={onCancel}>
          {cancelling ? "Cancelling..." : "Cancel Proposal"}
        </button>
      )}
    </article>
  );
}

function Ledger({ entries, compact = false }) {
  if (!entries.length) {
    return <div className="empty-state">No treasury ledger entries yet.</div>;
  }
  return (
    <section className={compact ? "stack" : "card card-pad stack"}>
      {!compact && (
        <div className="section-title">
          <div>
            <span className="eyebrow">Public Ledger</span>
            <h2>Treasury Inflows and Payouts</h2>
          </div>
        </div>
      )}
      <div className="history-list">
        {entries.map((entry) => (
          <div className="history-row" key={entry.ledger_id}>
            <span className={`status-badge ${entry.type}`}>{String(entry.type).replace(/_/g, " ")}</span>
            <span>{formatNumber(entry.amount)} VLQ</span>
            <span>{entry.description}</span>
            <span>{formatDate(entry.timestamp)}</span>
            <div className="button-row">
              {entry.tx_id && <Link className="button secondary small-button" to={`/tx/${entry.tx_id}`}>Tx</Link>}
              {entry.block_index !== null && entry.block_index !== undefined && <Link className="button secondary small-button" to={`/block/${entry.block_index}`}>Block</Link>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Meta({ label, value }) {
  return <div className="meta-item"><span className="meta-label">{label}</span><span className="meta-value">{value}</span></div>;
}

function titleCase(value) {
  return String(value).replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(timestamp) {
  if (!timestamp) return "Not recorded";
  return new Date(Number(timestamp) * 1000).toLocaleString();
}

function formatNumber(value) {
  const number = Number(value || 0);
  return number.toFixed(8).replace(/\.?0+$/, "");
}

export default Treasury;
