import axios from "axios";
import { loadNodeUrl } from "./storage";

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

    return { success: false, error: message };
  }
}

export async function getChain() {
  return request("get", "/api/chain");
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

export async function getLoans() {
  return request("get", "/api/lending/loans");
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
