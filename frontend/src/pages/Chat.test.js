import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { AuthContext } from "../context/AuthContext";
import Chat from "./Chat";

const mockSocketHandlers = {};

jest.mock("socket.io-client", () => ({
  io: () => ({
    on: (event, callback) => {
      mockSocketHandlers[event] = callback;
    },
    emit: jest.fn(),
    disconnect: jest.fn(),
    connected: false,
  }),
}));

jest.mock("react-toastify", () => ({
  toast: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), success: jest.fn() },
}));

beforeEach(() => {
  Object.keys(mockSocketHandlers).forEach((key) => delete mockSocketHandlers[key]);
  jest.clearAllMocks();
});

function renderChat(auth = { wallet: null, isLoggedIn: false }) {
  return render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter>
        <Chat />
      </MemoryRouter>
    </AuthContext.Provider>
  );
}

test("Chat renders a clean empty state with no messages and an honest public notice", () => {
  renderChat();

  expect(screen.getByRole("heading", { level: 1, name: /^chat$/i })).toBeInTheDocument();
  expect(screen.getByText(/no messages yet\. start the conversation\./i)).toBeInTheDocument();
  // Honest about the chat being public and kept only for a limited window.
  expect(screen.getByText(/public chat, kept for a limited time/i)).toBeInTheDocument();
  expect(screen.getByText(/kept for up to 30 days/i)).toBeInTheDocument();
  expect(screen.getByText(/never share private keys, seed phrases, passwords, or backup files/i)).toBeInTheDocument();
});

test("Chat reflects real socket history without fabricating any messages", () => {
  renderChat();

  // With no server history delivered, the empty state stays; nothing is invented.
  expect(typeof mockSocketHandlers.history).toBe("function");
  expect(screen.getByText(/no messages yet/i)).toBeInTheDocument();
});
