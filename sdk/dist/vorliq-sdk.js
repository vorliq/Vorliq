const { signTransaction } = require("./signer");
const {
  createTransactionReview,
  isReservedAddress,
  validateAddress,
  assertTransactionReview,
} = require("./address");
const crypto = require("crypto");

async function getFetch() {
  if (typeof fetch === "function") {
    return fetch.bind(globalThis);
  }

  const imported = await import("node-fetch");
  return imported.default;
}

function trimNodeUrl(nodeUrl) {
  return String(nodeUrl || "https://vorliq.org").replace(/\/+$/, "");
}

function normalizeApiVersion(apiVersion) {
  const version = String(apiVersion || "v1").toLowerCase();
  if (version === "legacy" || version === "v1") return version;
  throw new Error('apiVersion must be "v1" or "legacy".');
}

function versionedPath(path, apiVersion) {
  if (apiVersion === "legacy") return path;
  if (path === "/api") return "/api/v1";
  if (path.startsWith("/api/v1/") || path === "/api/v1") return path;
  if (path.startsWith("/api/")) return path.replace(/^\/api(?=\/)/, "/api/v1");
  return path;
}

function paginationQuery(limit, offset) {
  const params = new URLSearchParams();
  if (limit !== undefined) params.set("limit", String(limit));
  if (offset !== undefined) params.set("offset", String(offset));
  const query = params.toString();
  return query ? `?${query}` : "";
}

function transactionQuery(params = {}) {
  const query = new URLSearchParams();
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.offset !== undefined) query.set("offset", String(params.offset));
  if (params.address) query.set("address", String(params.address));
  if (params.type) query.set("type", String(params.type));
  if (params.status) query.set("status", String(params.status));
  const value = query.toString();
  return value ? `?${value}` : "";
}

function lendingQuery(params = {}) {
  const query = new URLSearchParams();
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.offset !== undefined) query.set("offset", String(params.offset));
  if (params.status) query.set("status", String(params.status));
  if (params.address) query.set("address", String(params.address));
  const value = query.toString();
  return value ? `?${value}` : "";
}

function governanceQuery(params = {}) {
  const query = new URLSearchParams();
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.offset !== undefined) query.set("offset", String(params.offset));
  if (params.status) query.set("status", String(params.status));
  if (params.category) query.set("category", String(params.category));
  if (params.address) query.set("address", String(params.address));
  const value = query.toString();
  return value ? `?${value}` : "";
}

function treasuryQuery(params = {}) {
  const query = new URLSearchParams();
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.offset !== undefined) query.set("offset", String(params.offset));
  if (params.status) query.set("status", String(params.status));
  if (params.category) query.set("category", String(params.category));
  if (params.address) query.set("address", String(params.address));
  const value = query.toString();
  return value ? `?${value}` : "";
}

function registryQuery(params = {}) {
  const query = new URLSearchParams();
  if (params.status) query.set("status", String(params.status));
  if (params.country) query.set("country", String(params.country));
  if (params.sync_status || params.syncStatus) query.set("sync_status", String(params.sync_status || params.syncStatus));
  const value = query.toString();
  return value ? `?${value}` : "";
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = canonicalize(value[key]);
        return result;
      }, {});
  }
  return value;
}

function canonicalStringify(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

class VorliqSDK {
  /**
   * Creates a Vorliq SDK client.
   *
   * @param {object} [config] - SDK configuration.
   * @param {string} [config.nodeUrl="https://vorliq.org"] - Base URL of the Vorliq node to call.
   * @returns {VorliqSDK} A configured Vorliq SDK instance.
   */
  constructor(config = {}) {
    this.nodeUrl = trimNodeUrl(config.nodeUrl || "https://vorliq.org");
    this.apiVersion = normalizeApiVersion(config.apiVersion || "v1");
    this.pollIntervalMs = 30000;
    this.requestId = "";
    this.lastRequestId = "";
  }

  setRequestId(requestId) {
    const normalized = String(requestId || "").trim();
    if (normalized && !/^[A-Za-z0-9._:-]{1,80}$/.test(normalized)) {
      throw new Error("requestId must be 80 safe characters or fewer.");
    }
    this.requestId = normalized;
    return this;
  }

  /**
   * Calls the Vorliq API.
   *
   * @param {string} path - API path beginning with /api.
   * @param {object} [options] - Fetch options.
   * @returns {Promise<object>} Parsed JSON response from the node.
   */
  async request(path, options = {}) {
    const fetchImpl = await getFetch();
    const requestId = options.requestId || this.requestId;
    const headers = {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(requestId ? { "X-Request-ID": requestId } : {}),
      ...(options.headers || {}),
    };
    const { requestId: _requestId, ...fetchOptions } = options;
    const response = await fetchImpl(`${this.nodeUrl}${versionedPath(path, this.apiVersion)}`, { ...fetchOptions, headers });
    this.lastRequestId = response.headers?.get?.("x-request-id") || this.lastRequestId || "";
    const data = await response.json();

    if (!response.ok || data.success === false) {
      const errorObject = data.error && typeof data.error === "object" ? data.error : {};
      const message = errorObject.message || data.message || data.error || `Vorliq request failed with status ${response.status}.`;
      const error = new Error(message);
      error.status = response.status;
      error.code = errorObject.code;
      error.data = data;
      error.requestId = data.request_id || this.lastRequestId || "";
      throw error;
    }

    return data;
  }

  async getAPIVersion() {
    return this.request("/api/version");
  }

  async getVersionMetadata() {
    return this.request("/api/version/metadata");
  }

  async getChangelog() {
    return this.request("/api/changelog");
  }

  async getRoadmap() {
    return this.request("/api/roadmap");
  }

  async getReadiness() {
    return this.request("/api/readiness");
  }

  /**
   * Gets the full blockchain from the configured Vorliq node.
   *
   * @returns {Promise<object>} The full chain data returned by GET /api/chain.
   */
  async getChain() {
    return this.request("/api/chain");
  }

  /**
   * Gets a lightweight summary of the blockchain without downloading every block.
   *
   * @returns {Promise<object>} Chain summary containing height, totals, last block details, and validity.
   */
  async getChainSummary() {
    const data = await this.request("/api/chain/summary");
    return data.summary || data;
  }

  /**
   * Gets a paginated page of blocks ordered newest first.
   *
   * @param {number} [limit=50] - Maximum number of blocks to return.
   * @param {number} [offset=0] - Number of newest blocks to skip.
   * @returns {Promise<object>} Paginated block response with blocks, total_blocks, limit, offset, and has_more.
   */
  async getBlocks(limit = 50, offset = 0) {
    return this.request(`/api/chain/blocks${paginationQuery(limit, offset)}`);
  }

  /**
   * Gets paginated transactions involving one wallet address.
   *
   * @param {string} address - Wallet address to search.
   * @param {number} [limit=50] - Maximum number of transactions to return.
   * @param {number} [offset=0] - Number of matching transactions to skip.
   * @returns {Promise<object>} Paginated transaction response with total count and has_more.
   */
  async getAddressTransactions(address, limit = 50, offset = 0) {
    const query = new URLSearchParams({ address, limit: String(limit), offset: String(offset) });
    return this.request(`/api/chain/address?${query.toString()}`);
  }

  /**
   * Gets wallet history with pending and confirmed transaction breakdowns.
   *
   * @param {string} address - Wallet address to inspect.
   * @param {object} [params] - Pagination options.
   * @param {number} [params.limit=25] - Maximum transactions to return.
   * @param {number} [params.offset=0] - Number of transactions to skip.
   * @returns {Promise<object>} Address history with pending totals, confirmed totals, balance, and transactions.
   */
  async getAddressHistory(address, params = {}) {
    const query = new URLSearchParams({
      address,
      limit: String(params.limit ?? 25),
      offset: String(params.offset ?? 0),
    });
    return this.request(`/api/chain/address?${query.toString()}`);
  }

  /**
   * Gets paginated pending and confirmed transactions.
   *
   * @param {object} [params] - Filters for limit, offset, address, type, and status.
   * @returns {Promise<object>} Paginated transactions response.
   */
  async getTransactions(params = {}) {
    return this.request(`/api/transactions${transactionQuery(params)}`);
  }

  /**
   * Gets pending transactions waiting to be mined.
   *
   * @param {object} [params] - Filters for limit, offset, and optional address.
   * @returns {Promise<object>} Paginated pending transactions response.
   */
  async getPendingTransactions(params = {}) {
    return this.request(`/api/transactions/pending${transactionQuery(params)}`);
  }

  /**
   * Gets one transaction by transaction ID.
   *
   * @param {string} txId - Stable transaction ID.
   * @returns {Promise<object>} Safe transaction detail.
   */
  async getTransaction(txId) {
    const data = await this.request(`/api/transactions/${encodeURIComponent(txId)}`);
    return data.transaction || data;
  }

  /**
   * Gets one block by numeric index or block hash.
   *
   * @param {string|number} blockId - Block index or hash.
   * @returns {Promise<object>} Safe block detail with transactions.
   */
  async getBlock(blockId) {
    const data = await this.request(`/api/chain/block/${encodeURIComponent(blockId)}`);
    return data.block || data;
  }

  /**
   * Gets public mining status, cooldown, reward split, and pending transaction counts.
   *
   * @returns {Promise<object>} Mining status fields from GET /api/mining/status.
   */
  async getMiningStatus() {
    const data = await this.request("/api/mining/status");
    return data.status || data;
  }

  /**
   * Gets recent mined block history with reward split and block timing.
   *
   * @param {object} [options] - Pagination options.
   * @param {number} [options.limit=25] - Maximum history rows to return.
   * @param {number} [options.offset=0] - Number of newest rows to skip.
   * @returns {Promise<object>} Mining history response.
   */
  async getMiningHistory(options = {}) {
    return this.request(`/api/mining/history${paginationQuery(options.limit ?? 25, options.offset ?? 0)}`);
  }

  /**
   * Gets the community leaderboard calculated server side.
   *
   * @param {number} [limit=20] - Maximum rows per leaderboard section.
   * @param {number} [offset=0] - Number of rows to skip per section.
   * @returns {Promise<object>} Leaderboard response containing holders, miners, and lenders.
   */
  async getLeaderboard(limit = 20, offset = 0) {
    return this.request(`/api/leaderboard${paginationQuery(limit, offset)}`);
  }

  /**
   * Gets the public Vorliq network manifest for transparency and integration checks.
   *
   * @returns {Promise<object>} Safe public network metadata including URLs, deployment commit, chain summary, diagnostics, SDK version, incident activity, and generated timestamp.
   */
  async getNetworkManifest() {
    return this.request("/api/network/manifest");
  }

  /**
   * Gets public registry summary counts and node trust signals.
   *
   * @returns {Promise<object>} Registry summary fields.
   */
  async getRegistrySummary() {
    const data = await this.request("/api/registry/summary");
    return data.summary || data;
  }

  /**
   * Gets active public nodes seen in the recent active window.
   *
   * @returns {Promise<object>} Active node list response.
   */
  async getActiveNodes() {
    return this.request("/api/registry/nodes");
  }

  /**
   * Gets all registered nodes, including inactive nodes.
   *
   * @param {object} [options] Optional status, country, and sync_status filters.
   * @returns {Promise<object>} Node list response.
   */
  async getAllNodes(options = {}) {
    return this.request(`/api/registry/all${registryQuery(options)}`);
  }

  /**
   * Gets one registry node by URL.
   *
   * @param {string} nodeUrl Public node URL.
   * @returns {Promise<object>} Public node detail.
   */
  async getNodeDetails(nodeUrl) {
    const query = new URLSearchParams({ node_url: nodeUrl });
    const data = await this.request(`/api/registry/node?${query.toString()}`);
    return data.node || data;
  }

  /**
   * Registers a public Vorliq node.
   *
   * @param {object} data Public node metadata.
   * @returns {Promise<object>} Registration response.
   */
  async registerNode(data) {
    return this.request("/api/registry/register", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  /**
   * Sends public heartbeat diagnostics for a node.
   *
   * @param {object} data Safe node heartbeat payload.
   * @returns {Promise<object>} Heartbeat response.
   */
  async sendNodeHeartbeat(data) {
    return this.request("/api/registry/heartbeat", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  /**
   * Gets the confirmed VLQ balance for a wallet address.
   *
   * @param {string} address - Vorliq wallet address to check.
   * @returns {Promise<number>} The wallet balance as a number.
   */
  async getBalance(address) {
    const data = await this.request(`/api/wallet/balance?address=${encodeURIComponent(address)}`);
    return Number(data.balance || 0);
  }

  /**
   * Creates a new Vorliq wallet.
   *
   * @returns {Promise<object>} New wallet object containing address, public_key, and private_key.
   */
  async createWallet() {
    const data = await this.request("/api/wallet/create", {
      method: "POST",
      body: JSON.stringify({}),
    });
    return {
      address: data.address,
      public_key: data.public_key,
      private_key: data.private_key,
    };
  }

  /**
   * Signs a VLQ transaction locally and submits it to the Vorliq pending pool.
   * The private key is used only in this SDK caller environment and is never
   * sent to the Vorliq API.
   *
   * @param {string} fromAddress - Sender wallet address.
   * @param {string} fromPrivateKey - Sender private key in PEM format.
   * @param {string} fromPublicKey - Sender public key in PEM format.
   * @param {string} toAddress - Receiver wallet address.
   * @param {number|string} amount - Amount of VLQ to send.
   * @returns {Promise<object>} API result returned by POST /api/transaction/send.
   */
  async sendTransaction(fromAddress, fromPrivateKey, fromPublicKey, toAddress, amount) {
    const review = createTransactionReview(fromAddress, toAddress, amount);
    assertTransactionReview(review);

    const signedTransaction = signTransaction({
      senderAddress: review.from,
      senderPrivateKey: fromPrivateKey,
      senderPublicKey: fromPublicKey,
      receiverAddress: review.to,
      amount: review.amount,
    });

    return this.request("/api/transaction/send", {
      method: "POST",
      body: JSON.stringify(signedTransaction),
    });
  }

  /**
   * Mines a block for a miner address.
   *
   * @param {string} minerAddress - Wallet address that receives the mining reward.
   * @returns {Promise<object>} New block data, or a clear rejected-mining response with message and wait_seconds.
   */
  async mineBlock(minerAddress) {
    try {
      const data = await this.request("/api/mine", {
        method: "POST",
        body: JSON.stringify({ miner_address: minerAddress }),
      });
      return data.block || data;
    } catch (error) {
      if (error.status === 429 && error.data) {
        return {
          success: false,
          message: error.data.message || "Mining was rejected by the Vorliq node.",
          wait_seconds: error.data.wait_seconds,
        };
      }
      throw error;
    }
  }

  /**
   * Gets all community lending requests.
   *
   * @returns {Promise<Array<object>>} All loan request objects.
   */
  async getLoans(params = {}) {
    const data = await this.request(`/api/lending/loans${lendingQuery(params)}`);
    return data.loans || [];
  }

  /**
   * Gets one community loan lifecycle record by loan ID.
   *
   * @param {string} loanId - Loan identifier returned by the lending API.
   * @returns {Promise<object>} Loan record with lifecycle status and transaction links.
   */
  async getLoan(loanId) {
    const query = new URLSearchParams({ loan_id: loanId });
    const data = await this.request(`/api/lending/loan?${query.toString()}`);
    return data.loan || data;
  }

  /**
   * Gets loans where an address is borrower or voter.
   *
   * @param {string} address - Wallet address to inspect.
   * @returns {Promise<object>} Borrowed, voted, and combined loan lists.
   */
  async getMyLoans(address) {
    const query = new URLSearchParams({ address });
    return this.request(`/api/lending/my?${query.toString()}`);
  }

  /**
   * Gets aggregate lending lifecycle counts and VLQ totals.
   *
   * @returns {Promise<object>} Lending summary fields.
   */
  async getLendingSummary() {
    const data = await this.request("/api/lending/summary");
    return data.summary || data;
  }

  /**
   * Submits a loan repayment transaction to the pending pool.
   *
   * @param {string} loanId - Loan to repay.
   * @param {string} repayerAddress - Borrower wallet address.
   * @returns {Promise<object>} Repayment response including repayment_tx_id.
   */
  async repayLoan(loanId, repayerAddress) {
    return this.request("/api/lending/repay", {
      method: "POST",
      body: JSON.stringify({ loan_id: loanId, repayer_address: repayerAddress }),
    });
  }

  /**
   * Gets all open decentralized exchange offers.
   *
   * @returns {Promise<Array<object>>} Open exchange offer objects.
   */
  async getExchangeOffers() {
    const data = await this.request("/api/exchange/offers");
    return data.offers || [];
  }

  /**
   * Gets one exchange offer or trade by ID.
   *
   * @param {string} offerId - Exchange offer ID.
   * @returns {Promise<object>} Offer lifecycle record.
   */
  async getExchangeOffer(offerId) {
    const query = new URLSearchParams({ offer_id: offerId });
    const data = await this.request(`/api/exchange/offer?${query.toString()}`);
    return data.offer || data;
  }

  /**
   * Gets exchange trades involving one address.
   *
   * @param {string} address - Wallet address to inspect.
   * @returns {Promise<object>} Created, accepted, and combined offer lists.
   */
  async getMyExchangeTrades(address) {
    const query = new URLSearchParams({ address });
    return this.request(`/api/exchange/my?${query.toString()}`);
  }

  /**
   * Gets exchange lifecycle summary counts.
   *
   * @returns {Promise<object>} Exchange summary fields.
   */
  async getExchangeSummary() {
    const data = await this.request("/api/exchange/summary");
    return data.summary || data;
  }

  /**
   * Records an already-submitted VLQ transaction against an exchange trade.
   *
   * @param {string} offerId - Offer/trade ID.
   * @param {string} txId - Existing Vorliq transaction ID.
   * @param {string} callerAddress - Wallet address recording the transaction.
   * @returns {Promise<object>} Updated offer response.
   */
  async recordExchangeVlqTx(offerId, txId, callerAddress) {
    return this.request("/api/exchange/record-vlq-tx", {
      method: "POST",
      body: JSON.stringify({ offer_id: offerId, tx_id: txId, caller_address: callerAddress }),
    });
  }

  /**
   * Confirms off-chain completion for one side of an exchange trade.
   *
   * @param {string} offerId - Offer/trade ID.
   * @param {string} callerAddress - Creator or acceptor address.
   * @returns {Promise<object>} Updated offer response.
   */
  async confirmExchangeComplete(offerId, callerAddress) {
    return this.request("/api/exchange/confirm-complete", {
      method: "POST",
      body: JSON.stringify({ offer_id: offerId, caller_address: callerAddress }),
    });
  }

  /**
   * Opens a participant dispute on an active exchange trade.
   *
   * @param {string} offerId - Offer/trade ID.
   * @param {string} callerAddress - Creator or acceptor address.
   * @param {string} reason - Public dispute reason.
   * @returns {Promise<object>} Updated offer response.
   */
  async openExchangeDispute(offerId, callerAddress, reason) {
    return this.request("/api/exchange/dispute", {
      method: "POST",
      body: JSON.stringify({ offer_id: offerId, caller_address: callerAddress, reason }),
    });
  }

  /**
   * Gets aggregate governance lifecycle counts and current governable settings.
   *
   * @returns {Promise<object>} Governance summary fields.
   */
  async getGovernanceSummary() {
    const data = await this.request("/api/governance/summary");
    return data.summary || data;
  }

  /**
   * Gets one governance proposal lifecycle record.
   *
   * @param {string} proposalId - Governance proposal ID.
   * @returns {Promise<object>} Proposal record.
   */
  async getGovernanceProposal(proposalId) {
    const query = new URLSearchParams({ proposal_id: proposalId });
    const data = await this.request(`/api/governance/proposal?${query.toString()}`);
    return data.proposal || data;
  }

  /**
   * Gets proposals created by or voted on by an address.
   *
   * @param {string} address - Wallet address to inspect.
   * @returns {Promise<object>} Created, voted, and combined proposal lists.
   */
  async getMyGovernance(address) {
    const query = new URLSearchParams({ address });
    return this.request(`/api/governance/my?${query.toString()}`);
  }

  /**
   * Cancels an active proposal before votes are cast.
   *
   * @param {string} proposalId - Governance proposal ID.
   * @param {string} proposerAddress - Proposal creator address.
   * @returns {Promise<object>} Updated proposal response.
   */
  async cancelGovernanceProposal(proposalId, proposerAddress) {
    return this.request("/api/governance/cancel", {
      method: "POST",
      body: JSON.stringify({ proposal_id: proposalId, proposer_address: proposerAddress }),
    });
  }

  /**
   * Gets executed governance rule changes.
   *
   * @param {object} [params] - Optional pagination filters.
   * @returns {Promise<Array<object>>} Rule change records.
   */
  async getRuleChanges(params = {}) {
    const data = await this.request(`/api/governance/rule-changes${governanceQuery(params)}`);
    return data.rule_changes || [];
  }

  /**
   * Gets settings history derived from governance rule changes.
   *
   * @param {object} [params] - Optional pagination filters.
   * @returns {Promise<Array<object>>} Governance settings history records.
   */
  async getGovernanceSettingsHistory(params = {}) {
    const data = await this.request(`/api/governance/settings/history${governanceQuery(params)}`);
    return data.history || data.rule_changes || [];
  }

  /**
   * Gets aggregate treasury lifecycle totals and latest ledger entries.
   *
   * @returns {Promise<object>} Treasury summary fields.
   */
  async getTreasurySummary() {
    const data = await this.request("/api/treasury/summary");
    return data.summary || data;
  }

  /**
   * Gets one treasury proposal by ID.
   *
   * @param {string} proposalId - Treasury proposal ID.
   * @returns {Promise<object>} Treasury proposal lifecycle record.
   */
  async getTreasuryProposal(proposalId) {
    const query = new URLSearchParams({ proposal_id: proposalId });
    const data = await this.request(`/api/treasury/proposal?${query.toString()}`);
    return data.proposal || data;
  }

  /**
   * Gets treasury activity where an address is proposer, voter, or payout recipient.
   *
   * @param {string} address - Wallet address to inspect.
   * @returns {Promise<object>} Created, voted, received, and combined proposal lists.
   */
  async getMyTreasury(address) {
    const query = new URLSearchParams({ address });
    return this.request(`/api/treasury/my?${query.toString()}`);
  }

  /**
   * Cancels an active treasury proposal before votes are cast.
   *
   * @param {string} proposalId - Treasury proposal ID.
   * @param {string} proposerAddress - Proposal creator address.
   * @returns {Promise<object>} Updated proposal response.
   */
  async cancelTreasuryProposal(proposalId, proposerAddress) {
    return this.request("/api/treasury/cancel", {
      method: "POST",
      body: JSON.stringify({ proposal_id: proposalId, proposer_address: proposerAddress }),
    });
  }

  /**
   * Gets public treasury ledger entries.
   *
   * @param {object} [options] - Pagination options.
   * @returns {Promise<object>} Ledger response with entries, total, limit, offset, and has_more.
   */
  async getTreasuryLedger(options = {}) {
    return this.request(`/api/treasury/ledger${treasuryQuery(options)}`);
  }

  /**
   * Gets starter faucet availability and public claim totals.
   *
   * @returns {Promise<object>} Faucet summary fields.
   */
  async getFaucetSummary() {
    const data = await this.request("/api/faucet/summary");
    return data.summary || data;
  }

  /**
   * Requests a treasury-backed starter VLQ claim for a wallet address.
   *
   * @param {string} walletAddress - Recipient wallet address.
   * @returns {Promise<object>} Claim response with pending transaction details when funded.
   */
  async claimFaucet(walletAddress) {
    return this.request("/api/faucet/claim", {
      method: "POST",
      body: JSON.stringify({ wallet_address: walletAddress }),
    });
  }

  /**
   * Gets faucet claims for a wallet address.
   *
   * @param {string} address - Wallet address to inspect.
   * @returns {Promise<Array<object>>} Claim records for the address.
   */
  async getFaucetClaims(address) {
    const query = new URLSearchParams({ address });
    const data = await this.request(`/api/faucet/claims?${query.toString()}`);
    return data.claims || [];
  }

  /**
   * Gets recent public faucet claims.
   *
   * @param {object} [options] - Pagination options.
   * @returns {Promise<object>} Recent claims response.
   */
  async getRecentFaucetClaims(options = {}) {
    return this.request(`/api/faucet/recent${paginationQuery(options.limit, options.offset)}`);
  }

  /**
   * Gets node diagnostic information.
   *
   * @returns {Promise<object>} Full diagnostics object returned by GET /api/diagnostics.
   */
  async getDiagnostics() {
    return this.request("/api/diagnostics");
  }

  /**
   * Gets achievements earned by a wallet address.
   *
   * @param {string} address - Wallet address to inspect.
   * @returns {Promise<Array<object>>} Achievement objects earned by the address.
   */
  async getAchievements(address) {
    const data = await this.request(`/api/achievements?address=${encodeURIComponent(address)}`);
    return data.achievements || [];
  }

  /**
   * Gets one public member profile by wallet address.
   *
   * @param {string} address - Wallet address to inspect.
   * @returns {Promise<object>} Public profile object with reputation and badges.
   */
  async getProfile(address) {
    const query = new URLSearchParams({ address });
    const data = await this.request(`/api/profiles/profile?${query.toString()}`);
    return data.profile || data;
  }

  /**
   * Creates or updates a public member profile.
   *
   * @param {object} profileData - Profile fields including wallet_address and display_name.
   * @returns {Promise<object>} Saved public profile.
   */
  async saveProfile(profileData) {
    const data = await this.request("/api/profiles/profile", {
      method: "POST",
      body: JSON.stringify(profileData),
    });
    return data.profile || data;
  }

  /**
   * Searches public member profiles.
   *
   * @param {string} query - Search query matching name, location, country, or wallet address.
   * @param {object} [options] - Pagination options.
   * @param {number} [options.limit=50] - Maximum profile rows to return.
   * @param {number} [options.offset=0] - Number of matching profiles to skip.
   * @returns {Promise<Array<object>>} Matching public profiles.
   */
  async searchProfiles(query, options = {}) {
    const params = new URLSearchParams({
      q: query,
      limit: String(options.limit ?? 50),
      offset: String(options.offset ?? 0),
    });
    const data = await this.request(`/api/profiles/search?${params.toString()}`);
    return data.profiles || [];
  }

  /**
   * Gets top public profiles by transparent reputation score.
   *
   * @param {number} [limit=20] - Maximum profiles to return.
   * @returns {Promise<Array<object>>} Top public profiles.
   */
  async getTopProfiles(limit = 20) {
    const data = await this.request(`/api/profiles/top?limit=${encodeURIComponent(limit)}`);
    return data.profiles || [];
  }

  async getProfileVerificationChallenge(address) {
    return this.request("/api/profiles/verify/challenge", {
      method: "POST",
      body: JSON.stringify({ address }),
    });
  }

  async submitProfileVerification(address, publicKey, signature, message) {
    return this.request("/api/profiles/verify/submit", {
      method: "POST",
      body: JSON.stringify({
        address,
        public_key: publicKey,
        signature,
        message,
      }),
    });
  }

  async reportContent(report) {
    return this.request("/api/reports", {
      method: "POST",
      body: JSON.stringify(report),
    });
  }

  /**
   * Subscribes to newly mined blocks by polling the chain every 30 seconds.
   *
   * @param {Function} callback - Function called with each new block when chain height increases.
   * @returns {Function} Unsubscribe function that stops polling.
   */
  subscribeToBlocks(callback) {
    if (typeof callback !== "function") {
      throw new Error("subscribeToBlocks requires a callback function.");
    }

    let lastHeight = null;
    let stopped = false;

    const checkForBlock = async () => {
      if (stopped) return;
      const data = await this.getChain();
      const chain = data.chain || [];
      const currentHeight = chain.length;

      if (lastHeight !== null && currentHeight > lastHeight) {
        chain.slice(lastHeight).forEach((block) => callback(block));
      }

      lastHeight = currentHeight;
    };

    checkForBlock().catch(() => {});
    const intervalId = setInterval(() => {
      checkForBlock().catch(() => {});
    }, this.pollIntervalMs);

    return () => {
      stopped = true;
      clearInterval(intervalId);
    };
  }

  /**
   * Creates a vorliq://pay URL that can be encoded as a QR code.
   *
   * @param {string} toAddress - Wallet address that should receive the payment.
   * @param {number|string} [amount] - Optional VLQ payment amount.
   * @returns {string} A vorliq://pay URL string.
   */
  createPaymentURL(toAddress, amount) {
    const params = new URLSearchParams({ to: toAddress });
    if (amount !== undefined && amount !== null && amount !== "") {
      params.set("amount", String(amount));
    }
    return `vorliq://pay?${params.toString()}`;
  }

  /**
   * Parses a vorliq://pay URL into payment fields.
   *
   * @param {string} paymentUrl - Vorliq payment URL to parse.
   * @returns {{to: string, amount?: number}} Parsed payment destination and optional amount.
   */
  parsePaymentURL(paymentUrl) {
    let parsed;
    try {
      parsed = new URL(paymentUrl);
    } catch (error) {
      throw new Error("Payment URL must be a valid vorliq://pay URL.");
    }

    if (parsed.protocol !== "vorliq:" || parsed.hostname !== "pay") {
      throw new Error("Payment URL must start with vorliq://pay.");
    }

    const to = parsed.searchParams.get("to");
    if (!to) {
      throw new Error("Payment URL is missing a recipient address.");
    }

    const amount = parsed.searchParams.get("amount");
    if (amount === null) {
      return { to };
    }

    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount)) {
      throw new Error("Payment URL amount must be a valid number.");
    }

    return { to, amount: parsedAmount };
  }

  /**
   * Optionally sends a caller-provided privacy-preserving analytics event.
   * The SDK never auto-tracks developers or users.
   *
   * @param {object} event Safe analytics event payload.
   * @returns {Promise<object>} Analytics write response.
   */
  async sendAnalyticsEvent(event) {
    return this.request("/api/analytics/event", {
      method: "POST",
      body: JSON.stringify(event || {}),
    });
  }

  /**
   * Gets public aggregate analytics summary data.
   *
   * @returns {Promise<object>} Public aggregate analytics summary.
   */
  async getAnalyticsSummary() {
    return this.request("/api/analytics/summary");
  }

  /**
   * Gets the public audit manifest with export hashes.
   *
   * @returns {Promise<object>} Public audit manifest.
   */
  async getAuditManifest() {
    return this.request("/api/audit/manifest");
  }

  async getAuditChain() {
    return this.request("/api/audit/chain");
  }

  async getAuditTreasury() {
    return this.request("/api/audit/treasury");
  }

  async getAuditGovernance() {
    return this.request("/api/audit/governance");
  }

  async getAuditLending() {
    return this.request("/api/audit/lending");
  }

  async getAuditExchange() {
    return this.request("/api/audit/exchange");
  }

  async getAuditRegistry() {
    return this.request("/api/audit/registry");
  }

  /**
   * Verifies manifest SHA-256 hashes against the listed public audit exports.
   *
   * @returns {Promise<{success: boolean, verified: boolean, results: Array<object>}>} Verification result.
   */
  async verifyAuditManifest() {
    const manifest = await this.getAuditManifest();
    const results = [];

    for (const entry of manifest.exports || []) {
      const exportPayload = await this.request(entry.endpoint);
      const actualHash = sha256Hex(canonicalStringify(exportPayload));
      results.push({
        name: entry.name,
        endpoint: entry.endpoint,
        expected_sha256: entry.sha256,
        actual_sha256: actualHash,
        matches: actualHash === entry.sha256,
      });
    }

    return {
      success: true,
      verified: results.length > 0 && results.every((result) => result.matches),
      manifest,
      results,
    };
  }
}

module.exports = VorliqSDK;
module.exports.VorliqSDK = VorliqSDK;
module.exports.canonicalStringify = canonicalStringify;
module.exports.createTransactionReview = createTransactionReview;
module.exports.isReservedAddress = isReservedAddress;
module.exports.validateAddress = validateAddress;
