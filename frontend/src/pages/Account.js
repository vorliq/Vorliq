import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";

import AddressIdentity from "../components/AddressIdentity";
import ErrorMessage from "../components/ErrorMessage";
import ProfileAvatar from "../components/ProfileAvatar";
import ProfileBadge from "../components/ProfileBadge";
import PrivacyControls from "../components/PrivacyControls";
import AddressBookManager from "../components/AddressBookManager";
import Spinner from "../components/Spinner";
import { useAuth } from "../context/AuthContext";
import { useNotifications } from "../context/NotificationContext";
import api from "../helpers/api";
import { apiErrorMessage } from "../helpers/errors";
import { authorityErrorMessage, postSignedAuthority } from "../helpers/signedAuthority";
import { exportEncryptedWalletBackup, getLastWalletBackupAt, loadWallet } from "../helpers/storage";

const NOTIFICATION_EVENTS = [
  ["vlq_received", "When I receive VLQ"],
  ["loan_funded", "When my loan request is funded"],
  ["loan_repaid", "When a loan I helped fund is repaid"],
  ["governance_concluded", "When a proposal I voted on concludes"],
  ["weekly_digest", "A weekly digest every Monday (your balance, what you received, votes, loans, top posts)"],
];

function Account() {
  const navigate = useNavigate();
  const { clearLocalWallet, logout, wallet } = useAuth();
  const { addNotification } = useNotifications();
  const previousIncomingCountRef = useRef(null);
  const [balance, setBalance] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [addressHistory, setAddressHistory] = useState(null);
  const [loans, setLoans] = useState([]);
  const [exchangeTrades, setExchangeTrades] = useState([]);
  const [governanceActivity, setGovernanceActivity] = useState({ created: [], voted: [], proposals: [] });
  const [treasuryActivity, setTreasuryActivity] = useState({ created: [], voted: [], received: [], proposals: [] });
  const [faucetClaims, setFaucetClaims] = useState([]);
  const [earnedAchievements, setEarnedAchievements] = useState([]);
  const [allAchievements, setAllAchievements] = useState([]);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const [exportPassword, setExportPassword] = useState("");
  const [exportingWallet, setExportingWallet] = useState(false);
  const [revealOpen, setRevealOpen] = useState(false);
  const [revealPassword, setRevealPassword] = useState("");
  const [revealedPrivateKey, setRevealedPrivateKey] = useState("");
  const [lastBackupAt, setLastBackupAt] = useState(() => getLastWalletBackupAt());
  const [clearWalletConfirmed, setClearWalletConfirmed] = useState(false);

  useEffect(() => {
    let mounted = true;

    // The balance is one fast read; show it the moment it returns rather than
    // gating it behind the nine other account fetches below. This is what a member
    // looks for first after signing in, so it must not wait for the slowest call.
    api
      .get("/wallet/balance", { params: { address: wallet.address } })
      .then((r) => { if (mounted) setBalance(r.data.balance); })
      .catch(() => {});

    async function loadAccount() {
      try {
        const profileRequest = api
          .get("/profiles/profile", { params: { address: wallet.address } })
          .catch((error) => {
            if (error.response?.status === 404) return { data: { profile: null } };
            throw error;
          });
        const [balanceResponse, transactionResponse, loansResponse, exchangeResponse, governanceResponse, treasuryResponse, faucetResponse, earnedResponse, allAchievementsResponse, profileResponse] = await Promise.all([
          api.get("/wallet/balance", { params: { address: wallet.address } }),
          api.get("/chain/address", { params: { address: wallet.address, limit: 100 } }),
          api.get("/lending/my", { params: { address: wallet.address } }),
          api.get("/exchange/my", { params: { address: wallet.address } }),
          api.get("/governance/my", { params: { address: wallet.address } }),
          api.get("/treasury/my", { params: { address: wallet.address } }),
          api.get("/faucet/claims", { params: { address: wallet.address } }),
          api.get("/achievements", { params: { address: wallet.address } }),
          api.get("/achievements/all"),
          profileRequest,
        ]);

        if (mounted) {
          setBalance(balanceResponse.data.balance);
          setTransactions(transactionResponse.data.transactions || []);
          setAddressHistory(transactionResponse.data || null);
          setLoans(loansResponse.data.loans || []);
          setExchangeTrades(exchangeResponse.data.offers || []);
          setGovernanceActivity({
            created: governanceResponse.data.created || [],
            voted: governanceResponse.data.voted || [],
            proposals: governanceResponse.data.proposals || [],
          });
          setTreasuryActivity({
            created: treasuryResponse.data.created || [],
            voted: treasuryResponse.data.voted || [],
            received: treasuryResponse.data.received || [],
            proposals: treasuryResponse.data.proposals || [],
          });
          setFaucetClaims(faucetResponse.data.claims || []);
          setEarnedAchievements(earnedResponse.data.achievements || []);
          setAllAchievements(allAchievementsResponse.data.achievements || []);
          setProfile(profileResponse.data.profile || null);
          setErrorMessage("");
        }
      } catch (error) {
        const message = apiErrorMessage(error, "Unable to load account dashboard.");
        setErrorMessage(message);
        toast.error(message);
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadAccount();

    return () => {
      mounted = false;
    };
  }, [wallet.address]);

  const myTransactions = useMemo(() => {
    return transactions.map((transaction) => {
      const sent = transaction.sender_address === wallet.address;
      const otherParty = sent ? transaction.receiver_address : transaction.sender_address;
      return {
        blockIndex: transaction.block_index,
        direction: sent ? "Sent" : "Received",
        otherParty,
        amount: transaction.amount,
        timestamp: transaction.block_timestamp || transaction.timestamp,
        txId: transaction.tx_id,
        status: transaction.status || "confirmed",
        confirmations: transaction.confirmations ?? 0,
      };
    });
  }, [transactions, wallet.address]);

  const myLoans = useMemo(
    () => loans.filter((loan) => loan.requester_address === wallet.address),
    [loans, wallet.address]
  );

  const votedLoans = useMemo(
    () => loans.filter((loan) => loan.requester_address !== wallet.address && loan.votes?.[wallet.address]),
    [loans, wallet.address]
  );

  useEffect(() => {
    if (loading) {
      return;
    }

    const incomingTransactions = myTransactions.filter(
      (transaction) => transaction.direction === "Received"
    );

    if (previousIncomingCountRef.current === null) {
      previousIncomingCountRef.current = incomingTransactions.length;
      return;
    }

    if (incomingTransactions.length > previousIncomingCountRef.current) {
      const newTransactions = incomingTransactions.slice(previousIncomingCountRef.current);
      newTransactions.forEach((transaction) => {
        addNotification(
          "success",
          "You received VLQ",
          `${transaction.amount} VLQ received from ${transaction.otherParty}.`
        );
      });
    }

    previousIncomingCountRef.current = incomingTransactions.length;
  }, [addNotification, loading, myTransactions]);

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(wallet.address);
      toast.success("address copied");
    } catch (error) {
      toast.error("Unable to copy address.");
    }
  }

  async function copyText(value, label) {
    try {
      await navigator.clipboard.writeText(String(value || ""));
      toast.success(`${label} copied.`);
    } catch (error) {
      toast.error(`Unable to copy ${label.toLowerCase()}.`);
    }
  }

  useEffect(() => {
    if (!revealedPrivateKey) {
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      setRevealedPrivateKey("");
      setRevealPassword("");
      setRevealOpen(false);
    }, 60000);

    return () => window.clearTimeout(timeout);
  }, [revealedPrivateKey]);

  async function exportEncryptedWallet(event) {
    event.preventDefault();

    if (!exportPassword) {
      toast.error("Enter your wallet password to export the encrypted backup.");
      return;
    }

    setExportingWallet(true);
    try {
      const backup = await exportEncryptedWalletBackup(exportPassword);
      const blob = new Blob([JSON.stringify(backup, null, 2)], {
        type: "application/json;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "vorliq-wallet-backup.json";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setExportPassword("");
      setExportOpen(false);
      setLastBackupAt(getLastWalletBackupAt());
      toast.success("Encrypted wallet backup exported.");
    } catch (error) {
      toast.error("Unable to export wallet backup. Check your password.");
    } finally {
      setExportingWallet(false);
    }
  }

  async function revealPrivateKey(event) {
    event.preventDefault();

    if (!revealPassword) {
      toast.error("Enter your wallet password to reveal the private key.");
      return;
    }

    try {
      const unlockedWallet = await loadWallet(revealPassword);
      setRevealedPrivateKey(unlockedWallet.private_key);
      toast.success("Private key revealed for 60 seconds.");
    } catch (error) {
      toast.error("Unable to reveal private key. Check your password.");
    }
  }

  async function copyPrivateKey() {
    if (!revealedPrivateKey) {
      return;
    }

    try {
      await navigator.clipboard.writeText(revealedPrivateKey);
      toast.success("Private key copied.");
    } catch (error) {
      toast.error("Unable to copy private key.");
    }
  }

  function hidePrivateKey() {
    setRevealedPrivateKey("");
    setRevealPassword("");
    setRevealOpen(false);
  }

  function lockWalletSession() {
    hidePrivateKey();
    logout();
    toast.info("Wallet session locked. The encrypted backup remains in this browser.");
    navigate("/login", { replace: true });
  }

  function removeSavedWallet() {
    if (!clearWalletConfirmed) {
      toast.error("Confirm that you want to remove the encrypted wallet backup from this browser.");
      return;
    }
    hidePrivateKey();
    clearLocalWallet();
    toast.success("Encrypted wallet backup removed from this browser.");
    navigate("/login", { replace: true });
  }

  function exportTransactionsAsCsv() {
    if (myTransactions.length === 0) {
      toast.info("No transactions to export.");
      return;
    }

    const header = ["Direction", "Other Party Address", "Amount VLQ", "Block Number", "Timestamp"];
    const rows = myTransactions.map((transaction) => [
      transaction.direction,
      transaction.otherParty,
      transaction.amount,
      transaction.blockIndex,
      new Date(transaction.timestamp * 1000).toISOString(),
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "vorliq-transactions.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="page">
      <section className="hero">
        <span className="eyebrow">Personal Dashboard</span>
        <h1>Account</h1>
        <p className="subtitle">
          View your saved wallet, balance, transaction history, and active community loans.
        </p>
      </section>

      <ErrorMessage message={errorMessage} />

      <PrivacyControls />

      <AddressBookManager />

      <section className="card card-pad account-profile-section">
        <div className="section-title">
          <div>
            <span className="eyebrow">My Profile</span>
            <h2>Public Member Identity</h2>
          </div>
          <Link className="button secondary small-button" to={`/profile?address=${wallet.address}`}>
            {profile ? "Edit Profile" : "Create Profile"}
          </Link>
        </div>
        {profile ? (
          <div className="account-profile-preview">
            <ProfileAvatar profile={profile} address={wallet.address} size="large" />
            <div>
              <h3>{profile.display_name}</h3>
              <p>{profile.reputation_score || 0} reputation</p>
              <div className="profile-badge-row">
                {(profile.badges || []).slice(0, 4).map((badge, index) => (
                  <ProfileBadge badge={badge} key={`${badge.id || badge}-${index}`} />
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="empty-state">
            Create your public profile so members see a display name, avatar, and reputation instead of only a wallet address.
          </div>
        )}
      </section>

      <section className="card card-pad stack">
        <div className="section-title">
          <h2>My Wallet</h2>
          <div className="button-row">
            <button className="button secondary small-button" type="button" onClick={copyAddress}>
              Copy Address
            </button>
            <button
              className="button secondary small-button"
              type="button"
              onClick={() => setExportOpen((open) => !open)}
            >
              Export Encrypted Wallet
            </button>
            <button
              className="button secondary small-button"
              type="button"
              onClick={() => setRevealOpen((open) => !open)}
            >
              Reveal Private Key
            </button>
            <button className="button secondary small-button" type="button" onClick={lockWalletSession}>
              Lock Session
            </button>
          </div>
        </div>
        <div className="grid account-wallet-grid">
          <div className="field">
            <label>Wallet Address</label>
            <div className="value-box">{wallet.address}</div>
          </div>
          <div className="field">
            <label>Confirmed VLQ Balance</label>
            <div className="value-box">{loading ? "Loading balance..." : `${addressHistory?.confirmed_balance ?? balance ?? 0} VLQ`}</div>
          </div>
          <div className="field">
            <label>Current Balance With Pending Pool</label>
            <div className="value-box">{loading ? "Loading..." : `${balance ?? 0} VLQ`}</div>
          </div>
          <div className="field">
            <label>Pending Incoming</label>
            <div className="value-box">{loading ? "Loading..." : `${addressHistory?.pending_incoming_total ?? 0} VLQ`}</div>
          </div>
          <div className="field">
            <label>Pending Outgoing</label>
            <div className="value-box">{loading ? "Loading..." : `${addressHistory?.pending_outgoing_total ?? 0} VLQ`}</div>
          </div>
        </div>

        <div className={lastBackupAt ? "wallet-safety-box" : "private-key-warning"}>
          <strong>{lastBackupAt ? "Encrypted backup recorded" : "Backup recommended"}</strong>
          <p>
            {lastBackupAt
              ? `Last encrypted wallet backup exported from this browser: ${new Date(lastBackupAt).toLocaleString()}.`
              : "This browser has a saved wallet but no recorded encrypted backup export. Download a backup before storing meaningful VLQ."}
          </p>
        </div>

        {exportOpen && (
          <form className="form wallet-action-panel" onSubmit={exportEncryptedWallet}>
            <h3>Export Encrypted Wallet Backup</h3>
            <p className="help-text">
              This downloads an encrypted JSON backup. It does not include your raw private key
              in plaintext.
            </p>
            <div className="field">
              <label htmlFor="wallet-export-password">Wallet Password</label>
              <input
                id="wallet-export-password"
                className="input"
                type="password"
                value={exportPassword}
                onChange={(event) => setExportPassword(event.target.value)}
                autoComplete="current-password"
              />
            </div>
            <button className="button" type="submit" disabled={exportingWallet}>
              {exportingWallet ? "Exporting..." : "Download vorliq-wallet-backup.json"}
            </button>
          </form>
        )}

        {revealOpen && (
          <form className="form wallet-action-panel" onSubmit={revealPrivateKey}>
            <h3>Reveal Private Key</h3>
            <p className="help-text">
              Only reveal your private key when you are alone, on a trusted device, and on the
              official Vorliq site. It will hide automatically after 60 seconds.
            </p>
            <div className="field">
              <label htmlFor="wallet-reveal-password">Wallet Password</label>
              <input
                id="wallet-reveal-password"
                className="input"
                type="password"
                value={revealPassword}
                onChange={(event) => setRevealPassword(event.target.value)}
                autoComplete="current-password"
              />
            </div>
            <button className="button" type="submit">
              Reveal for 60 Seconds
            </button>
          </form>
        )}

        {revealedPrivateKey && (
          <div className="private-key-warning">
            <strong>Private key visible</strong>
            <p>
              Anyone with this key can control your wallet. Do not share it, paste it into
              untrusted websites, or send it in chat.
            </p>
            <div className="value-box">{revealedPrivateKey}</div>
            <div className="button-row">
              <button className="button secondary small-button" type="button" onClick={copyPrivateKey}>
                Copy
              </button>
              <button className="button secondary small-button" type="button" onClick={hidePrivateKey}>
                Hide
              </button>
            </div>
          </div>
        )}

        <div className="private-key-warning">
          <strong>Clear local wallet data</strong>
          <p>
            This removes the encrypted wallet backup from this browser. It does not delete public blockchain records, reverse transactions, or recover a lost backup.
          </p>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={clearWalletConfirmed}
              onChange={(event) => setClearWalletConfirmed(event.target.checked)}
            />
            <span>I understand this removes the encrypted wallet backup from this browser.</span>
          </label>
          <button className="button secondary small-button" type="button" disabled={!clearWalletConfirmed} onClick={removeSavedWallet}>
            Clear Saved Wallet
          </button>
        </div>
      </section>

      <section className="card card-pad account-section">
        <div className="section-title">
          <h2>Faucet Claims</h2>
          <Link className="button secondary small-button" to={`/faucet?address=${wallet.address}`}>
            Open Faucet
          </Link>
        </div>
        {loading && <Spinner label="Loading faucet claims..." />}
        {!loading && faucetClaims.length === 0 && (
          <div className="empty-state">No starter VLQ faucet claims for this wallet yet.</div>
        )}
        <div className="history-list">
          {faucetClaims.slice(0, 5).map((claim) => (
            <div className="history-row" key={claim.claim_id}>
              <span className={`status-badge ${claim.status}`}>{claim.status}</span>
              <span>{claim.amount} VLQ</span>
              {claim.tx_id ? (
                <Link to={`/tx/${claim.tx_id}`}>View Tx</Link>
              ) : (
                <span>{claim.reason || "No transaction"}</span>
              )}
            </div>
          ))}
        </div>
      </section>

      <EmailNotificationSettings address={wallet.address} />

      <section className="card card-pad account-section">
        <div className="section-title">
          <h2>My Transaction History</h2>
          <button
            className="button secondary small-button"
            type="button"
            onClick={exportTransactionsAsCsv}
          >
            Export as CSV
          </button>
        </div>
        {loading && <Spinner label="Loading transactions..." />}

        {!loading && myTransactions.length === 0 && (
          <div className="empty-state">no transactions yet</div>
        )}

        <div className="history-list">
          {myTransactions.map((transaction, index) => (
          <div className="history-row" key={`${transaction.blockIndex}-${index}`}>
              <span className={`status-badge ${transaction.status}`}>
                {transaction.status}
              </span>
              <span className={`direction ${transaction.direction.toLowerCase()}`}>
                {transaction.direction}
              </span>
              <span>{shorten(transaction.otherParty)}</span>
              <span>{transaction.amount} VLQ</span>
              {transaction.status === "confirmed" ? (
                <Link to={`/block/${transaction.blockIndex}`}>Block #{transaction.blockIndex}</Link>
              ) : (
                <span>Pending</span>
              )}
              {transaction.txId && (
                <div className="button-row">
                  <Link className="button secondary small-button" to={`/tx/${transaction.txId}`}>
                    View Tx
                  </Link>
                  <button className="button secondary small-button" type="button" onClick={() => copyText(transaction.txId, "Transaction ID")}>
                    Copy Tx
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="card card-pad account-section">
        <h2>My Active Loans</h2>
        {loading && <Spinner label="Loading loans..." />}

        {!loading && myLoans.length === 0 && votedLoans.length === 0 && <div className="empty-state">No loans yet.</div>}

        <div className="loan-grid">
          {myLoans.map((loan) => (
            <article className="loan-card" key={loan.loan_id}>
              <div className="section-title">
                <h3>Loan {loan.loan_id.slice(0, 12)}</h3>
                <span className={`status-badge ${loan.status}`}>{loan.status}</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Amount</span>
                <span className="meta-value">{loan.amount} VLQ</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Repayment Amount</span>
                <span className="meta-value">{loan.repayment_amount} VLQ</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Due Block</span>
                <span className="meta-value">
                  {loan.due_block ?? "Not set"}
                  {loan.blocks_until_due !== null && loan.blocks_until_due !== undefined ? ` (${loan.blocks_until_due} blocks)` : ""}
                </span>
              </div>
              <div className="button-row">
                {loan.issuance_tx_id && (
                  <Link className="button secondary small-button" to={`/tx/${loan.issuance_tx_id}`}>
                    Issuance Tx
                  </Link>
                )}
                {loan.repayment_tx_id && (
                  <Link className="button secondary small-button" to={`/tx/${loan.repayment_tx_id}`}>
                    Repayment Tx
                  </Link>
                )}
              </div>
              {["active", "overdue"].includes(loan.status) && !loan.repayment_tx_id && (
                <div className="wallet-safety-box lending-action-box">
                  <strong>Repayment uses local send review</strong>
                  <p>
                    Review the repayment amount and sign on the Send page. Private keys stay local
                    to your saved wallet flow.
                  </p>
                  <Link className="button small-button" to="/send">
                    Review Repayment In Send
                  </Link>
                </div>
              )}
            </article>
          ))}
          {votedLoans.map((loan) => (
            <article className="loan-card" key={`voted-${loan.loan_id}`}>
              <div className="section-title">
                <h3>Voted Loan {loan.loan_id.slice(0, 12)}</h3>
                <span className={`status-badge ${loan.status}`}>{loan.status}</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Borrower</span>
                <span className="meta-value"><AddressIdentity address={loan.requester_address} compact /></span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Amount</span>
                <span className="meta-value">{loan.amount} VLQ</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Vote Weights</span>
                <span className="meta-value">Yes {loan.yes_vote_weight} / No {loan.no_vote_weight}</span>
              </div>
              <div className="button-row">
                {loan.issuance_tx_id && (
                  <Link className="button secondary small-button" to={`/tx/${loan.issuance_tx_id}`}>
                    Issuance Tx
                  </Link>
                )}
                {loan.repayment_tx_id && (
                  <Link className="button secondary small-button" to={`/tx/${loan.repayment_tx_id}`}>
                    Repayment Tx
                  </Link>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="card card-pad account-section">
        <h2>My Exchange Trades</h2>
        {loading && <Spinner label="Loading exchange trades..." />}

        {!loading && exchangeTrades.length === 0 && <div className="empty-state">No exchange trades yet.</div>}

        <div className="exchange-grid">
          {exchangeTrades.slice(0, 6).map((offer) => {
            const role = offer.creator_address === wallet.address ? "Creator" : "Acceptor";
            const counterparty = offer.creator_address === wallet.address ? offer.acceptor_address : offer.creator_address;
            return (
              <article className="exchange-card" key={offer.offer_id}>
                <div className="section-title">
                  <span className={`exchange-badge ${offer.offer_type}`}>{offer.offer_type}</span>
                  <span className={`status-badge ${offer.status}`}>{String(offer.status).replace(/_/g, " ")}</span>
                </div>
                <div className="meta-item">
                  <span className="meta-label">Role</span>
                  <span className="meta-value">{role}</span>
                </div>
                <div className="meta-item">
                  <span className="meta-label">Counterparty</span>
                  <span className="meta-value">{counterparty ? <AddressIdentity address={counterparty} compact /> : "Not accepted yet"}</span>
                </div>
                <div className="meta-item">
                  <span className="meta-label">Amount</span>
                  <span className="meta-value">{offer.amount} VLQ</span>
                </div>
                <div className="meta-item">
                  <span className="meta-label">Terms</span>
                  <span className="meta-value">{offer.price}</span>
                </div>
                {offer.vlq_tx_id && (
                  <div className="button-row">
                    <Link className="button secondary small-button" to={`/tx/${offer.vlq_tx_id}`}>
                      View VLQ Tx
                    </Link>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <section className="card card-pad account-section">
        <h2>My Governance Activity</h2>
        {loading && <Spinner label="Loading governance activity..." />}

        {!loading && governanceActivity.proposals.length === 0 && <div className="empty-state">No governance proposals or votes yet.</div>}

        <div className="governance-grid">
          {governanceActivity.proposals.slice(0, 6).map((proposal) => {
            const voteRecord = proposal.votes?.[wallet.address];
            const role = proposal.proposer_address === wallet.address ? "Proposer" : "Voter";
            return (
              <article className="governance-card" key={proposal.proposal_id}>
                <div className="section-title">
                  <h3>{proposal.title}</h3>
                  <span className={`status-badge ${proposal.status}`}>{String(proposal.status).replace(/_/g, " ")}</span>
                </div>
                <div className="meta-item">
                  <span className="meta-label">Role</span>
                  <span className="meta-value">{role}</span>
                </div>
                {voteRecord && (
                  <div className="meta-item">
                    <span className="meta-label">Vote</span>
                    <span className="meta-value">{voteRecord.vote || voteRecord}</span>
                  </div>
                )}
                <div className="meta-item">
                  <span className="meta-label">Vote Weight</span>
                  <span className="meta-value">Yes {proposal.yes_vote_weight || 0} / No {proposal.no_vote_weight || 0}</span>
                </div>
                {proposal.rule_change_id && (
                  <div className="meta-item">
                    <span className="meta-label">Rule Change</span>
                    <span className="meta-value mono-wrap">{proposal.rule_change_id}</span>
                  </div>
                )}
                <Link className="button secondary small-button" to="/governance">
                  Open Governance
                </Link>
              </article>
            );
          })}
        </div>
      </section>

      <section className="card card-pad account-section">
        <h2>My Treasury Activity</h2>
        {loading && <Spinner label="Loading treasury activity..." />}

        {!loading && treasuryActivity.proposals.length === 0 && <div className="empty-state">No treasury proposals, votes, or recipient records yet.</div>}

        <div className="governance-grid">
          {treasuryActivity.proposals.slice(0, 6).map((proposal) => {
            const voteRecord = proposal.votes?.[wallet.address];
            const role = proposal.proposer_address === wallet.address ? "Proposer" : proposal.recipient_address === wallet.address ? "Recipient" : "Voter";
            return (
              <article className="governance-card" key={proposal.proposal_id}>
                <div className="section-title">
                  <h3>{proposal.title}</h3>
                  <span className={`status-badge ${proposal.status}`}>{String(proposal.status).replace(/_/g, " ")}</span>
                </div>
                <div className="meta-item">
                  <span className="meta-label">Role</span>
                  <span className="meta-value">{role}</span>
                </div>
                <div className="meta-item">
                  <span className="meta-label">Amount</span>
                  <span className="meta-value">{proposal.requested_amount} VLQ</span>
                </div>
                {voteRecord && (
                  <div className="meta-item">
                    <span className="meta-label">Vote</span>
                    <span className="meta-value">{voteRecord.vote || voteRecord}</span>
                  </div>
                )}
                {proposal.payout_tx_id && (
                  <Link className="button secondary small-button" to={`/tx/${proposal.payout_tx_id}`}>
                    Payout Tx
                  </Link>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <section className="card card-pad account-section">
        <h2>My Achievements</h2>
        {loading && <Spinner label="Loading achievements..." />}
        {!loading && (
          <AchievementGrid
            allAchievements={allAchievements}
            earnedAchievements={earnedAchievements}
          />
        )}
      </section>
    </div>
  );
}

function EmailNotificationSettings({ address }) {
  const [maskedEmail, setMaskedEmail] = useState("");
  const [configured, setConfigured] = useState(false);
  const [email, setEmail] = useState("");
  const [events, setEvents] = useState({
    vlq_received: false,
    loan_funded: false,
    loan_repaid: false,
    governance_concluded: false,
    weekly_digest: false,
  });
  const [password, setPassword] = useState("");
  const [loadingPrefs, setLoadingPrefs] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;
    api
      .get("/notifications/preferences", { params: { address } })
      .then((response) => {
        if (!mounted) return;
        const prefs = response.data.preferences || {};
        setConfigured(Boolean(prefs.configured));
        setMaskedEmail(prefs.email_masked || "");
        setEvents((current) => ({ ...current, ...(prefs.events || {}) }));
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) setLoadingPrefs(false);
      });
    return () => {
      mounted = false;
    };
  }, [address]);

  function toggleEvent(eventKey) {
    setEvents((current) => ({ ...current, [eventKey]: !current[eventKey] }));
  }

  async function savePreferences(submitEvent) {
    submitEvent.preventDefault();
    if (!password) {
      toast.error("Enter your wallet password to sign this change locally.");
      return;
    }
    const typedEmail = email.trim();
    if (!configured && !typedEmail) {
      toast.error("Enter the email address where you'd like to receive notifications.");
      return;
    }

    setSaving(true);
    try {
      // Omit the email field entirely when keeping the saved address (the UI only
      // ever sees it masked) so toggles can be changed without re-typing it.
      const body = { events };
      if (typedEmail || !configured) {
        body.email = typedEmail;
      }
      const response = await postSignedAuthority({
        action: "notifications.preferences",
        walletPassword: password,
        body,
      });
      const prefs = response.data.preferences || {};
      setConfigured(Boolean(prefs.configured));
      setMaskedEmail(prefs.email_masked || "");
      setEvents((current) => ({ ...current, ...(prefs.events || {}) }));
      setEmail("");
      setPassword("");
      toast.success(prefs.configured ? "Notification preferences saved." : "Email notifications turned off.");
    } catch (error) {
      toast.error(authorityErrorMessage(error, "Unable to save notification preferences."));
    } finally {
      setSaving(false);
    }
  }

  async function turnOff() {
    if (!password) {
      toast.error("Enter your wallet password to sign this change locally.");
      return;
    }
    setSaving(true);
    try {
      // An explicit empty email clears the saved address and disables everything.
      await postSignedAuthority({
        action: "notifications.preferences",
        walletPassword: password,
        body: { email: "", events: { vlq_received: false, loan_funded: false, loan_repaid: false, governance_concluded: false, weekly_digest: false } },
      });
      setConfigured(false);
      setMaskedEmail("");
      setEvents({ vlq_received: false, loan_funded: false, loan_repaid: false, governance_concluded: false, weekly_digest: false });
      setEmail("");
      setPassword("");
      toast.success("Email notifications turned off and your address was removed.");
    } catch (error) {
      toast.error(authorityErrorMessage(error, "Unable to turn off notifications."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card card-pad account-section">
      <div className="section-title">
        <div>
          <span className="eyebrow">Email Notifications</span>
          <h2>Email Preferences</h2>
        </div>
      </div>
      <p className="help-text">
        Opt in to an email when something happens that involves you. Notifications are off until you
        add an address and choose events. Your email is stored against your wallet only after you sign
        this change locally, and it is never shown to other members.
      </p>
      {loadingPrefs ? (
        <Spinner label="Loading notification preferences..." />
      ) : (
        <form className="form" onSubmit={savePreferences}>
          <div className="field">
            <label htmlFor="notification-email">Email address</label>
            <input
              id="notification-email"
              className="input"
              type="email"
              autoComplete="email"
              placeholder={configured ? `Current: ${maskedEmail} — type a new address to change it` : "you@example.com"}
              value={email}
              onChange={(formEvent) => setEmail(formEvent.target.value)}
            />
            {configured && (
              <small className="help-text">Leave blank to keep {maskedEmail} and only change which events email you.</small>
            )}
          </div>
          <fieldset className="field notification-events">
            <legend>Email me…</legend>
            {NOTIFICATION_EVENTS.map(([key, label]) => (
              <label className="checkbox-row" key={key}>
                <input type="checkbox" checked={Boolean(events[key])} onChange={() => toggleEvent(key)} />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>
          <div className="field">
            <label htmlFor="notification-password">Wallet password</label>
            <input
              id="notification-password"
              className="input"
              type="password"
              autoComplete="current-password"
              placeholder="Signs this change locally"
              value={password}
              onChange={(formEvent) => setPassword(formEvent.target.value)}
            />
          </div>
          <div className="button-row">
            <button className="button" type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save Preferences"}
            </button>
            {configured && (
              <button className="button secondary small-button" type="button" disabled={saving} onClick={turnOff}>
                Turn Off &amp; Remove Email
              </button>
            )}
          </div>
        </form>
      )}
    </section>
  );
}

function AchievementGrid({ allAchievements, earnedAchievements }) {
  const earnedIds = new Set(earnedAchievements.map((achievement) => achievement.id || achievement.achievement_id));
  return (
    <div className="achievement-grid">
      {allAchievements.map((achievement) => {
        const unlocked = earnedIds.has(achievement.id);
        return (
          <article
            className={`achievement-badge ${unlocked ? "earned" : "locked"} achievement-${achievement.badge_color}`}
            key={achievement.id}
          >
            <strong>{achievement.title}</strong>
            <p>{achievement.description}</p>
            <span>{unlocked ? "Earned" : "Locked"}</span>
          </article>
        );
      })}
    </div>
  );
}

function shorten(address) {
  if (!address) {
    return "";
  }
  return address.length > 12 ? address.slice(0, 12) : address;
}

export default Account;
