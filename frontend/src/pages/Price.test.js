import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import Price from "./Price";
import api from "../helpers/api";
import { toast } from "react-toastify";

jest.mock("../helpers/api", () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
jest.mock("react-toastify", () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));

function mockPriceData({ signals = [] } = {}) {
  api.get.mockImplementation((path, config) => {
    if (path === "/price/signals") return Promise.resolve({ data: { signals } });
    if (path === "/price/median") {
      const currency = config.params.currency;
      return Promise.resolve({
        data: { currency, has_enough_data: currency === "USD", median_price: 1.25, signal_count: 3 },
      });
    }
    return Promise.resolve({ data: {} });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

test("renders the price discovery page with signals and medians once loaded", async () => {
  mockPriceData({
    signals: [{ signal_id: "s1", price_value: 2, currency: "USD", submitter_address: "VLQ_SUBMITTER_ADDRESS", timestamp: Math.floor(Date.now() / 1000) }],
  });
  render(<Price />);

  expect(await screen.findByRole("heading", { name: /vlq price discovery/i })).toBeInTheDocument();
  expect(screen.getByText(/2 USD/)).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /median prices/i })).toBeInTheDocument();
  // USD has enough data -> shows a median; others show the not-enough-data label.
  expect(screen.getByText(/1\.25 USD/)).toBeInTheDocument();
  expect(screen.getAllByText(/not enough data yet/i).length).toBeGreaterThan(0);
});

test("shows an empty state when there are no signals", async () => {
  mockPriceData({ signals: [] });
  render(<Price />);
  expect(await screen.findByText(/no active price signals yet/i)).toBeInTheDocument();
});

test("rejects an incomplete signal submission before calling the API", async () => {
  mockPriceData({ signals: [] });
  render(<Price />);
  await screen.findByRole("heading", { name: /submit a price signal/i });

  await userEvent.click(screen.getByRole("button", { name: /submit signal/i }));
  expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/wallet address, currency, and price/i));
  expect(api.post).not.toHaveBeenCalled();
});

test("submits a complete signal and confirms success", async () => {
  mockPriceData({ signals: [] });
  api.post.mockResolvedValue({ data: { success: true } });
  render(<Price />);
  await screen.findByRole("heading", { name: /submit a price signal/i });

  // The page's labels are not associated to inputs, so select by role: the two
  // text inputs are wallet + currency (in order), the number input is the price.
  const textInputs = screen.getAllByRole("textbox");
  await userEvent.type(textInputs[0], "VLQ_ME");
  await userEvent.type(textInputs[1], "USD");
  await userEvent.type(screen.getByRole("spinbutton"), "1.5");
  await userEvent.click(screen.getByRole("button", { name: /submit signal/i }));

  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith("/price/signal", {
      submitter_address: "VLQ_ME",
      currency: "USD",
      price_value: 1.5,
    })
  );
  expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/submitted/i));
});

test("surfaces a load error when the price API fails", async () => {
  // A message-less rejection falls back to the page's own default error copy.
  api.get.mockRejectedValue({});
  render(<Price />);
  expect(await screen.findByText(/unable to load price signals/i)).toBeInTheDocument();
});
