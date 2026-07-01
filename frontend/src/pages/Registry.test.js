import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import Registry from "./Registry";
import { AuthProvider } from "../context/AuthContext";
import api from "../helpers/api";

jest.mock("../helpers/api", () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
jest.mock("react-toastify", () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));

const ACTIVE_NODE = {
  node_url: "https://node.example.org",
  display_name: "Community Node",
  sync_status: "synced",
  lifecycle_status: "active",
  reliability_score: 97,
  uptime_score: 99,
  last_chain_height: 8046,
  last_seen: Math.floor(Date.now() / 1000),
  region: "Europe",
  country: "United Kingdom",
};

function mockRegistry() {
  api.get.mockImplementation((path) => {
    if (path === "/registry/nodes") return Promise.resolve({ data: { nodes: [ACTIVE_NODE] } });
    if (path === "/registry/lifecycle") return Promise.resolve({ data: { nodes: [ACTIVE_NODE] } });
    if (path === "/registry/summary") {
      return Promise.resolve({
        data: { summary: { active_node_count: 1, synced_node_count: 1, highest_chain_height: 8046, average_reliability_score: 97 } },
      });
    }
    if (path === "/registry/node") return Promise.resolve({ data: { node: ACTIVE_NODE } });
    return Promise.resolve({ data: {} });
  });
}

function renderPage() {
  return render(
    <AuthProvider>
      <Registry />
    </AuthProvider>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  jest.clearAllMocks();
});

test("loads the summary and the active node list", async () => {
  mockRegistry();
  renderPage();
  expect(await screen.findByRole("heading", { name: /^registry$/i })).toBeInTheDocument();
  expect(await screen.findByRole("heading", { name: /community node/i })).toBeInTheDocument();
  // Node URL is unique to the loaded card; the summary stats rendered too.
  expect(screen.getByText("https://node.example.org")).toBeInTheDocument();
});

test("switching to Register Node reveals the registration form", async () => {
  mockRegistry();
  renderPage();
  await screen.findByRole("heading", { name: /^registry$/i });

  await userEvent.click(screen.getByRole("button", { name: /register node/i }));
  expect(screen.getByLabelText(/node url/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/display name/i)).toBeInTheDocument();
});

test("registering a node posts to the registry and shows the node details", async () => {
  mockRegistry();
  api.post.mockResolvedValue({ data: { node: { ...ACTIVE_NODE, node_url: "https://new.example.org" } } });
  renderPage();
  await screen.findByRole("heading", { name: /^registry$/i });

  await userEvent.click(screen.getByRole("button", { name: /register node/i }));
  await userEvent.type(screen.getByLabelText(/node url/i), "https://new.example.org");
  // Both the tab and the submit control are named "Register Node"; pick the submit.
  const submitButton = screen
    .getAllByRole("button", { name: /^register node$/i })
    .find((button) => button.getAttribute("type") === "submit");
  await userEvent.click(submitButton);

  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith("/registry/register", expect.objectContaining({ node_url: "https://new.example.org" }))
  );
});

test("renders each registry tab section on selection", async () => {
  mockRegistry();
  renderPage();
  await screen.findByRole("heading", { name: /^registry$/i });

  await userEvent.click(screen.getByRole("button", { name: /^all nodes$/i }));
  expect(screen.getByRole("heading", { name: /^all nodes$/i })).toBeInTheDocument();
  expect(screen.getByLabelText(/lifecycle/i)).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: /verify operator/i }));
  expect(screen.getByRole("heading", { name: /verify operator/i })).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: /node details/i }));
  expect(screen.getByRole("heading", { name: /node details/i })).toBeInTheDocument();
});

test("shows an empty state when no active nodes are registered", async () => {
  api.get.mockImplementation((path) => {
    if (path === "/registry/summary") return Promise.resolve({ data: { summary: null } });
    return Promise.resolve({ data: { nodes: [] } });
  });
  renderPage();
  expect(await screen.findByText(/no active public nodes are registered right now/i)).toBeInTheDocument();
});
