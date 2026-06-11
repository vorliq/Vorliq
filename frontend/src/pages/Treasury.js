import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";

import AddressIdentity from "../components/AddressIdentity";
import AuthorityPasswordField from "../components/AuthorityPasswordField";
import AuthorityWriteNotice from "../components/AuthorityWriteNotice";
import ErrorMessage from "../components/ErrorMessage";
import RiskNotice from "../components/RiskNotice";
import Spinner from "../components/Spinner";
import { useAuth } from "../context/AuthContext";
import api from "../helpers/api";
import { apiErrorMessage } from "../helpers/errors";
import { authorityErrorMessage, postSignedAuthority } from "../helpers/signedAuthority";

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

const lifecycleSteps = [
  {
    status: "active",
    title: "Pending vote",
    body: "This record is awaiting votes. No treasury VLQ has moved yet.",
  },
  {
    status: "passed_pending_payout",
    title: "Approved, pending payout",
    body: "The proposal passed and is waiting for a payout transaction to be mined.",
  },
  {
    status: "payout_pending",
    title: "Payout pending",
    body: "A payout transaction exists but has not become confirmed treasury movement yet.",
  },
  {
    status: "paid",
    title: "Paid",
    body: "The payout is confirmed on-chain and appears through the public explorer.",
  },
  {
    status: "rejected",
    title: "Rejected",
    body: "The request did not pass and should not spend treasury VLQ.",
  },
  {
    status: "expired",
    title: "Expired",
    body: "The voting window closed before approval or payout.",
  },
  {
    status: "cancelled",
    title: "Cancelled",
    body: "The proposer cancelled the request before treasury VLQ moved.",
  },
];

function treasuryBalanceNumber(summary, balance) {
  const value = summary?.current_balance ?? balance?.balance;
  return value === null || value === undefined || value === "" ? null : Number(value);
}

function Treasury() {
  const { isLoggedIn, wallet } = useAuth();
  const [activeTab, setActiveTab] = useState("overview");
  const [balance, setBalance] = useState(null);
  const [summary, setSummary] = useState(null);
  const [ledger, setLedger] = useState([]);
  const [activeProposals, setActiveProposals] = useState([]);
  const [allProposals, setAllProposals] = useState([]);
  const [myAddress, setMyAddress] = useState(wallet?.address || "");
  const [myTreasury, setMyTreasury] = useState({ created: [], voted: [], received: [], proposals: [] });
  const [form, setForm] = useState({ ...initialForm, proposerAddress: wallet?.address || "" });
  const [proposalPassword, setProposalPassword] = useState("");
  const [voteInputs, setVoteInputs] = useState({});
  const [cancelPasswords, setCancelPasswords] = useState({});
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
  const treasuryMax = treasuryBalanceNumber(summary, balance);
  const treasuryMaxDisplay = treasuryMax === null || Number.isNaN(treasuryMax) ? "Unavailable" : `${formatNumber(treasuryMax)} VLQ`;

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submitProposal(event) {
    event.preventDefault();
    if (
      !form.title.trim() ||
      form.description.trim().length < 30 ||
      !form.requestedAmount ||
      !form.recipientAddress.trim()
    ) {
      toast.error("Fill in every treasury proposal field. Description must be at least 30 characters.");
      return;
    }
    if (!isLoggedIn) {
      toast.error("Unlock your Vorliq wallet to sign this action locally.");
      return;
    }
    if (!proposalPassword) {
      toast.error("Enter your wallet password to sign this action locally.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await postSignedAuthority({
        action: "treasury.propose",
        walletPassword: proposalPassword,
        body: {
          title: form.title.trim(),
          category: form.category,
          description: form.description.trim(),
          requested_amount: Number(form.requestedAmount),
          recipient_address: form.recipientAddress.trim(),
        },
      });
      toast.success(`Treasury proposal created: ${response.data.proposal_id}`);
      setForm({ ...initialForm, proposerAddress: wallet?.address || "" });
      setProposalPassword("");
      await loadTreasury();
      setActiveTab("active");
    } catch (error) {
      const message = authorityErrorMessage(error, "Unable to submit treasury proposal.");
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
      setProposalPassword("");
    }
  }

  function showVote(proposalId, vote) {
    setVoteInputs((current) => ({
      ...current,
      [proposalId]: { vote, password: "" },
    }));
  }

  async function submitVote(proposalId) {
    const voteInput = voteInputs[proposalId];
    if (!isLoggedIn) {
      toast.error("Unlock your Vorliq wallet to sign this action locally.");
      return;
    }
    if (!voteInput?.password) {
      toast.error("Enter your wallet password to sign this action locally.");
      return;
    }

    try {
      await postSignedAuthority({
        action: "treasury.vote",
        walletPassword: voteInput.password,
        body: {
          proposal_id: proposalId,
          vote: voteInput.vote,
        },
      });
      toast.success("Treasury vote cast.");
      setVoteInputs((current) => ({ ...current, [proposalId]: undefined }));
      await loadTreasury();
      if (activeTab === "mine") {
        await loadMyTreasury();
      }
    } catch (error) {
      const message = authorityErrorMessage(error, "Unable to cast treasury vote.");
      setErrorMessage(message);
      toast.error(message);
      setVoteInputs((current) => ({
        ...current,
        [proposalId]: { ...current[proposalId], password: "" },
      }));
    }
  }

  async function cancelProposal(proposalId) {
    if (!isLoggedIn) {
      toast.error("Unlock your Vorliq wallet to sign this action locally.");
      return;
    }
    if (!cancelPasswords[proposalId]) {
      toast.error("Enter your wallet password to sign this action locally.");
      return;
    }
    setCancellingId(proposalId);
    try {
      await postSignedAuthority({
        action: "treasury.cancel",
        walletPassword: cancelPasswords[proposalId],
        body: { proposal_id: proposalId },
      });
      toast.success("Treasury proposal cancelled.");
      await loadTreasury();
      await loadMyTreasury(wallet.address);
    } catch (error) {
      const message = authorityErrorMessage(error, "Unable to cancel proposal.");
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setCancellingId("");
      setCancelPasswords((current) => ({ ...current, [proposalId]: "" }));
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
        <p className="help-text">
          <Link to="/vlq">See treasury VLQ movement in the overview.</Link>{" "}
          <Link to="/blockchain">Open explorer.</Link>
        </p>
        <div className="button-row">
          <Link className="button small-button" to="/vlq">Understand VLQ</Link>
          <Link className="button secondary small-button" to="/faucet">Faucet</Link>
          <Link className="button secondary small-button" to="/lending">Lending</Link>
          <Link className="button secondary small-button" to="/blockchain">Explorer</Link>
        </div>
      </section>

      <ErrorMessage message={errorMessage} />
      <AuthorityWriteNotice />
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
                isLoggedIn={isLoggedIn}
                onVotePasswordChange={(value) =>
                  setVoteInputs((current) => ({
                    ...current,
                    [proposal.proposal_id]: {
                      ...current[proposal.proposal_id],
                      password: value,
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
            <p>Maximum request right now: {treasuryMaxDisplay}. Approval does not mean instant payout; a payout transaction must be mined before a proposal is paid.</p>
          </div>
          <p className="help-text">
            Proposal and vote writes require local signed wallet authorization. Public payout execution controls are not exposed here; payout movement should be reviewed through confirmed explorer records.
          </p>
          <form className="form" onSubmit={submitProposal}>
            <div className="field">
              <label htmlFor="treasury-proposer">Proposer Wallet Address</label>
              <input id="treasury-proposer" className="input" value={form.proposerAddress} readOnly />
              <p className="help-text">The signer address comes from your unlocked saved wallet.</p>
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
              <input id="treasury-amount" className="input" type="number" min="0" max={treasuryMax ?? undefined} value={form.requestedAmount} onChange={(event) => updateForm("requestedAmount", event.target.value)} placeholder={treasuryMax === null || Number.isNaN(treasuryMax) ? "Treasury balance unavailable" : `Maximum ${formatNumber(treasuryMax)} VLQ`} />
            </div>
            <div className="field">
              <label htmlFor="treasury-recipient">Recipient Address</label>
              <input id="treasury-recipient" className="input" value={form.recipientAddress} onChange={(event) => updateForm("recipientAddress", event.target.value)} />
            </div>
            <AuthorityPasswordField
              id="treasury-proposal-password"
              isLoggedIn={isLoggedIn}
              value={proposalPassword}
              onChange={setProposalPassword}
            />
            <button className="button" type="submit" disabled={!isLoggedIn || submitting}>
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
                  proposal.proposer_address === wallet?.address &&
                  Object.keys(proposal.votes || {}).length === 0
                }
                cancelling={cancellingId === proposal.proposal_id}
                isLoggedIn={isLoggedIn}
                cancelPassword={cancelPasswords[proposal.proposal_id] || ""}
                onCancelPasswordChange={(value) =>
                  setCancelPasswords((current) => ({ ...current, [proposal.proposal_id]: value }))
                }
                onCancel={() => cancelProposal(proposal.proposal_id)}
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
    ["Treasury Balance", treasuryAmount(summary, "current_balance", balance?.balance)],
    ["Total Received", treasuryAmount(summary, "total_received")],
    ["Total Paid", treasuryAmount(summary, "total_paid")],
    ["Pending Payouts", treasuryAmount(summary, "pending_payouts")],
    ["Active Proposals", treasuryCount(summary, "active_proposal_count")],
    ["Paid Proposals", treasuryCount(summary, "paid_proposal_count")],
  ];
  return (
    <section className="stack">
      <section className="grid lending-guide-grid">
        <div className="card card-pad stack">
          <span className="eyebrow">Read-only status</span>
          <h2>Treasury lifecycle</h2>
          <p className="help-text">
            Treasury records come from the existing public treasury APIs. Missing summary fields are marked unavailable instead of shown as zero.
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
          <span className="eyebrow">Community support</span>
          <h2>What treasury supports</h2>
          <p className="help-text">
            Treasury VLQ can support starter faucet claims, lending workflows, security, infrastructure, education, and other community operations when proposals pass.
          </p>
          <p className="help-text">
            Public users can read proposals and inspect ledger records. Vote writes require local signed wallet authorization. Admin-only payout controls are not shown on this page.
          </p>
          <div className="button-row">
            <Link className="button small-button" to="/faucet">Faucet</Link>
            <Link className="button secondary small-button" to="/lending">Lending</Link>
            <Link className="button secondary small-button" to="/blockchain">Explorer</Link>
          </div>
        </div>
      </section>

      <section className="card card-pad">
        <div className="grid stats-grid">
          {stats.map(([label, value]) => (
            <div className="card card-pad stat-card compact-stat" key={label}>
              <span className="stat-label">{label}</span>
              <span className="stat-value">{value}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="card card-pad stack">
        <h2>Pending vs confirmed treasury movement</h2>
        <div className="grid meta-grid">
          <div className="meta-item">
            <span className="meta-label">Pending movement</span>
            <span className="meta-value">Approved proposals and payout transactions that are not mined yet.</span>
          </div>
          <div className="meta-item">
            <span className="meta-label">Confirmed movement</span>
            <span className="meta-value">Mining inflows or payouts with explorer records in a confirmed block.</span>
          </div>
        </div>
      </section>

      <section className="card card-pad stack">
        <div className="section-title">
          <h2>Latest Ledger Entries</h2>
        </div>
        <Ledger entries={ledger.slice(0, 5)} compact />
      </section>
    </section>
  );
}

function treasuryAmount(summary, key, fallback) {
  const value = summary?.[key] ?? fallback;
  return value === null || value === undefined || value === "" ? "Unavailable" : `${formatNumber(value)} VLQ`;
}

function treasuryCount(summary, key) {
  const value = summary?.[key];
  return value === null || value === undefined || value === "" ? "Unavailable" : formatNumber(value);
}

function TreasuryProposalCard({
  proposal,
  expanded = false,
  onToggle,
  voteInput,
  onShowVote,
  isLoggedIn = false,
  onVotePasswordChange,
  onSubmitVote,
  compact = false,
  canCancel = false,
  cancelling = false,
  cancelPassword = "",
  onCancelPasswordChange,
  onCancel,
}) {
  const yes = Number(proposal.yes_vote_weight || 0);
  const no = Number(proposal.no_vote_weight || 0);
  const total = yes + no;
  const quorum = Number(proposal.quorum || 0);
  const yesPercent = total ? (yes / total) * 100 : 0;
  const noPercent = total ? 100 - yesPercent : 0;
  const quorumPercent = quorum ? Math.min((total / quorum) * 100, 100) : 0;
  const descriptionText = proposal.description || "No treasury proposal description provided.";
  const description = expanded || compact || descriptionText.length <= 220 ? descriptionText : `${descriptionText.slice(0, 220)}...`;
  const statusText = statusLabel(proposal.status);

  return (
    <article className="card card-pad stack">
      <div className="section-title">
        <div>
          <h2>{proposal.title || "Untitled treasury proposal"}</h2>
          <span className={`status-badge ${proposal.status}`}>{statusText}</span>
        </div>
        <span className="badge forum-category">{titleCase(proposal.category || "other")}</span>
      </div>
      <p>{description}</p>
      {!compact && descriptionText.length > 220 && onToggle && (
        <button className="text-button" type="button" onClick={onToggle}>
          {expanded ? "Show Less" : "Read More"}
        </button>
      )}
      <p className="muted-text">{movementLabel(proposal)}</p>
      <div className="block-meta">
        <Meta label="Amount" value={treasuryAmount({ requested_amount: proposal.requested_amount }, "requested_amount")} />
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
        <Link className="button secondary small-button" to="/blockchain">
          Explorer
        </Link>
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
                <strong>{statusLabel(entry.status)}</strong>
                <p>{entry.note || "No status note recorded."}</p>
                <span className="muted-text">{formatDate(entry.timestamp)}</span>
              </article>
            ))}
          </div>
        </details>
      )}
      {!compact && proposal.status === "active" && (
        <>
          <div className="actions">
            <button className="button" type="button" disabled={!isLoggedIn} onClick={() => onShowVote(proposal.proposal_id, "yes")}>Vote Yes</button>
            <button className="button secondary" type="button" disabled={!isLoggedIn} onClick={() => onShowVote(proposal.proposal_id, "no")}>Vote No</button>
          </div>
          {voteInput && (
            <div className="stack">
              <AuthorityPasswordField
                id={`treasury-vote-password-${proposal.proposal_id}`}
                isLoggedIn={isLoggedIn}
                value={voteInput.password || ""}
                onChange={onVotePasswordChange}
              />
              <button className="button" type="button" disabled={!isLoggedIn} onClick={() => onSubmitVote(proposal.proposal_id)}>Cast Vote</button>
            </div>
          )}
        </>
      )}
      {canCancel && (
        <div className="stack">
          <AuthorityPasswordField
            id={`treasury-cancel-password-${proposal.proposal_id}`}
            isLoggedIn={isLoggedIn}
            value={cancelPassword}
            onChange={onCancelPasswordChange}
          />
          <button className="button secondary" type="button" disabled={!isLoggedIn || cancelling} onClick={onCancel}>
            {cancelling ? "Cancelling..." : "Cancel Proposal"}
          </button>
        </div>
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
            <span>{treasuryAmount({ amount: entry.amount }, "amount")}</span>
            <span>{entry.description || "Treasury ledger entry"}</span>
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

function statusLabel(status) {
  if (status === "active") return "Pending vote";
  if (status === "passed_pending_payout") return "Approved, pending payout";
  if (status === "payout_pending") return "Payout pending";
  return titleCase(status || "unknown");
}

function movementLabel(proposal) {
  if (proposal.status === "paid") return "Confirmed treasury movement: payout is recorded on-chain.";
  if (proposal.status === "passed_pending_payout" || proposal.status === "payout_pending") {
    return "Pending treasury movement: approved or submitted payout is not confirmed yet.";
  }
  if (proposal.status === "active") return "Pending vote: no treasury VLQ has moved.";
  if (["rejected", "expired", "cancelled"].includes(proposal.status)) return "No treasury VLQ should move for this proposal.";
  return "Treasury movement status is unavailable from the public record.";
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
