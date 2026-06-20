const express = require("express");
const http = require("http");
const axios = require("axios");
const { Server } = require("socket.io");
const cron = require("node-cron");
require("dotenv").config();

const FLASK_URL = process.env.FLASK_URL || "http://localhost:5001";

const chainRoutes = require("./routes/chain");
const walletRoutes = require("./routes/wallet");
const transactionRoutes = require("./routes/transaction");
const miningRoutes = require("./routes/mining");
const networkRoutes = require("./routes/network");
const nodeRoutes = require("./routes/node");
const lendingRoutes = require("./routes/lending");
const registryRoutes = require("./routes/registry");
const exchangeRoutes = require("./routes/exchange");
const forumRoutes = require("./routes/forum");
const governanceRoutes = require("./routes/governance");
const treasuryRoutes = require("./routes/treasury");
const { router: faucetRoutes } = require("./routes/faucet");
const priceRoutes = require("./routes/price");
const profilesRoutes = require("./routes/profiles");
const achievementsRoutes = require("./routes/achievements");
const backupRoutes = require("./routes/backup");
const deploymentRoutes = require("./routes/deployment");
const incidentsRoutes = require("./routes/incidents");
const reportsRoutes = require("./routes/reports");
const manifestRoutes = require("./routes/manifest");
const snapshotRoutes = require("./routes/snapshot");
const versionRoutes = require("./routes/version");
const readinessRoutes = require("./routes/readiness");
const adminRoutes = require("./routes/admin");
const systemRoutes = require("./routes/system");
const analyticsRoutes = require("./routes/analytics");
const storageRoutes = require("./routes/storage");
const auditRoutes = require("./routes/audit");
const bootstrapRoutes = require("./routes/bootstrap");
const migrationRoutes = require("./routes/migration");
const newsletterRoutes = require("./routes/newsletter");
const walletHistoryRoutes = require("./routes/walletHistory");
const avatarRoutes = require("./routes/avatar");
const adminAuth = require("./middleware/adminAuth");
const { sendError } = require("./utils/apiResponse");
const { pruneAnalytics } = require("./analytics");
const chatStore = require("./chatStore");
const { logError, logInfo } = require("./logger");
const { sendWeeklyReport } = require("./reports");
const { corsMiddleware, helmetMiddleware, isAllowedOrigin, securityStatus } = require("./middleware/security");
const { apiV1Alias, requestMetadata } = require("./middleware/requestMetadata");
const { validateBody } = require("./middleware/validation");
const crypto = require("crypto");
const {
  requireSignedAuthorityWrite,
  addressFromPublicKey,
  authorizationMessage,
  bodyHash,
} = require("./middleware/signedAuthorization");
const {
  apiSlowDown,
  chatLimiter,
  faucetLimiter,
  generalLimiter,
  miningLimiter,
  newsletterLimiter,
  proposalLimiter,
  registryLimiter,
  reportLimiter,
  transactionLimiter,
  walletLimiter,
  writeLimiter,
  analyticsLimiter,
} = require("./middleware/rateLimits");

const app = express();
app.set("trust proxy", 1);
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin(origin, callback) {
      callback(null, isAllowedOrigin(origin));
    },
    methods: ["GET", "POST"],
  },
  path: "/api/socket.io",
});
const port = process.env.PORT || 5000;
const host = process.env.HOST || "127.0.0.1";
const socketAddresses = new Map();
const socketMessageTimes = new Map();
// Per-connection single-use challenge nonces for the signed chat-join handshake.
// A socket only appears in socketAddresses AFTER it proves control of the wallet
// it claims, so presence in socketAddresses == a verified identity.
const socketJoinNonces = new Map();
const chatHistory = [];
let chatMessageSequence = 0;

// Hydrate the in-memory recent buffer from durable storage so chat history
// survives restarts. Best-effort: a storage problem must never block startup.
try {
  chatStore.loadRecentMessages(100).forEach((message) => chatHistory.push(message));
  logInfo(`Chat history hydrated with ${chatHistory.length} stored messages.`);
} catch (error) {
  logError(`Chat history hydration failed: ${error.message}`);
}

function safeChatText(value) {
  return String(value || "").replace(/\0/g, "").replace(/[<>]/g, "").trim();
}

function chatWarning(text) {
  return /(airdrop|double your|seed phrase|private key|guaranteed profit|urgent wallet|free vlq)/i.test(text || "");
}

function emitUserCount() {
  io.emit("user_count", io.sockets.sockets.size);
}

// Signed chat-join handshake. Reuses the exact Vorliq signed-authority scheme
// (canonical message + secp256k1 verify + address-from-public-key) so that
// claiming a wallet address in chat requires proving control of it, closing the
// impersonation hole where anyone could previously type a known address. The
// nonce is server-issued per connection and single-use to prevent replay.
const CHAT_JOIN_ACTION = "chat.join";
const CHAT_JOIN_MAX_AGE_SECONDS = 300;
const CHAT_JOIN_FUTURE_SKEW_SECONDS = 30;
const CHAT_JOIN_EMPTY_BODY_HASH = bodyHash({});

function verifyChatJoin(payload, expectedNonce) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Join requires a signed wallet handshake.");
  }
  const wallet = String(payload.wallet || "").trim();
  const publicKey = String(payload.public_key || payload.publicKey || "");
  const signature = String(payload.signature || "").trim();
  const message = String(payload.message || "");
  const nonce = String(payload.nonce || "").trim();
  const timestamp = Number(payload.timestamp);

  if (!wallet || !publicKey || !signature || !message || !nonce) {
    throw new Error("Join request is missing required signed fields.");
  }
  if (!expectedNonce || nonce !== expectedNonce) {
    throw new Error("Join challenge is missing, expired, or already used. Reconnect and try again.");
  }
  if (!Number.isInteger(timestamp)) {
    throw new Error("Join timestamp is invalid.");
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (timestamp < nowSeconds - CHAT_JOIN_MAX_AGE_SECONDS || timestamp > nowSeconds + CHAT_JOIN_FUTURE_SKEW_SECONDS) {
    throw new Error("Join request has expired. Reconnect and try again.");
  }
  if (publicKey.length > 2000 || signature.length > 512 || message.length > 2000) {
    throw new Error("Join request exceeds safe field limits.");
  }
  if (!/^[a-fA-F0-9]+$/.test(signature)) {
    throw new Error("Join signature is malformed.");
  }
  const expectedMessage = authorizationMessage({
    action: CHAT_JOIN_ACTION,
    body_hash: CHAT_JOIN_EMPTY_BODY_HASH,
    nonce,
    timestamp,
    wallet,
  });
  if (message !== expectedMessage) {
    throw new Error("Join message is not canonical.");
  }
  if (addressFromPublicKey(publicKey) !== wallet) {
    throw new Error("Join wallet does not match the supplied public key.");
  }
  let signatureValid = false;
  try {
    signatureValid = crypto.verify(
      "sha256",
      Buffer.from(expectedMessage, "utf8"),
      publicKey,
      Buffer.from(signature, "hex")
    );
  } catch (_error) {
    signatureValid = false;
  }
  if (!signatureValid) {
    throw new Error("Join signature could not be verified for this wallet.");
  }
  return wallet;
}

io.on("connection", (socket) => {
  logInfo(`Chat socket connected: ${socket.id}`);
  socket.emit("welcome", { message: "welcome to Vorliq community chat" });
  socket.emit("history", chatHistory);
  // Issue a single-use challenge nonce this connection must sign to join.
  const joinNonce = `chat-${crypto.randomBytes(16).toString("hex")}`;
  socketJoinNonces.set(socket.id, joinNonce);
  socket.emit("join_challenge", { nonce: joinNonce, action: CHAT_JOIN_ACTION });
  emitUserCount();

  socket.on("join", (payload) => {
    try {
      const wallet = verifyChatJoin(payload, socketJoinNonces.get(socket.id));
      socketJoinNonces.delete(socket.id); // consume the challenge
      socketAddresses.set(socket.id, wallet); // verified identity for this socket
      logInfo(`Chat socket ${socket.id} verified-joined as ${wallet}`);
      socket.emit("join_ok", { wallet });
      emitUserCount();
    } catch (error) {
      logError(`Chat join rejected for socket ${socket.id}: ${error.message}`);
      socket.emit("chat_error", { message: error.message || "Could not verify your wallet for chat." });
    }
  });

  socket.on("message", (message) => {
    // The sender is the verified identity bound to this socket at join time;
    // any client-supplied sender_address is ignored entirely. A socket that has
    // not completed the signed join cannot send.
    const sender = socketAddresses.get(socket.id);
    if (!sender) {
      socket.emit("chat_error", { message: "Join chat with a verified wallet before sending messages." });
      return;
    }
    const text = safeChatText(message?.text);
    const timestamp = Number(message?.timestamp) || Date.now();
    const now = Date.now();
    const recentMessages = (socketMessageTimes.get(socket.id) || []).filter((sentAt) => now - sentAt < 60_000);

    if (recentMessages.length >= 12 || (recentMessages.length && now - recentMessages[recentMessages.length - 1] < 1200)) {
      logError(`Chat rate limit rejected socket ${socket.id}`);
      socket.emit("chat_error", { message: "Chat messages are rate limited. Please slow down." });
      socketMessageTimes.set(socket.id, recentMessages);
      return;
    }

    if (!text || text.length > 500) {
      logError(`Chat validation rejected socket ${socket.id}: invalid message length`);
      socket.emit("chat_error", { message: "Message must be between 1 and 500 characters." });
      return;
    }

    recentMessages.push(now);
    socketMessageTimes.set(socket.id, recentMessages);
    const chatMessage = {
      message_id: `chat_${now}_${chatMessageSequence += 1}`,
      sender_address: sender,
      text,
      timestamp,
      moderation_status: "visible",
      warning: chatWarning(text) ? "This message may mention scams, private keys, or unrealistic offers. Verify independently." : "",
    };
    chatHistory.push(chatMessage);
    if (chatHistory.length > 100) {
      chatHistory.shift();
    }
    io.emit("message", chatMessage);
    // Persist after broadcasting so durability never delays the live message.
    try {
      chatStore.appendChatMessage(chatMessage);
    } catch (error) {
      logError(`Chat message persistence failed: ${error.message}`);
    }
  });

  socket.on("history", () => {
    socket.emit("history", chatHistory);
  });

  socket.on("disconnect", () => {
    socketAddresses.delete(socket.id);
    socketMessageTimes.delete(socket.id);
    socketJoinNonces.delete(socket.id);
    logInfo(`Chat socket disconnected: ${socket.id}`);
    emitUserCount();
  });
});

app.use(helmetMiddleware());
app.use(corsMiddleware());
app.use(requestMetadata);
app.use(apiV1Alias);
app.use("/api/forum", express.json({ limit: "2.5mb" }));
// Avatar uploads carry a base64 image; allow a larger body here (the route still
// enforces a hard 2MB cap on the decoded image bytes).
app.use("/api/profiles/avatar", express.json({ limit: "3mb" }));
app.use(express.json({ limit: "100kb" }));
app.use((req, res, next) => {
  logInfo(`[${req.requestId}] ${req.method} ${req.originalUrl}`);
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    if (duration > 1000) {
      logInfo(`[${req.requestId}] Slow route ${req.method} ${req.originalUrl} completed in ${duration}ms with status ${res.statusCode}`);
    }
  });
  next();
});
app.use(["/api/analytics/event", "/api/analytics/events"], analyticsLimiter);
app.use(analyticsRoutes);
app.use("/api", generalLimiter, apiSlowDown);
app.use("/api/socket.io", chatLimiter);
app.use("/api/wallet/create", walletLimiter);
app.use("/api/mine", miningLimiter);
app.use("/api/transaction/send", transactionLimiter);
app.use(
  [
    "/api/forum/post",
    "/api/forum/reply",
    "/api/forum/upvote",
    "/api/forum/feature",
    "/api/reports",
    "/api/price/signal",
    "/api/governance/vote",
    "/api/governance/cancel",
    "/api/lending/request",
    "/api/lending/vote",
    "/api/lending/repay",
    "/api/exchange/offer",
    "/api/exchange/accept",
    "/api/exchange/cancel",
    "/api/exchange/record-vlq-tx",
    "/api/exchange/confirm-complete",
    "/api/exchange/dispute",
    "/api/profiles/profile",
  ],
  writeLimiter
);
// Avatar: rate-limit only the POST upload. The GET that serves avatar images is
// hit on every surface that shows a member and must not consume a write budget.
app.post("/api/profiles/avatar", writeLimiter);
app.use(["/api/governance/propose", "/api/treasury/propose"], proposalLimiter);
app.use("/api/faucet/claim", faucetLimiter);
app.use(["/api/registry/register", "/api/registry/heartbeat", "/api/peers/add", "/api/peers/announce"], registryLimiter);
app.use(["/api/reports", "/api/reports/weekly"], reportLimiter);
app.use("/api/newsletter/subscribe", newsletterLimiter);
app.use(validateBody);
app.use(requireSignedAuthorityWrite);

// Liveness probe: 200 as long as the Node process is up. Deliberately does NOT
// depend on Flask — a load balancer must not kill this node during a Flask
// outage, it must keep it alive so it can serve the degraded-state UI.
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Vorliq backend is running",
  });
});

// Dependency/readiness probe: reports whether the Node layer can reach the Flask
// blockchain service. Machine-readable for a load balancer or uptime monitor:
// 200 + status:"healthy" when Flask answers, 503 + status:"degraded" when it
// does not. The dependency check is bounded by a short timeout so the probe
// itself never hangs.
app.get("/api/health/ready", async (req, res) => {
  const startedAt = Date.now();
  try {
    const response = await axios.get(`${FLASK_URL}/health`, { timeout: 3000 });
    const upstreamOk = response.status === 200 && (response.data?.status === "ok" || response.data?.coin);
    return res.status(upstreamOk ? 200 : 503).json({
      success: upstreamOk,
      status: upstreamOk ? "healthy" : "degraded",
      node: "up",
      flask: upstreamOk ? "up" : "down",
      latency_ms: Date.now() - startedAt,
    });
  } catch (error) {
    logError(`Health readiness: Flask unreachable: ${error.message}`);
    return res.status(503).json({
      success: false,
      status: "degraded",
      node: "up",
      flask: "down",
      latency_ms: Date.now() - startedAt,
    });
  }
});

app.get("/api/security/status", (req, res) => {
  res.json(securityStatus());
});

app.get("/api/admin/moderation/chat", adminAuth, (req, res) => {
  res.json({
    success: true,
    messages: chatHistory.slice(-100),
    note: "Community chat is public. This view does not expose IP addresses or raw user agents.",
  });
});

app.post("/api/admin/moderation/chat/hide", adminAuth, (req, res) => {
  const messageId = safeChatText(req.body?.message_id || req.body?.messageId).slice(0, 120);
  const message = chatHistory.find((item) => item.message_id === messageId);
  if (!message) return sendError(res, 404, "NOT_FOUND", "Chat message was not found.");
  message.moderation_status = "hidden";
  message.text = "This chat message is hidden by community moderation review.";
  message.warning = "";
  io.emit("history", chatHistory);
  // Persist the moderation decision so hidden messages never resurface from history.
  try {
    chatStore.setModerationStatus(message.message_id, "hidden", message.text);
  } catch (error) {
    logError(`Chat moderation persistence failed: ${error.message}`);
  }
  return res.json({ success: true, message });
});

app.get("/api/chat/history", (req, res) => {
  try {
    const history = chatStore.loadHistory({ limit: req.query.limit, before: req.query.before });
    return res.json({ success: true, ...history });
  } catch (error) {
    logError(`GET /api/chat/history failed: ${error.message}`);
    return res.status(500).json({ success: false, message: "Unable to load chat history." });
  }
});

app.use(chainRoutes);
app.use(walletRoutes);
app.use(transactionRoutes);
app.use(miningRoutes);
app.use(networkRoutes);
app.use(nodeRoutes);
app.use(lendingRoutes);
app.use(registryRoutes);
app.use(exchangeRoutes);
app.use(forumRoutes);
app.use(governanceRoutes);
app.use(treasuryRoutes);
app.use(faucetRoutes);
app.use(priceRoutes);
app.use(avatarRoutes);
app.use(profilesRoutes);
app.use(achievementsRoutes);
app.use(backupRoutes);
app.use(deploymentRoutes);
app.use(incidentsRoutes);
app.use(reportsRoutes);
app.use(manifestRoutes);
app.use(snapshotRoutes);
app.use(versionRoutes);
app.use(readinessRoutes);
app.use(systemRoutes);
app.use(storageRoutes);
app.use(auditRoutes);
app.use(bootstrapRoutes);
app.use(migrationRoutes);
app.use(newsletterRoutes);
app.use(walletHistoryRoutes);
app.use(adminRoutes);

app.use((req, res) => {
  return sendError(res, 404, "NOT_FOUND", "Route not found");
});

app.use((error, req, res, next) => {
  logError(`[${req.requestId || "unknown"}] ${req.method} ${req.originalUrl} failed: ${error.message}`);
  if (error.type === "entity.too.large") {
    return sendError(res, 413, "PAYLOAD_TOO_LARGE", "Request body is too large.");
  }
  if (error instanceof SyntaxError && "body" in error) {
    return sendError(res, 400, "INVALID_JSON", "Request body must be valid JSON.");
  }
  const status = error.response?.status || 500;
  const message =
    error.code === "ECONNREFUSED" || error.code === "ECONNABORTED" || !error.response
      ? "Blockchain service is currently unavailable. Please make sure the Vorliq blockchain API is running."
      : error.response?.data?.message || error.response?.data?.error || "The backend could not complete this request.";
  return sendError(res, status, status >= 500 ? "UPSTREAM_ERROR" : "REQUEST_FAILED", message);
});

if (require.main === module) {
  pruneAnalytics();
  cron.schedule(
    "0 9 * * 1",
    () => {
      sendWeeklyReport().catch((error) => {
        logError(`Scheduled weekly report failed: ${error.message}`);
      });
    },
    { timezone: "Europe/London" }
  );
  logInfo("Weekly community report scheduled for Monday 09:00 Europe/London");

  server.listen(port, host, () => {
    console.log(`Vorliq backend API running on ${host}:${port}`);
    logInfo(`Vorliq backend API running on ${host}:${port}`);
  });
}

module.exports = app;
