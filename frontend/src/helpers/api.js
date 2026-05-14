import axios from "axios";

const defaultApiUrl =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:5000/api"
    : "/api";

const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL || defaultApiUrl,
  timeout: 120000,
});

export default api;
