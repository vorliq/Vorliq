import {
  formatHash,
  formatNumber,
  formatRelativeTime,
  formatStatus,
  formatTime,
  formatVlq,
  loadNetworkStatus,
  loadPublicChainSnapshot,
  shortHash,
} from "./publicApi";
import api from "./api";
import { trackApiFailure } from "./analytics";

jest.mock("./api", () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock("./analytics", () => ({ trackApiFailure: jest.fn() }));

beforeEach(() => {
  jest.clearAllMocks();
});

describe("formatters", () => {
  test("shortHash truncates long values and guards empties", () => {
    expect(shortHash("")).toBe("Unavailable");
    expect(shortHash("abc")).toBe("abc");
    expect(shortHash("0123456789abcdefghij")).toBe("0123456789...efghij");
  });

  test("formatHash middle-truncates and guards empties", () => {
    expect(formatHash(null)).toBe("Unavailable");
    expect(formatHash("short")).toBe("short");
    expect(formatHash("0000096058825192aaaa", 10, 6)).toBe("0000096058…92aaaa");
  });

  test("formatStatus maps known statuses and title-cases the rest", () => {
    expect(formatStatus("pass")).toBe("Operational");
    expect(formatStatus("WARN")).toBe("Monitoring");
    expect(formatStatus("error")).toBe("Attention");
    expect(formatStatus("custom")).toBe("Custom");
    expect(formatStatus("")).toBe("Unavailable");
  });

  test("formatTime renders a date from a unix timestamp and guards NaN", () => {
    expect(formatTime("not-a-number")).toBe("Time unavailable");
    expect(typeof formatTime(1700000000)).toBe("string");
    expect(formatTime(1700000000)).not.toBe("Time unavailable");
  });

  test("formatRelativeTime buckets into s/m/h/d", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(formatRelativeTime("x")).toBe("");
    expect(formatRelativeTime(now - 5)).toMatch(/s ago$/);
    expect(formatRelativeTime(now - 120)).toMatch(/m ago$/);
    expect(formatRelativeTime(now - 3 * 3600)).toMatch(/h ago$/);
    expect(formatRelativeTime(now - 3 * 86400)).toMatch(/d ago$/);
  });

  test("formatVlq and formatNumber guard non-numeric input", () => {
    expect(formatVlq("x")).toBe("Unavailable");
    expect(formatVlq(1234)).toMatch(/VLQ$/);
    expect(formatNumber("x")).toBe("Unavailable");
    expect(formatNumber(1000)).toBe((1000).toLocaleString());
  });
});

describe("loadPublicChainSnapshot", () => {
  test("maps fulfilled endpoints into the snapshot shape", async () => {
    api.get.mockImplementation((url) => {
      const data = {
        "/chain/summary": { success: true, summary: { block_height: 5 } },
        "/chain/blocks": { success: true, blocks: [{ index: 1 }] },
        "/transactions": { success: true, transactions: [{ id: "a" }], total: 1 },
        "/transactions/pending": { success: true, transactions: [], total: 0 },
        "/health": { success: true },
        "/leaderboard": { success: true, totals: { holders: 42 } },
      }[url] || { success: true };
      return Promise.resolve({ data });
    });

    const snap = await loadPublicChainSnapshot();
    expect(snap.summary).toEqual({ block_height: 5 });
    expect(snap.blocks).toEqual([{ index: 1 }]);
    expect(snap.confirmedTotal).toBe(1);
    expect(snap.holderTotal).toBe(42);
    expect(snap.unavailable.summary).toBe(false);
  });

  test("marks unavailable and reports failures when endpoints reject", async () => {
    api.get.mockRejectedValue({ code: "ECONNABORTED", message: "timeout of 5000ms exceeded" });
    const snap = await loadPublicChainSnapshot();
    expect(snap.summary).toBeNull();
    expect(snap.blocks).toEqual([]);
    expect(snap.unavailable.summary).toBe(true);
    expect(trackApiFailure).toHaveBeenCalledWith("/chain/summary", "timeout");
  });
});

describe("loadNetworkStatus", () => {
  test("returns null sections when endpoints are unavailable", async () => {
    api.get.mockResolvedValue({ data: { success: false } });
    const status = await loadNetworkStatus();
    expect(status.readiness).toBeNull();
    expect(status.unavailable.readiness).toBe(true);
  });

  test("returns section data when endpoints succeed", async () => {
    api.get.mockResolvedValue({ data: { success: true, ready: true } });
    const status = await loadNetworkStatus();
    expect(status.readiness).toEqual({ success: true, ready: true });
    expect(status.unavailable.deployment).toBe(false);
  });
});
