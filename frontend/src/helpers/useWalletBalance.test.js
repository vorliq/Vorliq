import { renderHook, waitFor } from "@testing-library/react";

import useWalletBalance from "./useWalletBalance";
import api from "./api";

jest.mock("./api", () => ({ __esModule: true, default: { get: jest.fn() } }));

// useWalletBalance reads useRealtime, which has a safe context default, so it
// works without a RealtimeProvider in the test.

beforeEach(() => {
  jest.clearAllMocks();
});

test("with no address it settles to an empty, non-loading state", async () => {
  const { result } = renderHook(() => useWalletBalance(null));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.total).toBeNull();
  expect(result.current.available).toBeNull();
});

test("splits the pending-inclusive total into available and pending amounts", async () => {
  const address = "VLQ_ME";
  api.get.mockImplementation((url) => {
    if (url === "/wallet/balance") return Promise.resolve({ data: { balance: 10 } });
    if (url === "/transactions/pending") {
      return Promise.resolve({
        data: {
          transactions: [
            { amount: 3, receiver_address: address }, // incoming, unconfirmed
            { amount: 2, sender_address: address }, // outgoing, unconfirmed
          ],
        },
      });
    }
    return Promise.resolve({ data: {} });
  });

  const { result } = renderHook(() => useWalletBalance(address));
  await waitFor(() => expect(result.current.loading).toBe(false));

  expect(result.current.total).toBe(10);
  expect(result.current.pendingIncoming).toBe(3);
  expect(result.current.pendingOutgoing).toBe(2);
  // available = total - pendingIncoming (matches the core's spendable rule)
  expect(result.current.available).toBe(7);
});

test("surfaces a friendly error when the balance call fails", async () => {
  api.get.mockRejectedValue(new Error("network down"));
  const { result } = renderHook(() => useWalletBalance("VLQ_ME"));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.error).toMatch(/couldn't load your balance/i);
});
