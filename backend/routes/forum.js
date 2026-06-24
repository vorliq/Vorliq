const express = require("express");
const axios = require("axios");
const { handleRouteError } = require("./routeError");
const { paginationParams } = require("../pagination");
const { sendError } = require("../utils/apiResponse");

const router = express.Router();
const flaskUrl = process.env.FLASK_URL || "http://localhost:5001";

// Minimum VLQ a wallet must hold to cast a feature vote. Set above the free
// faucet starter (1 VLQ) so feature votes — which amplify a post into the
// default Featured view at a count of 5 — cannot be multiplied with throwaway
// wallets. Tunable: higher raises Sybil cost but excludes smaller holders from
// the curation power. (The core's count-based flip is immutable, so this
// per-voter floor is the Node-layer analog of governance/lending VLQ weighting.)
const FEATURE_VOTE_MIN_VLQ = 10;

router.post("/api/forum/post", async (req, res) => {
  try {
    const response = await axios.post(`${flaskUrl}/forum/post`, req.body);
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "POST /api/forum/post", "Unable to create forum post.");
  }
});

router.get("/api/forum/posts", async (req, res) => {
  try {
    const response = await axios.get(`${flaskUrl}/forum/posts`, { params: paginationParams(req) });
    res.status(response.status).json(response.data);
  } catch (error) {
    if (error.status && !error.response) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    return handleRouteError(res, error, "GET /api/forum/posts", "Unable to load forum posts.");
  }
});

router.get("/api/forum/featured", async (req, res) => {
  try {
    const response = await axios.get(`${flaskUrl}/forum/featured`, { params: paginationParams(req) });
    res.status(response.status).json(response.data);
  } catch (error) {
    if (error.status && !error.response) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    return handleRouteError(res, error, "GET /api/forum/featured", "Unable to load featured forum posts.");
  }
});

router.get("/api/forum/post", async (req, res) => {
  try {
    const response = await axios.get(`${flaskUrl}/forum/post`, {
      params: { post_id: req.query.post_id },
    });
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "GET /api/forum/post", "Unable to load forum post.");
  }
});

router.get("/api/forum/search", async (req, res) => {
  try {
    const response = await axios.get(`${flaskUrl}/forum/search`, {
      params: { q: req.query.q, ...paginationParams(req) },
    });
    res.status(response.status).json(response.data);
  } catch (error) {
    if (error.status && !error.response) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    return handleRouteError(res, error, "GET /api/forum/search", "Unable to search forum posts.");
  }
});

router.post("/api/forum/reply", async (req, res) => {
  try {
    const response = await axios.post(`${flaskUrl}/forum/reply`, req.body);
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "POST /api/forum/reply", "Unable to add forum reply.");
  }
});

router.post("/api/forum/upvote", async (req, res) => {
  try {
    const response = await axios.post(`${flaskUrl}/forum/upvote`, req.body);
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "POST /api/forum/upvote", "Unable to upvote forum post.");
  }
});

router.post("/api/forum/reply/upvote", async (req, res) => {
  try {
    const response = await axios.post(`${flaskUrl}/forum/reply/upvote`, req.body);
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "POST /api/forum/reply/upvote", "Unable to upvote forum reply.");
  }
});

router.post("/api/forum/feature", async (req, res) => {
  try {
    // The voter is already proven to control this address by the signed-authority
    // middleware (req.signedAuthorization.wallet === voter_address). Enforce the
    // VLQ floor so featuring cannot be Sybil-amplified with free wallets.
    const voter = req.signedAuthorization?.wallet || String(req.body?.voter_address || req.body?.voterAddress || "").trim();
    let balance = 0;
    try {
      const balanceResponse = await axios.get(`${flaskUrl}/balance`, { params: { address: voter } });
      balance = Number(balanceResponse.data?.balance) || 0;
    } catch (balanceError) {
      balance = 0;
    }
    if (balance < FEATURE_VOTE_MIN_VLQ) {
      return sendError(
        res,
        403,
        "FEATURE_VOTE_INSUFFICIENT_VLQ",
        `Featuring a post requires holding at least ${FEATURE_VOTE_MIN_VLQ} VLQ, so feature votes can't be multiplied with throwaway wallets.`
      );
    }
    const response = await axios.post(`${flaskUrl}/forum/feature`, req.body);
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "POST /api/forum/feature", "Unable to record feature vote.");
  }
});

function retiredForumTipEndpoint(req, res) {
  return sendError(
    res,
    410,
    "FORUM_TIPPING_RETIRED",
    "Forum tipping by private key has been retired. Use saved-wallet local signing flows only."
  );
}

router.post("/api/forum/tip/post", retiredForumTipEndpoint);
router.post("/api/forum/tip/reply", retiredForumTipEndpoint);

module.exports = router;
