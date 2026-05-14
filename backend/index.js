const express = require("express");
const cors = require("cors");
require("dotenv").config();

const chainRoutes = require("./routes/chain");
const walletRoutes = require("./routes/wallet");
const transactionRoutes = require("./routes/transaction");
const miningRoutes = require("./routes/mining");
const networkRoutes = require("./routes/network");
const lendingRoutes = require("./routes/lending");

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

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

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Route not found",
  });
});

app.use((error, req, res, next) => {
  const status = error.response?.status || 500;
  const payload = error.response?.data || { error: error.message };
  res.status(status).json({
    success: false,
    ...payload,
  });
});

app.listen(port, () => {
  console.log(`Vorliq backend API running on port ${port}`);
});
