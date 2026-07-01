import { deviceFingerprint } from "./deviceFingerprint";

test("produces a stable 64-hex SHA-256 device fingerprint", async () => {
  const fingerprint = await deviceFingerprint();
  expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
});

test("is deterministic for the same environment", async () => {
  const a = await deviceFingerprint();
  const b = await deviceFingerprint();
  expect(a).toBe(b);
});
