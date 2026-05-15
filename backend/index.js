const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
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
const priceRoutes = require("./routes/price");
const achievementsRoutes = require("./routes/achievements");
const deploymentRoutes = require("./routes/deployment");
const { logError, logInfo } = require("./logger");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  path: "/api/socket.io",
});
const port = process.env.PORT || 5000;
const socketAddresses = new Map();
const chatHistory = [];

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
    const senderAddress = String(message?.sender_address || message?.senderAddress || "").trim();
    const text = String(message?.text || "").trim();
    const timestamp = Number(message?.timestamp) || Date.now();

    if (!text || text.length > 500) {
      socket.emit("chat_error", { message: "Message must be between 1 and 500 characters." });
      return;
    }

    const chatMessage = {
      sender_address: senderAddress || socketAddresses.get(socket.id) || "Unknown",
      text,
      timestamp,
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
    logInfo(`Chat socket disconnected: ${socket.id}`);
    emitUserCount();
  });
});

app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  logInfo(`${req.method} ${req.path}`);
  next();
});

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Vorliq backend is running",
  });
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
app.use(priceRoutes);
app.use(achievementsRoutes);
app.use(deploymentRoutes);

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Route not found",
  });
});

app.use((error, req, res, next) => {
  logError(`${req.method} ${req.path} failed: ${error.message}`);
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
  server.listen(port, () => {
    console.log(`Vorliq backend API running on port ${port}`);
    logInfo(`Vorliq backend API running on port ${port}`);
  });
}

module.exports = app;
