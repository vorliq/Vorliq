// Journey 3 (feature): a user uploads a profile image in Settings, then opens the
// forum where they have a post, and confirms their avatar image appears on it.
const path = require("path");
const { test, expect } = require("./fixtures");
const { createWallet, createForumPost, importWalletViaUI, assertNoHorizontalOverflow } = require("./helpers");

const AVATAR_FIXTURE = path.join(__dirname, "avatar-fixture.png");

test("user uploads an avatar and it appears on their forum post", async ({ page }) => {
  // A wallet with an authored forum post.
  const author = await createWallet();
  await createForumPost(author, { title: `E2E avatar post ${Date.now()}`, body: "A post to verify the author avatar renders." });

  await importWalletViaUI(page, author.private_key, "e2e-avatar-pass-1");

  // Upload an avatar from Settings.
  await page.goto("/settings", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /profile image/i })).toBeVisible();
  await assertNoHorizontalOverflow(page, "settings");
  await page.getByLabel(/choose image/i).setInputFiles(AVATAR_FIXTURE);
  await page.getByLabel(/wallet password/i).fill("e2e-avatar-pass-1");
  await page.getByRole("button", { name: /upload image/i }).click();
  await expect(
    page.getByText(/your new profile image is live/i).first(),
    "settings should confirm the avatar upload succeeded"
  ).toBeVisible({ timeout: 20_000 });

  // The avatar image (keyed by the author's address) now renders on the forum.
  await page.goto("/forum", { waitUntil: "domcontentloaded" });
  await assertNoHorizontalOverflow(page, "forum");
  const avatarImg = page.locator(`img.avatar-image[src*="${author.address}"]`).first();
  await expect(
    avatarImg,
    "the uploaded avatar image should render on the author's forum post"
  ).toBeVisible({ timeout: 20_000 });
});
