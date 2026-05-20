const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cron = require("node-cron");
require("dotenv").config();

const chainRoutes = require("./routes/chain");
const walletRoutes = require("./routes/wallet");
const transactionRoutes = require("./routes/transaction");
const miningRoutes = require("./routes/mining");
const networkRoutes = require("./routes/network");
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
const adminRoutes = require("./routes/admin");
const systemRoutes = require("./routes/system");
const analyticsRoutes = require("./routes/analytics");
const storageRoutes = require("./routes/storage");
const auditRoutes = require("./routes/audit");
const adminAuth = require("./middleware/adminAuth");
const { pruneAnalytics } = require("./analytics");
const { logError, logInfo } = require("./logger");
const { sendWeeklyReport } = require("./reports");
const { corsMiddleware, helmetMiddleware, isAllowedOrigin, securityStatus } = require("./middleware/security");
const { validateBody } = require("./middleware/validation");
const {
  apiSlowDown,
  chatLimiter,
  faucetLimiter,
  generalLimiter,
  miningLimiter,
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
const socketAddresses = new Map();
const socketMessageTimes = new Map();
const chatHistory = [];
let chatMessageSequence = 0;

function safeChatText(value) {
  return String(value || "").replace(/\0/g, "").replace(/[<>]/g, "").trim();
}

function chatWarning(text) {
  return /(airdrop|double your|seed phrase|private key|guaranteed profit|urgent wallet|free vlq)/i.test(text || "");
}

function emitUserCount() {
  io.emit("user_count", io.sockets.sockets.size);
}

io.on("connection", (socket) => {
  logInfo(`Chat socket connected: ${socket.id}`);
  socket.emit("welcome", { message: "welcome to Vorliq community chat" });
  socket.emit("history", chatHistory);
  emitUserCount();

  socket.on("join", (walletAddress) => {
    if (typeof walletAddress === "string" && walletAddress.trim()) {
      socketAddresses.set(socket.id, walletAddress.trim());
      logInfo(`Chat socket ${socket.id} joined as ${walletAddress.trim()}`);
      emitUserCount();
    }
  });

  socket.on("message", (message) => {
    const senderAddress = safeChatText(message?.sender_address || message?.senderAddress).slice(0, 160);
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
      sender_address: senderAddress || socketAddresses.get(socket.id) || "Unknown",
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
  });

  socket.on("history", () => {
    socket.emit("history", chatHistory);
  });

  socket.on("disconnect", () => {
    socketAddresses.delete(socket.id);
    socketMessageTimes.delete(socket.id);
    logInfo(`Chat socket disconnected: ${socket.id}`);
    emitUserCount();
  });
});

app.use(helmetMiddleware());
app.use(corsMiddleware());
app.use("/api/forum", express.json({ limit: "2.5mb" }));
app.use(express.json({ limit: "100kb" }));
app.use((req, res, next) => {
  logInfo(`${req.method} ${req.path}`);
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    if (duration > 1000) {
      logInfo(`Slow route ${req.method} ${req.path} completed in ${duration}ms with status ${res.statusCode}`);
    }
  });
  next();
});
app.use("/api/analytics/event", analyticsLimiter);
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
app.use(["/api/governance/propose", "/api/treasury/propose"], proposalLimiter);
app.use("/api/faucet/claim", faucetLimiter);
app.use(["/api/registry/register", "/api/registry/heartbeat", "/api/peers/add", "/api/peers/announce"], registryLimiter);
app.use(["/api/reports", "/api/reports/weekly"], reportLimiter);
app.use(validateBody);

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Vorliq backend is running",
  });
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
  if (!message) return res.status(404).json({ success: false, message: "Chat message was not found." });
  message.moderation_status = "hidden";
  message.text = "This chat message is hidden by community moderation review.";
  message.warning = "";
  io.emit("history", chatHistory);
  return res.json({ success: true, message });
});

app.use(chainRoutes);
app.use(walletRoutes);
app.use(transactionRoutes);
app.use(miningRoutes);
app.use(networkRoutes);
app.use(lendingRoutes);
app.use(registryRoutes);
app.use(exchangeRoutes);
app.use(forumRoutes);
app.use(governanceRoutes);
app.use(treasuryRoutes);
app.use(faucetRoutes);
app.use(priceRoutes);
app.use(profilesRoutes);
app.use(achievementsRoutes);
app.use(backupRoutes);
app.use(deploymentRoutes);
app.use(incidentsRoutes);
app.use(reportsRoutes);
app.use(manifestRoutes);
app.use(systemRoutes);
app.use(storageRoutes);
app.use(auditRoutes);
app.use(adminRoutes);

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Route not found",
  });
});

app.use((error, req, res, next) => {
  logError(`${req.method} ${req.path} failed: ${error.message}`);
  if (error.type === "entity.too.large") {
    return res.status(413).json({
      success: false,
      message: "Request body is too large.",
    });
  }
  if (error instanceof SyntaxError && "body" in error) {
    return res.status(400).json({
      success: false,
      message: "Request body must be valid JSON.",
    });
  }
  const status = error.response?.status || 500;
  const message =
    error.code === "ECONNREFUSED" || error.code === "ECONNABORTED" || !error.response
      ? "Blockchain service is currently unavailable. Please make sure the Vorliq blockchain API is running."
      : error.response?.data?.message || error.response?.data?.error || "The backend could not complete this request.";
  res.status(status).json({
    success: false,
    message,
  });
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

  server.listen(port, () => {
    console.log(`Vorliq backend API running on port ${port}`);
    logInfo(`Vorliq backend API running on port ${port}`);
  });
}

module.exports = app;
