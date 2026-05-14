const express = require("express");
const cors = require("cors");
require("dotenv").config();

const chainRoutes = require("./routes/chain");
const walletRoutes = require("./routes/wallet");
const transactionRoutes = require("./routes/transaction");
const miningRoutes = require("./routes/mining");
const networkRoutes = require("./routes/network");
const lendingRoutes = require("./routes/lending");
const registryRoutes = require("./routes/registry");
const exchangeRoutes = require("./routes/exchange");
const { logError, logInfo } = require("./logger");

const app = express();
const port = process.env.PORT || 5000;

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
  app.listen(port, () => {
    console.log(`Vorliq backend API running on port ${port}`);
    logInfo(`Vorliq backend API running on port ${port}`);
  });
}

module.exports = app;
