import { useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";

import { useAuth } from "../context/AuthContext";
import api from "../helpers/api";

function Account() {
  const { wallet } = useAuth();
  const [balance, setBalance] = useState(null);
  const [chain, setChain] = useState([]);
  const [loans, setLoans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [repayingLoanId, setRepayingLoanId] = useState(null);

  useEffect(() => {
    let mounted = true;

    async function loadAccount() {
      try {
        const [balanceResponse, chainResponse, loansResponse] = await Promise.all([
          api.get("/wallet/balance", { params: { address: wallet.address } }),
          api.get("/chain"),
          api.get("/lending/loans"),
        ]);

        if (mounted) {
          setBalance(balanceResponse.data.balance);
          setChain(chainResponse.data.chain || []);
          setLoans(loansResponse.data.loans || []);
        }
      } catch (error) {
        toast.error(error.response?.data?.error || "Unable to load account dashboard.");
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
    return chain.flatMap((block) =>
      (block.transactions || [])
        .filter(
          (transaction) =>
            transaction.sender_address === wallet.address ||
            transaction.receiver_address === wallet.address
        )
        .map((transaction) => {
          const sent = transaction.sender_address === wallet.address;
          const otherParty = sent ? transaction.receiver_address : transaction.sender_address;
          return {
            blockIndex: block.index,
            direction: sent ? "Sent" : "Received",
            otherParty,
            amount: transaction.amount,
          };
        })
    );
  }, [chain, wallet.address]);

  const myLoans = useMemo(
    () => loans.filter((loan) => loan.requester_address === wallet.address),
    [loans, wallet.address]
  );

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(wallet.address);
      toast.success("address copied");
    } catch (error) {
      toast.error("Unable to copy address.");
    }
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
      toast.success(`Loan repaid. Amount: ${response.data.repayment_amount} VLQ.`);
    } catch (error) {
      toast.error(error.response?.data?.error || "Unable to repay loan.");
    } finally {
      setRepayingLoanId(null);
    }
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

      <section className="card card-pad stack">
        <div className="section-title">
          <h2>My Wallet</h2>
          <button className="button secondary small-button" type="button" onClick={copyAddress}>
            Copy Address
          </button>
        </div>
        <div className="grid account-wallet-grid">
          <div className="field">
            <label>Wallet Address</label>
            <div className="value-box">{wallet.address}</div>
          </div>
          <div className="field">
            <label>Current VLQ Balance</label>
            <div className="value-box">{loading ? "Loading..." : `${balance ?? 0} VLQ`}</div>
          </div>
        </div>
      </section>

      <section className="card card-pad account-section">
        <h2>My Transaction History</h2>
        {loading && <div className="empty-state">Loading transactions...</div>}

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
        {loading && <div className="empty-state">Loading loans...</div>}

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
    </main>
  );
}

function shorten(address) {
  if (!address) {
    return "";
  }
  return address.length > 12 ? address.slice(0, 12) : address;
}

export default Account;
