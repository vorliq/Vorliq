import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import Forum from "./Forum";
import { useAuth } from "../context/AuthContext";
import { NotificationProvider } from "../context/NotificationContext";
import api from "../helpers/api";

jest.mock("../helpers/api", () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
jest.mock("react-toastify", () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock("../context/AuthContext", () => ({ useAuth: jest.fn(), AuthProvider: ({ children }) => children }));

function mockForum() {
  api.get.mockImplementation((path) => {
    if (path === "/forum/posts") return Promise.resolve({ data: { posts: [], has_more: false, total: 0 } });
    if (path === "/forum/featured") return Promise.resolve({ data: { posts: [] } });
    return Promise.resolve({ data: {} });
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <NotificationProvider>
        <Forum />
      </NotificationProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  jest.clearAllMocks();
  useAuth.mockReturnValue({ wallet: null, isLoggedIn: false });
  mockForum();
});

test("renders the forum for a signed-out visitor", async () => {
  renderPage();
  expect(await screen.findByRole("heading", { name: /^forum$/i })).toBeInTheDocument();
  expect(api.get).toHaveBeenCalledWith("/forum/posts", expect.anything());
});

test("renders the create-post experience for a signed-in member", async () => {
  useAuth.mockReturnValue({ wallet: { address: "VLQ_ME_ADDRESS" }, isLoggedIn: true });
  mockForum();
  renderPage();
  expect(await screen.findByRole("heading", { name: /^forum$/i })).toBeInTheDocument();
});

test("surfaces an error when posts fail to load", async () => {
  api.get.mockRejectedValue({});
  renderPage();
  expect(await screen.findByText(/unable to load forum posts/i)).toBeInTheDocument();
});
