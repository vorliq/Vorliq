const express = require("express");
const axios = require("axios");
const { handleRouteError } = require("./routeError");
const { paginationParams } = require("../pagination");

const router = express.Router();
const flaskUrl = process.env.FLASK_URL || "http://localhost:5001";

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
    if (error.status) {
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
    if (error.status) {
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
    if (error.status) {
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

router.post("/api/forum/feature", async (req, res) => {
  try {
    const response = await axios.post(`${flaskUrl}/forum/feature`, req.body);
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "POST /api/forum/feature", "Unable to record feature vote.");
  }
});

router.post("/api/forum/tip/post", async (req, res) => {
  try {
    const response = await axios.post(`${flaskUrl}/forum/tip/post`, req.body);
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "POST /api/forum/tip/post", "Unable to tip forum post.");
  }
});

router.post("/api/forum/tip/reply", async (req, res) => {
  try {
    const response = await axios.post(`${flaskUrl}/forum/tip/reply`, req.body);
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "POST /api/forum/tip/reply", "Unable to tip forum reply.");
  }
});

module.exports = router;
