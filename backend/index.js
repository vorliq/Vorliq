const express = require("express");
const cors = require("cors");
const axios = require("axios");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 4000;
const blockchainUrl = process.env.BLOCKCHAIN_URL || "http://127.0.0.1:5000";

app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    app: "Vorliq",
    coin: "VLQ",
    blockchainUrl,
  });
});

app.get("/chain", async (req, res, next) => {
  try {
    const response = await axios.get(`${blockchainUrl}/chain`);
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

app.post("/transactions", async (req, res, next) => {
  try {
    const response = await axios.post(`${blockchainUrl}/transactions`, req.body);
    res.status(response.status).json(response.data);
  } catch (error) {
    next(error);
  }
});

app.post("/mine", async (req, res, next) => {
  try {
    const response = await axios.post(`${blockchainUrl}/mine`);
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, next) => {
  const status = error.response?.status || 500;
  const message = error.response?.data || { error: error.message };
  res.status(status).json(message);
});

app.listen(port, () => {
  console.log(`Vorliq backend API listening on port ${port}`);
});
