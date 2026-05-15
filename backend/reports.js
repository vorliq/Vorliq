const axios = require("axios");
const { logError, logInfo } = require("./logger");

const FORMSPREE_ENDPOINT = "https://formspree.io/f/mzdoladl";
const PUBLIC_API_URL = process.env.PUBLIC_API_URL || "http://localhost:5000";

function toMilliseconds(timestamp) {
  const numeric = Number(timestamp);
  if (!Number.isFinite(numeric)) return 0;
  return numeric > 10_000_000_000 ? numeric : numeric * 1000;
}

function inPastSevenDays(timestamp, cutoff) {
  return toMilliseconds(timestamp) >= cutoff;
}

function transactionsFromChain(chain) {
  return chain.flatMap((block) =>
    (block.transactions || []).map((transaction) => ({
      ...transaction,
      block_index: block.index,
      block_timestamp: block.timestamp,
    }))
  );
}

function countWhere(items, predicate) {
  return items.reduce((count, item) => count + (predicate(item) ? 1 : 0), 0);
}

function money(value) {
  return Number(value || 0).toLocaleString(undefined, {
    maximumFractionDigits: 8,
  });
}

function reportHtml(subject, stats) {
  const statBox = (label, value) => `
    <td style="background:#1a1a2e;border:1px solid #2a2a4a;border-radius:8px;padding:16px;width:50%;">
      <div style="color:#aaaaaa;font-size:13px;text-transform:uppercase;letter-spacing:.08em;">${label}</div>
      <div style="color:#ffffff;font-size:28px;font-weight:800;margin-top:6px;">${value}</div>
    </td>`;

  return `
    <div style="background:#0f0f1a;color:#ffffff;font-family:Inter,Arial,sans-serif;padding:28px;">
      <div style="max-width:760px;margin:0 auto;">
        <h1 style="color:#ffffff;margin:0 0 8px;">Vorliq Weekly Network Report</h1>
        <p style="color:#aaaaaa;margin:0 0 24px;">${subject}</p>
        <table style="width:100%;border-spacing:12px;">
          <tr>${statBox("New Blocks", stats.new_blocks_mined)}${statBox("New Transactions", stats.new_transactions)}</tr>
          <tr>${statBox("New VLQ Issued", money(stats.new_vlq_issued))}${statBox("Treasury Balance", `${money(stats.current_treasury_balance)} VLQ`)}</tr>
          <tr>${statBox("Loan Requests", stats.new_loan_requests)}${statBox("Loans Approved", stats.new_loans_approved)}</tr>
          <tr>${statBox("Exchange Offers", stats.new_exchange_offers)}${statBox("Trades Completed", stats.new_exchange_trades_completed)}</tr>
          <tr>${statBox("Governance Proposals", stats.new_governance_proposals)}${statBox("Treasury Proposals", stats.new_treasury_proposals)}</tr>
        </table>
        <div style="background:#1a1a2e;border:1px solid #2a2a4a;border-radius:8px;padding:18px;margin-top:18px;">
          <h2 style="margin:0 0 10px;color:#6c63ff;">Network Snapshot</h2>
          <p style="color:#dddddd;line-height:1.6;margin:0;">
            Current block height: ${stats.block_height}. Chain status: ${stats.chain_valid ? "valid" : "invalid"}.
            Current mining reward: ${money(stats.current_mining_reward)} VLQ.
          </p>
        </div>
      </div>
    </div>`;
}

async function get(path) {
  const response = await axios.get(`${PUBLIC_API_URL}${path}`, { timeout: 120000 });
  return response.data;
}

async function generateWeeklyReport(options = {}) {
  const sendEmail = options.sendEmail !== false;
  const now = new Date();
  const cutoff = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  const subject = `Vorliq Weekly Network Report ${now.toISOString().slice(0, 10)}`;

  const [chainData, lendingData, exchangeData, governanceData, treasuryData, treasuryProposalsData, diagnosticsData] =
    await Promise.all([
      get("/api/chain"),
      get("/api/lending/loans"),
      get("/api/exchange/all"),
      get("/api/governance/all"),
      get("/api/treasury/balance"),
      get("/api/treasury/all"),
      get("/api/diagnostics"),
    ]);

  const chain = chainData.chain || [];
  const loans = lendingData.loans || [];
  const offers = exchangeData.offers || [];
  const governance = governanceData.proposals || [];
  const treasuryProposals = treasuryProposalsData.proposals || [];
  const transactions = transactionsFromChain(chain);
  const recentBlocks = chain.filter((block) => inPastSevenDays(block.timestamp, cutoff));
  const recentTransactions = transactions.filter((transaction) =>
    inPastSevenDays(transaction.timestamp || transaction.block_timestamp, cutoff)
  );

  const stats = {
    generated_at: now.toISOString(),
    new_blocks_mined: recentBlocks.length,
    new_transactions: recentTransactions.length,
    new_vlq_issued: recentTransactions
      .filter((transaction) => transaction.sender_address === "SYSTEM")
      .reduce((total, transaction) => total + Number(transaction.amount || 0), 0),
    new_loan_requests: countWhere(loans, (loan) => inPastSevenDays(loan.timestamp, cutoff)),
    new_loans_approved: countWhere(loans, (loan) => loan.status === "approved" && inPastSevenDays(loan.timestamp, cutoff)),
    new_exchange_offers: countWhere(offers, (offer) => inPastSevenDays(offer.timestamp, cutoff)),
    new_exchange_trades_completed: countWhere(
      offers,
      (offer) => offer.status === "completed" && inPastSevenDays(offer.accepted_timestamp || offer.timestamp, cutoff)
    ),
    new_governance_proposals: countWhere(governance, (proposal) => inPastSevenDays(proposal.timestamp, cutoff)),
    new_treasury_proposals: countWhere(treasuryProposals, (proposal) => inPastSevenDays(proposal.timestamp, cutoff)),
    current_treasury_balance: Number(treasuryData.balance || 0),
    block_height: diagnosticsData.block_height,
    chain_valid: Boolean(diagnosticsData.chain_valid),
    current_mining_reward: diagnosticsData.current_mining_reward,
  };

  const html = reportHtml(subject, stats);
  const report = { success: true, subject, stats, html };

  if (sendEmail) {
    await axios.post(
      FORMSPREE_ENDPOINT,
      {
        email: "vorliq@gmail.com",
        subject,
        message: html,
        _replyto: "vorliq@gmail.com",
      },
      { timeout: 30000 }
    );
    logInfo(`Weekly report sent: ${subject}`);
  }

  return report;
}

async function sendWeeklyReport() {
  try {
    return await generateWeeklyReport({ sendEmail: true });
  } catch (error) {
    logError(`Weekly report failed: ${error.message}`);
    throw error;
  }
}

module.exports = {
  generateWeeklyReport,
  sendWeeklyReport,
};
