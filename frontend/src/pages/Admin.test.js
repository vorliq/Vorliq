import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import Admin from "./Admin";
import api from "../helpers/api";

jest.mock("../helpers/api", () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
jest.mock("react-toastify", () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));

const OVERVIEW = {
  success: true,
  server_uptime_seconds: 3600,
  blockchain: { block_height: 8046, chain_valid: true },
  treasury: { balance: 1200 },
  services: [],
  deployment: { commit: "abc1234" },
  backups: { latest: null },
  incidents: [],
};

function renderPage() {
  return render(
    <MemoryRouter>
      <Admin />
    </MemoryRouter>
  );
}

beforeEach(() => {
  window.sessionStorage.clear();
  jest.clearAllMocks();
});

test("shows the token gate when no admin token is present", () => {
  renderPage();
  expect(screen.getByRole("heading", { level: 1, name: /admin access/i })).toBeInTheDocument();
  expect(api.get).not.toHaveBeenCalled();
});

test("loads the overview once an admin token is present", async () => {
  window.sessionStorage.setItem("vorliq_admin_token", "test-admin-token");
  api.get.mockResolvedValue({ data: OVERVIEW });

  renderPage();

  await waitFor(() => expect(api.get).toHaveBeenCalledWith("/admin/overview", expect.anything()));
  // Past the gate: the admin tab bar renders.
  expect(await screen.findByRole("button", { name: /^overview$/i })).toBeInTheDocument();
});

test("each operator tab loads its section without crashing", async () => {
  window.sessionStorage.setItem("vorliq_admin_token", "test-admin-token");
  // Generic-but-shaped response so every tab component finds arrays/objects where
  // it expects them and renders its loaded/empty branch rather than crashing.
  const generic = {
    success: true,
    ...OVERVIEW,
    wallets: [], nodes: [], loans: [], entries: [], events: [], alerts: [], reports: [],
    items: [], history: [], claims: [], profiles: [], posts: [], messages: [], bans: [],
    backups: [], incidents: [], migrations: [], flagged: [],
    readiness: { overall_status: "pass", checks: [] },
    summary: {}, usage: {}, analytics: {}, security: {}, storage: {}, indexes: {}, migration: {}, monitor: {},
  };
  api.get.mockResolvedValue({ data: generic });

  renderPage();
  await screen.findByRole("button", { name: /^overview$/i });

  const tabs = ["Usage", "Alerts", "Readiness", "Security", "Storage", "Indexes", "Migration", "Analytics", "Network Monitor", "Backups"];
  for (const tab of tabs) {
    // eslint-disable-next-line no-await-in-loop
    await userEvent.click(screen.getByRole("button", { name: new RegExp(`^${tab}$`, "i") }));
  }
  // The dashboard is still mounted after visiting every tab.
  expect(screen.getByRole("heading", { name: /vorliq operator dashboard/i })).toBeInTheDocument();
});
