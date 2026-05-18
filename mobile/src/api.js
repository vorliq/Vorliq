import axios from "axios";
import { loadNodeUrl } from "./storage";

function cleanParams(params = {}) {
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== "")
  );
}

async function request(method, path, options = {}) {
  try {
    const baseUrl = await loadNodeUrl();
    const response = await axios({
      method,
      url: `${baseUrl}${path}`,
      timeout: 10000,
      ...options,
    });

    return { success: true, data: response.data };
  } catch (error) {
    const message =
      error.response?.data?.message ||
      error.response?.data?.error ||
      error.message ||
      "Unable to reach the Vorliq node.";

    return {
      success: false,
      error: message,
      status: error.response?.status,
      wait_seconds: error.response?.data?.wait_seconds,
    };
  }
}

export { request };

export async function getChain() {
  return request("get", "/api/chain");
}

export async function getChainSummary() {
  return request("get", "/api/chain/summary");
}

export async function getBalance(address) {
  return request("get", "/api/wallet/balance", {
    params: { address },
  });
}

export async function createWallet() {
  return request("post", "/api/wallet/create");
}

export async function sendTransaction(transactionData) {
  return request("post", "/api/transaction/send", {
    data: transactionData,
  });
}

export async function mineBlock(minerAddress) {
  return request("post", "/api/mine", {
    data: { miner_address: minerAddress, minerAddress },
  });
}

export async function getMiningStatus() {
  return request("get", "/api/mining/status");
}

export async function getMiningHistory(options = {}) {
  return request("get", "/api/mining/history", {
    params: cleanParams(options),
  });
}

export async function getTransactions(params = {}) {
  return request("get", "/api/transactions", {
    params: cleanParams(params),
  });
}

export async function getPendingTransactions(params = {}) {
  return request("get", "/api/transactions/pending", {
    params: cleanParams(params),
  });
}

export async function getTransaction(txId) {
  return request("get", `/api/transactions/${encodeURIComponent(txId)}`);
}

export async function getBlock(blockId) {
  return request("get", `/api/chain/block/${encodeURIComponent(blockId)}`);
}

export async function getAddressHistory(address, params = {}) {
  return request("get", "/api/chain/address", {
    params: cleanParams({ address, ...params }),
  });
}

export async function getProfile(address) {
  return request("get", "/api/profiles/profile", {
    params: { address },
  });
}

export async function saveProfile(profileData) {
  return request("post", "/api/profiles/profile", {
    data: profileData,
  });
}

export async function getTopProfiles(limit = 10) {
  return request("get", "/api/profiles/top", {
    params: { limit },
  });
}

export async function getLoans(params = {}) {
  return request("get", "/api/lending/loans", {
    params: cleanParams(params),
  });
}

export async function getLendingSummary() {
  return request("get", "/api/lending/summary");
}

export async function getLoan(loanId) {
  return request("get", "/api/lending/loan", {
    params: { loan_id: loanId },
  });
}

export async function getMyLoans(address) {
  return request("get", "/api/lending/my", {
    params: { address },
  });
}

export async function submitLoan(loanData) {
  return request("post", "/api/lending/request", {
    data: loanData,
  });
}

export async function voteLoan(voteData) {
  return request("post", "/api/lending/vote", {
    data: voteData,
  });
}

export async function repayLoan(repayData) {
  return request("post", "/api/lending/repay", {
    data: repayData,
  });
}

export async function getDiagnostics() {
  return request("get", "/api/diagnostics");
}

export async function getExchangeOffers(params = {}) {
  return request("get", "/api/exchange/offers", {
    params: cleanParams(params),
  });
}

export async function getMyExchangeOffers(address) {
  return request("get", "/api/exchange/my", {
    params: { address },
  });
}

export async function getExchangeSummary() {
  return request("get", "/api/exchange/summary");
}

export async function getExchangeOffer(offerId) {
  return request("get", "/api/exchange/offer", {
    params: { offer_id: offerId },
  });
}

export async function getMyExchangeTrades(address) {
  return getMyExchangeOffers(address);
}

export async function createExchangeOffer(offerData) {
  return request("post", "/api/exchange/offer", {
    data: offerData,
  });
}

export async function acceptExchangeOffer(offerData) {
  return request("post", "/api/exchange/accept", {
    data: offerData,
  });
}

export async function completeExchangeOffer(offerData) {
  return request("post", "/api/exchange/complete", {
    data: offerData,
  });
}

export async function recordExchangeVlqTx(offerData) {
  return request("post", "/api/exchange/record-vlq-tx", {
    data: offerData,
  });
}

export async function confirmExchangeComplete(offerData) {
  return request("post", "/api/exchange/confirm-complete", {
    data: offerData,
  });
}

export async function openExchangeDispute(offerData) {
  return request("post", "/api/exchange/dispute", {
    data: offerData,
  });
}

export async function cancelExchangeOffer(offerData) {
  return request("post", "/api/exchange/cancel", {
    data: offerData,
  });
}

export async function getGovernanceProposals(params = {}) {
  return request("get", "/api/governance/proposals", {
    params: cleanParams(params),
  });
}

export async function getGovernanceSettings() {
  return request("get", "/api/governance/settings");
}

export async function getGovernanceSummary() {
  return request("get", "/api/governance/summary");
}

export async function getGovernanceProposal(proposalId) {
  return request("get", "/api/governance/proposal", {
    params: { proposal_id: proposalId },
  });
}

export async function getMyGovernance(address) {
  return request("get", "/api/governance/my", {
    params: { address },
  });
}

export async function getRuleChanges() {
  return request("get", "/api/governance/rule-changes");
}

export async function voteGovernanceProposal(voteData) {
  return request("post", "/api/governance/vote", {
    data: voteData,
  });
}

export async function getTreasurySummary() {
  return request("get", "/api/treasury/summary");
}

export async function getTreasuryLedger(options = {}) {
  return request("get", "/api/treasury/ledger", {
    params: cleanParams(options),
  });
}

export async function getTreasuryProposals(params = {}) {
  return request("get", "/api/treasury/proposals", {
    params: cleanParams(params),
  });
}

export async function getMyTreasury(address) {
  return request("get", "/api/treasury/my", {
    params: { address },
  });
}

export async function submitTreasuryProposal(proposalData) {
  return request("post", "/api/treasury/propose", {
    data: proposalData,
  });
}

export async function voteTreasuryProposal(voteData) {
  return request("post", "/api/treasury/vote", {
    data: voteData,
  });
}

export async function getFaucetSummary() {
  return request("get", "/api/faucet/summary");
}

export async function claimFaucet(walletAddress) {
  return request("post", "/api/faucet/claim", {
    data: { wallet_address: walletAddress },
  });
}

export async function getFaucetClaims(address) {
  return request("get", "/api/faucet/claims", {
    params: { address },
  });
}

export async function getRecentFaucetClaims(options = {}) {
  return request("get", "/api/faucet/recent", {
    params: cleanParams(options),
  });
}

export async function getRegistrySummary() {
  return request("get", "/api/registry/summary");
}

export async function getActiveNodes() {
  return request("get", "/api/registry/nodes");
}

export async function getNodeDetails(nodeUrl) {
  return request("get", "/api/registry/node", {
    params: { node_url: nodeUrl },
  });
}

export async function getNetworkManifest() {
  return request("get", "/api/network/manifest");
}

export async function getActiveIncidents() {
  return request("get", "/api/incidents/active");
}
