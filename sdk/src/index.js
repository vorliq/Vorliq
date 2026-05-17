const { signTransaction } = require("./signer");

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

function paginationQuery(limit, offset) {
  const params = new URLSearchParams();
  if (limit !== undefined) params.set("limit", String(limit));
  if (offset !== undefined) params.set("offset", String(offset));
  const query = params.toString();
  return query ? `?${query}` : "";
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
    this.pollIntervalMs = 30000;
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
    const headers = {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    };
    const response = await fetchImpl(`${this.nodeUrl}${path}`, { ...options, headers });
    const data = await response.json();

    if (!response.ok || data.success === false) {
      const error = new Error(data.error || data.message || `Vorliq request failed with status ${response.status}.`);
      error.status = response.status;
      error.data = data;
      throw error;
    }

    return data;
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
   *
   * @param {string} fromAddress - Sender wallet address.
   * @param {string} fromPrivateKey - Sender private key in PEM format.
   * @param {string} fromPublicKey - Sender public key in PEM format.
   * @param {string} toAddress - Receiver wallet address.
   * @param {number|string} amount - Amount of VLQ to send.
   * @returns {Promise<object>} API result returned by POST /api/transaction/send.
   */
  async sendTransaction(fromAddress, fromPrivateKey, fromPublicKey, toAddress, amount) {
    const signedTransaction = signTransaction({
      senderAddress: fromAddress,
      senderPrivateKey: fromPrivateKey,
      senderPublicKey: fromPublicKey,
      receiverAddress: toAddress,
      amount,
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
  async getLoans() {
    const data = await this.request("/api/lending/loans");
    return data.loans || [];
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
}

module.exports = VorliqSDK;
module.exports.VorliqSDK = VorliqSDK;
