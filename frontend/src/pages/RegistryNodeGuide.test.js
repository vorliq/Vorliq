import { render, screen } from "@testing-library/react";

import Registry from "./Registry";
import api from "../helpers/api";

jest.mock("../helpers/api", () => ({
  get: jest.fn(),
  post: jest.fn(),
}));

jest.mock("react-toastify", () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  api.get.mockImplementation((path) => {
    if (path === "/registry/nodes") {
      return Promise.resolve({ data: { success: true, nodes: [] } });
    }
    if (path === "/registry/all") {
      return Promise.resolve({ data: { success: true, nodes: [] } });
    }
    if (path === "/registry/summary") {
      return Promise.resolve({ data: { success: true, summary: { active_node_count: 0, synced_node_count: 0, highest_chain_height: 0, average_reliability_score: 0 } } });
    }
    return Promise.resolve({ data: { success: true } });
  });
});

test("Registry page shows Run Your Own Node section", async () => {
  render(<Registry />);

  expect(await screen.findByRole("heading", { name: /run your own node/i })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /node guide/i })).toHaveAttribute("href", "/docs/run-your-own-node.html");
  expect(screen.getByText(/verify first/i)).toBeInTheDocument();
  expect(screen.getAllByText(/install/i).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/register/i).length).toBeGreaterThan(0);
  expect(screen.getByText(/check health/i)).toBeInTheDocument();
  expect(screen.getByText(/backups/i)).toBeInTheDocument();
});
