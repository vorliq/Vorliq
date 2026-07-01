import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import Profile from "./Profile";
import { useAuth } from "../context/AuthContext";
import api from "../helpers/api";

jest.mock("../helpers/api", () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
jest.mock("react-toastify", () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock("../context/AuthContext", () => ({ useAuth: jest.fn(), AuthProvider: ({ children }) => children }));

function profileFor(address) {
  return {
    wallet_address: address,
    display_name: "Ada",
    reputation_score: 12,
    badges: [],
    bio: "Builder on Vorliq",
    verified: false,
    is_verified_owner: false,
  };
}

function renderAt(address) {
  return render(
    <MemoryRouter initialEntries={[`/profiles/${address}`]}>
      <Routes>
        <Route path="/profiles/:address" element={<Profile />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  jest.clearAllMocks();
  useAuth.mockReturnValue({ wallet: null, isLoggedIn: false });
});

test("loads a public profile for the address in the route", async () => {
  api.get.mockResolvedValue({ data: { profile: profileFor("VLQ_TARGET") } });
  renderAt("VLQ_TARGET");
  expect(await screen.findByRole("heading", { name: /^profiles$/i })).toBeInTheDocument();
  expect(api.get).toHaveBeenCalledWith("/profiles/profile", { params: { address: "VLQ_TARGET" } });
});

test("renders the owner's editing experience on their own profile", async () => {
  useAuth.mockReturnValue({ wallet: { address: "VLQ_ME_ADDRESS" }, isLoggedIn: true });
  api.get.mockResolvedValue({ data: { profile: profileFor("VLQ_ME_ADDRESS") } });
  renderAt("VLQ_ME_ADDRESS");
  expect(await screen.findByRole("heading", { name: /^profiles$/i })).toBeInTheDocument();
  expect(api.get).toHaveBeenCalledWith("/profiles/profile", { params: { address: "VLQ_ME_ADDRESS" } });
});

test("surfaces an error when the profile cannot load", async () => {
  api.get.mockRejectedValue({});
  renderAt("VLQ_TARGET");
  expect(await screen.findByText(/unable to load profile/i)).toBeInTheDocument();
});
