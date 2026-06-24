// Real-time event fan-out over the existing socket.io server. index.js wires the
// io instance in via setIo; routes call the emit helpers when they process the
// corresponding chain activity. All emits are best-effort and never throw.
const { logError } = require("./logger");

let io = null;
const RESERVED_ADDRESSES = new Set(["SYSTEM", "VORLIQ_TREASURY", "LENDING_POOL"]);
const CONCLUDED_PROPOSAL_STATUSES = new Set([
  "executed",
  "passed_pending_execution",
  "rejected",
  "expired",
]);

function setIo(instance) {
  io = instance;
}

function emit(event, payload) {
  try {
    if (io) io.emit(event, payload);
  } catch (error) {
    logError(`realtime emit failed for ${event}: ${error.message}`);
  }
}

// Derive and emit the per-wallet and network events implied by a freshly mined
// block: a new-block event always, a wallet credit for every address the block
// pays, and loan funded/repaid events for issuance/repayment transactions.
// Highest block index already fanned out as "block:new". The block bridge reads
// this to avoid re-emitting a block that the manual /api/mining route already
// announced, and updates it after a background-mined block. Shared so there is
// exactly one source of truth for "which blocks have been broadcast".
let lastEmittedBlockHeight = -1;

function getLastEmittedBlockHeight() {
  return lastEmittedBlockHeight;
}

function noteEmittedBlockHeight(height) {
  const value = Number(height);
  if (Number.isFinite(value) && value > lastEmittedBlockHeight) {
    lastEmittedBlockHeight = value;
  }
}

function emitMinedBlock(block) {
  if (!block || typeof block !== "object") return;
  noteEmittedBlockHeight(block.index);
  emit("block:new", {
    index: block.index,
    height: block.index, // get_block_height() == latest block index
    hash: block.hash,
    timestamp: block.timestamp,
  });

  const transactions = Array.isArray(block.transactions) ? block.transactions : [];
  for (const raw of transactions) {
    const tx = raw && typeof raw === "object" ? raw : {};
    const type = tx.transaction_type || tx.type;
    const loanId = tx.metadata && (tx.metadata.loan_id || tx.metadata.loanId);

    if (type === "loan_issuance") {
      emit("loan:funded", { address: tx.receiver_address, loan_id: loanId, amount: tx.amount, tx_id: tx.tx_id });
    } else if (type === "loan_repayment") {
      // The repayment is borrower -> pool, so the borrower (sender) is the
      // person whose loan was repaid and who should be notified.
      emit("loan:repaid", { address: tx.sender_address, loan_id: loanId, amount: tx.amount, tx_id: tx.tx_id });
    }

    // Any confirmed credit to a normal wallet (transfer, faucet, mining reward,
    // loan issuance). Reserved system addresses are not user wallets.
    if (tx.receiver_address && !RESERVED_ADDRESSES.has(tx.receiver_address)) {
      emit("wallet:credit", { address: tx.receiver_address, amount: tx.amount, tx_id: tx.tx_id, type });
    }
  }
}

// Emit when a governance proposal reaches a recorded outcome.
function emitProposalOutcome(proposal) {
  if (!proposal || typeof proposal !== "object") return;
  if (CONCLUDED_PROPOSAL_STATUSES.has(proposal.status)) {
    emit("proposal:outcome", {
      address: proposal.proposer_address,
      proposal_id: proposal.proposal_id,
      status: proposal.status,
      title: proposal.title,
    });
  }
}

module.exports = {
  setIo,
  emit,
  emitMinedBlock,
  emitProposalOutcome,
  getLastEmittedBlockHeight,
  noteEmittedBlockHeight,
};
