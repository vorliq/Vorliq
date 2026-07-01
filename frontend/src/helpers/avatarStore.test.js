import { avatarImageUrl, avatarVersion, bumpAvatarVersion, subscribeAvatar } from "./avatarStore";

test("avatarVersion starts at zero and bumps to a timestamp", () => {
  const address = `VLQ_${Date.now()}`;
  expect(avatarVersion(address)).toBe(0);
  expect(avatarVersion(null)).toBe(0);
  bumpAvatarVersion(address);
  expect(avatarVersion(address)).toBeGreaterThan(0);
});

test("bumping notifies subscribers until they unsubscribe", () => {
  const listener = jest.fn();
  const unsubscribe = subscribeAvatar(listener);
  bumpAvatarVersion("VLQ_SUB");
  expect(listener).toHaveBeenCalledTimes(1);
  unsubscribe();
  bumpAvatarVersion("VLQ_SUB");
  expect(listener).toHaveBeenCalledTimes(1);
});

test("bumping with no address is a no-op", () => {
  const listener = jest.fn();
  const unsubscribe = subscribeAvatar(listener);
  bumpAvatarVersion("");
  expect(listener).not.toHaveBeenCalled();
  unsubscribe();
});

test("avatarImageUrl builds a cache-busted avatar endpoint", () => {
  expect(avatarImageUrl("")).toBe("");
  const url = avatarImageUrl("VLQ_ADDR", 123);
  expect(url).toContain("/profiles/avatar?address=VLQ_ADDR");
  expect(url).toContain("&v=123");
  expect(avatarImageUrl("VLQ_ADDR")).not.toContain("&v=");
});
