import { trustLabelsForProfile, trustLabelDescription } from "./trustLabels";

describe("trustLabelsForProfile", () => {
  test("a null profile is an unverified wallet", () => {
    expect(trustLabelsForProfile(null)).toEqual(["Unverified Wallet"]);
  });

  test("explicit trust_labels are used verbatim", () => {
    expect(trustLabelsForProfile({ trust_labels: ["Custom"] })).toEqual(["Custom"]);
  });

  test("derives verified + reputation + recency labels", () => {
    const labels = trustLabelsForProfile({
      verified_wallet: true,
      reputation_score: 120,
      created_at: Math.floor(Date.now() / 1000) - 60, // created a minute ago
    });
    expect(labels).toContain("Wallet Verified");
    expect(labels).toContain("Top Reputation");
    expect(labels).toContain("Active Contributor");
    expect(labels).toContain("New Member");
  });

  test("an unverified low-reputation old profile gets the minimal label", () => {
    const labels = trustLabelsForProfile({
      verified_wallet: false,
      reputation_score: 1,
      created_at: 1000, // long ago
    });
    expect(labels).toEqual(["Unverified Wallet"]);
  });
});

describe("trustLabelDescription", () => {
  test("known labels get explanatory copy", () => {
    expect(trustLabelDescription("Wallet Verified")).toMatch(/proven control/);
    expect(trustLabelDescription("New Member")).toMatch(/created recently/);
  });
  test("unknown labels pass through unchanged", () => {
    expect(trustLabelDescription("Something Else")).toBe("Something Else");
  });
});
