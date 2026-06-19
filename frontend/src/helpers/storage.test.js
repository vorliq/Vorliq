import {
  clearWallet,
  exportEncryptedWalletBackup,
  hasWallet,
  importEncryptedWalletBackup,
  loadStoredWalletPublicInfo,
  loadWallet,
  saveWallet,
} from "./storage";

const wallet = {
  address: "VLQ_TEST_ADDRESS_123456",
  public_key: "TEST_PUBLIC_KEY",
  private_key: "TEST_PRIVATE_KEY_DO_NOT_EXPORT",
};

beforeEach(() => {
  window.localStorage.clear();
});

test("saveWallet, loadWallet, hasWallet, and clearWallet preserve encrypted wallet state", async () => {
  expect(hasWallet()).toBe(false);

  await saveWallet(wallet, "strong-password");

  expect(hasWallet()).toBe(true);
  expect(await loadWallet("strong-password")).toEqual(wallet);

  clearWallet();

  expect(hasWallet()).toBe(false);
  await expect(loadWallet("strong-password")).rejects.toThrow(/no saved vorliq wallet found/i);
});

test("re-encrypting under a new password rewraps the same key and retires the old password", async () => {
  // This is exactly what the Settings "Change password" flow does: load with the
  // current password, then save the same keypair under a new one.
  await saveWallet(wallet, "old-password");

  const unlocked = await loadWallet("old-password");
  await saveWallet(
    { address: unlocked.address, public_key: unlocked.public_key, private_key: unlocked.private_key },
    "new-password"
  );

  // Same key recoverable under the new password...
  expect(await loadWallet("new-password")).toEqual(wallet);
  // ...and the old password no longer decrypts the stored wallet.
  await expect(loadWallet("old-password")).rejects.toThrow(/incorrect password or corrupted/i);
});

test("wallet backup export never contains the plaintext private key", async () => {
  await saveWallet(wallet, "strong-password");

  const backup = await exportEncryptedWalletBackup("strong-password");

  expect(backup.address).toBe(wallet.address);
  expect(backup.public_key).toBe(wallet.public_key);
  expect(backup.encrypted_private_key).toBeTruthy();
  expect(backup.encryption_method).toBe("PBKDF2-SHA256-AES-GCM");
  expect(JSON.stringify(backup)).not.toContain(wallet.private_key);
});

test("stored wallet public info can be restored without decrypting the private key", async () => {
  await saveWallet(wallet, "strong-password");

  expect(loadStoredWalletPublicInfo()).toEqual({
    address: wallet.address,
    public_key: wallet.public_key,
  });
  expect(JSON.stringify(loadStoredWalletPublicInfo())).not.toContain(wallet.private_key);
});

test("wallet backup import fails with the wrong password and does not save a wallet", async () => {
  await saveWallet(wallet, "strong-password");
  const backup = await exportEncryptedWalletBackup("strong-password");
  clearWallet();

  await expect(importEncryptedWalletBackup(backup, "wrong-password")).rejects.toThrow();

  expect(hasWallet()).toBe(false);
});

test("wallet backup import validates and restores an encrypted wallet with the correct password", async () => {
  await saveWallet(wallet, "strong-password");
  const backup = await exportEncryptedWalletBackup("strong-password");
  clearWallet();

  await importEncryptedWalletBackup(backup, "strong-password");

  expect(hasWallet()).toBe(true);
  expect(await loadWallet("strong-password")).toEqual(wallet);
});
