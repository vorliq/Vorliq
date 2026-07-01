import { act, renderHook } from "@testing-library/react";

import { AuthProvider, useAuth } from "./AuthContext";
import api from "../helpers/api";
import { saveAddressBook } from "../helpers/addressBook";
import { clearWallet, exportEncryptedWalletBackup, hasWallet, saveWallet } from "../helpers/storage";

jest.mock("../helpers/api", () => ({ __esModule: true, default: { post: jest.fn() } }));

function wrapper({ children }) {
  return <AuthProvider>{children}</AuthProvider>;
}

const NEW_WALLET = {
  address: "VLQ_NEW_ADDRESS",
  public_key: "NEW_PUBLIC_KEY",
  private_key: "NEW_PRIVATE_KEY",
};

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  jest.clearAllMocks();
});

test("useAuth throws when used outside a provider", () => {
  // Silence the expected React error boundary log for this assertion.
  const spy = jest.spyOn(console, "error").mockImplementation(() => {});
  expect(() => renderHook(() => useAuth())).toThrow(/useAuth must be used inside AuthProvider/i);
  spy.mockRestore();
});

test("starts logged out with an empty address book", () => {
  const { result } = renderHook(() => useAuth(), { wrapper });
  expect(result.current.isLoggedIn).toBe(false);
  expect(result.current.wallet).toBeNull();
  expect(result.current.addressBook).toEqual([]);
});

test("createAndSaveWallet persists a new wallet and starts the session", async () => {
  api.post.mockResolvedValue({ data: NEW_WALLET });
  const { result } = renderHook(() => useAuth(), { wrapper });

  await act(async () => {
    await result.current.createAndSaveWallet("pw");
  });

  expect(api.post).toHaveBeenCalledWith("/wallet/create");
  expect(hasWallet()).toBe(true);
  expect(result.current.isLoggedIn).toBe(true);
  expect(result.current.wallet).toEqual({ address: NEW_WALLET.address, public_key: NEW_WALLET.public_key });
  // The new wallet's private key is never exposed on the public session object.
  expect(JSON.stringify(result.current.wallet)).not.toContain(NEW_WALLET.private_key);
});

test("login unlocks a saved wallet and loads its decrypted contacts", async () => {
  api.post.mockResolvedValue({ data: NEW_WALLET });
  const { result } = renderHook(() => useAuth(), { wrapper });
  await act(async () => {
    await result.current.createAndSaveWallet("pw");
  });
  await saveAddressBook([{ label: "Alice", address: "VLQ_ALICE" }], "pw");

  await act(async () => {
    await result.current.logout();
  });
  expect(result.current.isLoggedIn).toBe(false);

  await act(async () => {
    await result.current.login("pw");
  });
  expect(result.current.isLoggedIn).toBe(true);
  expect(result.current.addressBook).toEqual([{ label: "Alice", address: "VLQ_ALICE" }]);
});

test("logout clears the session but leaves the encrypted wallet on disk", async () => {
  api.post.mockResolvedValue({ data: NEW_WALLET });
  const { result } = renderHook(() => useAuth(), { wrapper });
  await act(async () => {
    await result.current.createAndSaveWallet("pw");
  });

  act(() => result.current.logout());
  expect(result.current.wallet).toBeNull();
  expect(hasWallet()).toBe(true); // encrypted backup survives logout
});

test("clearLocalWallet removes the wallet from disk and memory", async () => {
  api.post.mockResolvedValue({ data: NEW_WALLET });
  const { result } = renderHook(() => useAuth(), { wrapper });
  await act(async () => {
    await result.current.createAndSaveWallet("pw");
  });

  act(() => result.current.clearLocalWallet());
  expect(result.current.wallet).toBeNull();
  expect(hasWallet()).toBe(false);
});

test("adoptImportedWallet persists the backup envelope and starts the session", async () => {
  // Build a real encrypted backup envelope the way the import flow would, then
  // clear storage so adopt is genuinely restoring it.
  await saveWallet({ address: "VLQ_IMP", public_key: "IMP_PUB", private_key: "IMP_PRIV" }, "pw");
  const backup = await exportEncryptedWalletBackup("pw");
  clearWallet();

  const { result } = renderHook(() => useAuth(), { wrapper });
  act(() => result.current.adoptImportedWallet(backup, { address: "VLQ_IMP", public_key: "IMP_PUB" }));

  expect(result.current.wallet).toEqual({ address: "VLQ_IMP", public_key: "IMP_PUB" });
  expect(hasWallet()).toBe(true);
});
