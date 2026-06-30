import {
  captureReferrerFromUrl,
  storedReferrer,
  clearStoredReferrer,
  inviteLinkFor,
  recordReferralForNewWallet,
} from "./referral";
import api from "./api";

jest.mock("./api", () => ({ __esModule: true, default: { post: jest.fn() } }));

const VALID = "3GehZ6sdUx5DcBa7GHNbTwtNM45X"; // 27 base58 chars, within 20-48

beforeEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
  // jsdom defaults the URL to http://localhost/. Reset search per test.
  window.history.replaceState({}, "", "/");
});

describe("captureReferrerFromUrl / storedReferrer", () => {
  test("captures a valid ?ref and keeps it", () => {
    window.history.replaceState({}, "", `/?ref=${VALID}`);
    captureReferrerFromUrl();
    expect(storedReferrer()).toBe(VALID);
  });

  test("ignores an obviously bogus ref", () => {
    window.history.replaceState({}, "", "/?ref=not-a-real-address");
    captureReferrerFromUrl();
    expect(storedReferrer()).toBe("");
  });

  test("never overwrites a previously captured referrer", () => {
    localStorage.setItem("vorliq_referrer", VALID);
    const second = "5KjL9mNpQr2StUvWxYz3AbCdEfGh";
    window.history.replaceState({}, "", `/?ref=${second}`);
    captureReferrerFromUrl();
    expect(storedReferrer()).toBe(VALID); // unchanged
  });

  test("clearStoredReferrer removes it", () => {
    localStorage.setItem("vorliq_referrer", VALID);
    clearStoredReferrer();
    expect(storedReferrer()).toBe("");
  });
});

describe("inviteLinkFor", () => {
  test("builds an absolute ?ref link", () => {
    expect(inviteLinkFor(VALID)).toBe(`http://localhost/?ref=${VALID}`);
  });
  test("url-encodes the address", () => {
    expect(inviteLinkFor("a b")).toContain("ref=a%20b");
  });
});

describe("recordReferralForNewWallet", () => {
  test("posts the referral and clears the stored referrer", async () => {
    api.post.mockResolvedValue({ data: { success: true } });
    localStorage.setItem("vorliq_referrer", VALID);
    const newWallet = "5KjL9mNpQr2StUvWxYz3AbCdEfGh";

    await recordReferralForNewWallet(newWallet);

    expect(api.post).toHaveBeenCalledWith("/invites/record", {
      wallet_address: newWallet,
      referrer_address: VALID,
    });
    expect(storedReferrer()).toBe("");
  });

  test("does nothing (but still clears) when there is no referrer", async () => {
    await recordReferralForNewWallet("5KjL9mNpQr2StUvWxYz3AbCdEfGh");
    expect(api.post).not.toHaveBeenCalled();
    expect(storedReferrer()).toBe("");
  });

  test("self-referral is ignored", async () => {
    localStorage.setItem("vorliq_referrer", VALID);
    await recordReferralForNewWallet(VALID);
    expect(api.post).not.toHaveBeenCalled();
    expect(storedReferrer()).toBe("");
  });

  test("a backend failure never throws and still clears the referrer", async () => {
    api.post.mockRejectedValue(new Error("referrer not on chain"));
    localStorage.setItem("vorliq_referrer", VALID);
    await expect(recordReferralForNewWallet("5KjL9mNpQr2StUvWxYz3AbCdEfGh")).resolves.toBeUndefined();
    expect(storedReferrer()).toBe("");
  });
});
