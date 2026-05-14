const express = require("express");
const axios = require("axios");
const { handleRouteError } = require("./routeError");

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
    const response = await axios.get(`${flaskUrl}/forum/posts`);
    res.status(response.status).json(response.data);
  } catch (error) {
    return handleRouteError(res, error, "GET /api/forum/posts", "Unable to load forum posts.");
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

module.exports = router;
