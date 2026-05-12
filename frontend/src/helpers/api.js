import axios from "axios";

const api = axios.create({
  baseURL: "http://localhost:5000/api",
  timeout: 120000,
});

export default api;
