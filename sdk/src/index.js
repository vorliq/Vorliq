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
