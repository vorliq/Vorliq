import { render, screen } from "@testing-library/react";

import PeerPropagation from "./PeerPropagation";
import api from "../helpers/api";

jest.mock("../helpers/api", () => ({
  get: jest.fn(),
}));

jest.mock("react-toastify", () => ({
  toast: {
    error: jest.fn(),
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  api.get.mockImplementation((path) => {
    if (path === "/peers/propagation/status") {
      return Promise.resolve({
        data: {
          success: true,
          broadcast_enabled: false,
          receive_enabled: true,
          active_peer_count: 1,
          eligible_broadcast_peer_count: 0,
          accepted_transactions: 2,
          accepted_blocks: 1,
          duplicates: 3,
          rejected: 0,
          quarantined: 1,
          failed: 0,
          last_event_at: "2026-05-27T08:00:00Z",
          eligible_peers: [],
        },
      });
    }
    if (path === "/peers/propagation/events") {
      return Promise.resolve({
        data: {
          success: true,
          events: [
            {
              event_id: "event-1",
              timestamp: "2026-05-27T08:00:00Z",
              direction: "inbound",
              type: "block",
              peer_url: "https://peer.example.org",
              status: "quarantined",
              reason: "ahead_candidate",
              block_hash: "0000abc123456789",
            },
          ],
        },
      });
    }
    return Promise.resolve({ data: { success: true } });
  });
});

test("PeerPropagation page renders status metrics and events", async () => {
  render(<PeerPropagation />);

  expect(await screen.findByRole("heading", { name: /peer propagation/i })).toBeInTheDocument();
  expect(await screen.findByRole("heading", { name: /propagation status/i })).toBeInTheDocument();
  expect(screen.getByText(/accepted tx/i)).toBeInTheDocument();
  expect(screen.getByText(/recent peer events/i)).toBeInTheDocument();
  expect(screen.getByText(/ahead_candidate/i)).toBeInTheDocument();
  expect(screen.getByText(/event peer 1 endpoint hidden/i)).toBeInTheDocument();
  expect(screen.queryByText(/peer\.example\.org/i)).not.toBeInTheDocument();
  expect(screen.getByText(/what gets accepted/i)).toBeInTheDocument();
  expect(screen.getByText(/what gets quarantined/i)).toBeInTheDocument();
  expect(screen.getByText(/public views hide peer endpoints/i)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /node monitoring docs/i })).toHaveAttribute("href", "/docs/node-monitoring.html");
});
