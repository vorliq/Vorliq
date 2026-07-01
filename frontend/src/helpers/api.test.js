import api, { getDefaultNodeUrl, getNodeUrl, setNodeUrl } from "./api";

const NODE_URL_STORAGE_KEY = "vorliq_node_url";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  // setNodeUrl mutates the shared axios instance; reset to the build default so
  // one test never leaks a base URL into another.
  setNodeUrl("");
});

test("getDefaultNodeUrl returns the build default and getNodeUrl the active base", () => {
  const def = getDefaultNodeUrl();
  expect(def).toBeTruthy();
  expect(getNodeUrl()).toBe(def);
});

test("setNodeUrl accepts a valid http(s) override, persists it, and applies it", () => {
  const url = "https://node.example.org/api";
  expect(setNodeUrl(url)).toBe(url);
  expect(getNodeUrl()).toBe(url);
  expect(api.defaults.baseURL).toBe(url);
  expect(window.localStorage.getItem(NODE_URL_STORAGE_KEY)).toBe(url);
});

test("setNodeUrl rejects a non-http(s) URL and does not persist it", () => {
  expect(() => setNodeUrl("ftp://node.example.org")).toThrow(/valid http/i);
  expect(window.localStorage.getItem(NODE_URL_STORAGE_KEY)).toBeNull();
});

test("setNodeUrl with an empty or whitespace value resets to the build default", () => {
  setNodeUrl("https://node.example.org/api");
  expect(setNodeUrl("   ")).toBe(getDefaultNodeUrl());
  expect(window.localStorage.getItem(NODE_URL_STORAGE_KEY)).toBeNull();
  expect(api.defaults.baseURL).toBe(getDefaultNodeUrl());
});
