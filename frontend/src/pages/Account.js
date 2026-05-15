import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-toastify";

import ErrorMessage from "../components/ErrorMessage";
import Spinner from "../components/Spinner";
import { useAuth } from "../context/AuthContext";
import { useNotifications } from "../context/NotificationContext";
import api from "../helpers/api";
import { apiErrorMessage } from "../helpers/errors";
import { exportEncryptedWalletBackup, loadWallet } from "../helpers/storage";

function Account() {
  const { wallet } = useAuth();
  const { addNotification } = useNotifications();
  const previousIncomingCountRef = useRef(null);
  const [balance, setBalance] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loans, setLoans] = useState([]);
  const [earnedAchievements, setEarnedAchievements] = useState([]);
  const [allAchievements, setAllAchievements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [repayingLoanId, setRepayingLoanId] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const [exportPassword, setExportPassword] = useState("");
  const [exportingWallet, setExportingWallet] = useState(false);
  const [revealOpen, setRevealOpen] = useState(false);
  const [revealPassword, setRevealPassword] = useState("");
  const [revealedPrivateKey, setRevealedPrivateKey] = useState("");

  useEffect(() => {
    let mounted = true;

    async function loadAccount() {
      try {
        const [balanceResponse, transactionResponse, loansResponse, earnedResponse, allAchievementsResponse] = await Promise.all([
          api.get("/wallet/balance", { params: { address: wallet.address } }),
          api.get("/chain/address", { params: { address: wallet.address, limit: 100 } }),
          api.get("/lending/loans", { params: { limit: 200 } }),
          api.get("/achievements", { params: { address: wallet.address } }),
          api.get("/achievements/all"),
        ]);

        if (mounted) {
          setBalance(balanceResponse.data.balance);
          setTransactions(transactionResponse.data.transactions || []);
          setLoans(loansResponse.data.loans || []);
          setEarnedAchievements(earnedResponse.data.achievements || []);
          setAllAchievements(allAchievementsResponse.data.achievements || []);
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
      };
    });
  }, [transactions, wallet.address]);

  const myLoans = useMemo(
    () => loans.filter((loan) => loan.requester_address === wallet.address),
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

  async function repayLoan(loanId) {
    setRepayingLoanId(loanId);
    try {
      const response = await api.post("/lending/repay", {
        loan_id: loanId,
        repayer_address: wallet.address,
      });
      setLoans((current) =>
        current.map((loan) => (loan.loan_id === loanId ? response.data.loan : loan))
      );
      setErrorMessage("");
      toast.success(`Loan repaid. Amount: ${response.data.repayment_amount} VLQ.`);
    } catch (error) {
      const message = apiErrorMessage(error, "Unable to repay loan.");
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setRepayingLoanId(null);
    }
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
    <main className="page">
      <section className="hero">
        <span className="eyebrow">Personal Dashboard</span>
        <h1>Account</h1>
        <p className="subtitle">
          View your saved wallet, balance, transaction history, and active community loans.
        </p>
      </section>

      <ErrorMessage message={errorMessage} />

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
          </div>
        </div>
        <div className="grid account-wallet-grid">
          <div className="field">
            <label>Wallet Address</label>
            <div className="value-box">{wallet.address}</div>
          </div>
          <div className="field">
            <label>Current VLQ Balance</label>
            <div className="value-box">{loading ? "Loading balance..." : `${balance ?? 0} VLQ`}</div>
          </div>
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
      </section>

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
              <span className={`direction ${transaction.direction.toLowerCase()}`}>
                {transaction.direction}
              </span>
              <span>{shorten(transaction.otherParty)}</span>
              <span>{transaction.amount} VLQ</span>
              <span>Block #{transaction.blockIndex}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="card card-pad account-section">
        <h2>My Active Loans</h2>
        {loading && <Spinner label="Loading loans..." />}

        {!loading && myLoans.length === 0 && <div className="empty-state">No loans yet.</div>}

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
              {loan.status === "approved" && (
                <button
                  className="button"
                  type="button"
                  disabled={repayingLoanId === loan.loan_id}
                  onClick={() => repayLoan(loan.loan_id)}
                >
                  {repayingLoanId === loan.loan_id ? "Repaying..." : "Repay"}
                </button>
              )}
            </article>
          ))}
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
    </main>
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
