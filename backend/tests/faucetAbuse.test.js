const os = require("os");
const path = require("path");
const fs = require("fs");

let abuse;
beforeEach(() => {
  jest.resetModules();
  process.env.VORLIQ_BACKEND_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "abuse-"));
  abuse = require("../faucetAbuse");
});

describe("faucet abuse defences", () => {
  test("wallet creation velocity: 3 allowed per hour, 4th blocks the IP for 24h", () => {
    const ip = "203.0.113.1";
    for (let i = 1; i <= 3; i += 1) {
      expect(abuse.walletCreateDecision(ip).allowed).toBe(true);
      abuse.recordWalletCreation(`w${i}`, ip);
    }
    const fourth = abuse.walletCreateDecision(ip);
    expect(fourth.allowed).toBe(false);
    expect(fourth.reason).toBe("velocity");
    expect(fourth.retryAfterSeconds).toBeGreaterThan(0);
    // Still blocked on the next attempt within the window.
    expect(abuse.walletCreateDecision(ip).allowed).toBe(false);
    // A different IP is unaffected.
    expect(abuse.walletCreateDecision("203.0.113.2").allowed).toBe(true);
  });

  test("minimum wallet age: freshly created blocked, unknown grandfathered", () => {
    abuse.recordWalletCreation("fresh", "203.0.113.3");
    expect(abuse.walletTooNew("fresh")).toBe(true);
    expect(abuse.walletTooNew("imported-or-old")).toBe(false);
  });

  test("IP may fund at most two distinct wallets per 24h", () => {
    const ip = "198.51.100.5";
    expect(abuse.ipFaucetDecision(ip, "wA").allowed).toBe(true);
    abuse.recordFaucetClaim(ip, "wA", "fp1");
    expect(abuse.ipFaucetDecision(ip, "wB").allowed).toBe(true);
    abuse.recordFaucetClaim(ip, "wB", "fp2");
    const third = abuse.ipFaucetDecision(ip, "wC");
    expect(third.allowed).toBe(false);
    expect(third.reason).toBe("ip_wallet_limit");
    // A wallet already seen from this IP is not a NEW wallet, so it is allowed.
    expect(abuse.ipFaucetDecision(ip, "wA").allowed).toBe(true);
  });

  test("permanent bans for IP and wallet, with unban", () => {
    abuse.banIp("192.0.2.9", "spam");
    abuse.banWallet("evilwallet", "drain");
    expect(abuse.isIpBanned("192.0.2.9")).toBe(true);
    expect(abuse.isWalletBanned("evilwallet")).toBe(true);
    abuse.unbanIp("192.0.2.9");
    expect(abuse.isIpBanned("192.0.2.9")).toBe(false);
  });

  test("admin views surface top IPs, top wallets, and IPs at the limit", () => {
    const ip = "198.51.100.7";
    abuse.recordFaucetClaim(ip, "wX", "fpx");
    abuse.recordFaucetClaim(ip, "wY", "fpy");
    expect(abuse.topIpsByClaims24h(10)[0]).toMatchObject({ ip, claims: 2, distinct_wallets: 2 });
    expect(abuse.topWalletsByClaims(10).length).toBe(2);
    expect(abuse.ipsAtMultiWalletLimit().map((r) => r.ip)).toContain(ip);
  });
});
