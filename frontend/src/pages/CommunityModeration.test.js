import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import Admin from "./Admin";
import Forum from "./Forum";
import Profile from "./Profile";
import api from "../helpers/api";
import { useAuth } from "../context/AuthContext";

jest.mock("../helpers/api", () => ({
  get: jest.fn(),
  post: jest.fn(),
}));

jest.mock("../context/AuthContext", () => ({
  useAuth: jest.fn(),
}));

jest.mock("../helpers/storage", () => ({
  loadWallet: jest.fn(),
}));

jest.mock("../helpers/signer", () => ({
  signMessage: jest.fn(),
}));

jest.mock("react-toastify", () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  window.sessionStorage.clear();
  useAuth.mockReturnValue({ isLoggedIn: false, wallet: null });
});

test("Profile verification UI and Wallet Verified badge render", async () => {
  useAuth.mockReturnValue({ isLoggedIn: true, wallet: { address: "VLQ_MEMBER", public_key: "PUBLIC_KEY" } });
  api.get.mockResolvedValue({
    data: {
      profile: {
        wallet_address: "VLQ_MEMBER",
        display_name: "Verified Member",
        avatar_style: "green",
        verified_wallet: true,
        trust_labels: ["Wallet Verified", "Active Contributor"],
        reputation_score: 42,
        activity_summary: {},
      },
    },
  });

  render(<MemoryRouter initialEntries={["/profile?address=VLQ_MEMBER"]}><Profile /></MemoryRouter>);

  expect(await screen.findByText("Wallet Verified")).toBeInTheDocument();
  expect(screen.getByText(/Verify Wallet/i)).toBeInTheDocument();
  expect(screen.getByText(/not KYC or real-world identity/i)).toBeInTheDocument();
});

test("Report modal renders from profile page", async () => {
  api.get.mockResolvedValue({
    data: {
      profile: {
        wallet_address: "VLQ_MEMBER",
        display_name: "Member",
        avatar_style: "cyan",
        verified_wallet: false,
        reputation_score: 1,
        activity_summary: {},
      },
    },
  });

  render(<MemoryRouter initialEntries={["/profile?address=VLQ_MEMBER"]}><Profile /></MemoryRouter>);
  await userEvent.click(await screen.findByRole("button", { name: /report/i }));

  expect(screen.getByRole("form", { name: /report content/i })).toBeInTheDocument();
  expect(screen.getByText(/Reports create a review queue only/i)).toBeInTheDocument();
});

test("Forum hidden and locked states render safely", async () => {
  api.get.mockImplementation((url) => {
    if (url === "/forum/featured") return Promise.resolve({ data: { posts: [] } });
    if (url === "/forum/post") {
      return Promise.resolve({
        data: {
          post: {
            post_id: "post-1",
            title: "Hidden Post",
            body: "This forum post is hidden by community moderation review.",
            author_address: "VLQ_AUTHOR",
            category: "general",
            timestamp: 1,
            vote_count: 0,
            feature_vote_count: 0,
            replies: [],
            moderation_status: "locked",
          },
        },
      });
    }
    return Promise.resolve({
      data: {
        posts: [{
          post_id: "post-1",
          title: "Hidden Post",
          body: "notice",
          author_address: "VLQ_AUTHOR",
          category: "general",
          timestamp: 1,
          replies: [],
          moderation_status: "locked",
        }],
      },
    });
  });

  render(<MemoryRouter><Forum /></MemoryRouter>);
  await userEvent.click(screen.getByRole("button", { name: /all posts/i }));
  await userEvent.click(await screen.findByText("Hidden Post"));

  expect((await screen.findAllByText(/locked by moderation/i)).length).toBeGreaterThan(0);
  expect(screen.getByText(/Replies are closed/i)).toBeInTheDocument();
});

test("Admin moderation remains unauthorized-safe", async () => {
  api.get.mockRejectedValue({ response: { status: 401 } });
  render(<MemoryRouter><Admin /></MemoryRouter>);

  await userEvent.type(screen.getByLabelText(/admin token/i), "wrong");
  await userEvent.click(screen.getByRole("button", { name: /open operator dashboard/i }));

  await waitFor(() => expect(screen.getByText("Unauthorized")).toBeInTheDocument());
});
