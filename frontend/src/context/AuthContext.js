import { createContext, useContext, useState } from "react";

import api from "../helpers/api";
import { markWalletCreated } from "../helpers/onboarding";
import { recordReferralForNewWallet } from "../helpers/referral";
import { clearWallet, loadStoredWalletPublicInfo, loadWallet, persistEncryptedWallet, saveWallet } from "../helpers/storage";
import { loadAddressBook } from "../helpers/addressBook";

export const AuthContext = createContext(null);
const WALLET_SESSION_LOCKED_KEY = "vorliq_wallet_session_locked";

function walletSessionLocked() {
  return typeof window !== "undefined" && window.sessionStorage.getItem(WALLET_SESSION_LOCKED_KEY) === "true";
}

function lockStoredWalletSession() {
  if (typeof window !== "undefined") {
    window.sessionStorage.setItem(WALLET_SESSION_LOCKED_KEY, "true");
  }
}

function unlockStoredWalletSession() {
  if (typeof window !== "undefined") {
    window.sessionStorage.removeItem(WALLET_SESSION_LOCKED_KEY);
  }
}

export function AuthProvider({ children }) {
  const [wallet, setWallet] = useState(() => (walletSessionLocked() ? null : loadStoredWalletPublicInfo()));
  // Decrypted contacts for this session (the address book at rest stays encrypted
  // with the wallet password). Populated when the wallet is unlocked so the Send
  // page can search labels as the user types, without re-entering the password.
  const [addressBook, setAddressBook] = useState([]);

  async function login(password) {
    const loadedWallet = await loadWallet(password);
    unlockStoredWalletSession();
    setWallet({
      address: loadedWallet.address,
      public_key: loadedWallet.public_key,
    });
    try {
      setAddressBook(await loadAddressBook(password));
    } catch (error) {
      setAddressBook([]); // wrong password for the book, or none saved — non-fatal
    }
    return loadedWallet;
  }

  // Re-load contacts after they're edited in Settings (caller passes the password
  // it just used to re-encrypt them).
  async function refreshAddressBook(password) {
    try {
      const entries = await loadAddressBook(password);
      setAddressBook(entries);
      return entries;
    } catch (error) {
      return addressBook;
    }
  }

  function logout() {
    lockStoredWalletSession();
    setWallet(null);
    setAddressBook([]);
  }

  function clearLocalWallet() {
    clearWallet();
    unlockStoredWalletSession();
    setWallet(null);
  }

  async function createAndSaveWallet(password) {
    const response = await api.post("/wallet/create");
    const newWallet = response.data;
    await saveWallet(newWallet, password);
    // Flag this as a brand-new wallet so the dashboard shows the first-run tour.
    markWalletCreated();
    unlockStoredWalletSession();
    setWallet({
      address: newWallet.address,
      public_key: newWallet.public_key,
    });
    setAddressBook([]); // a brand-new wallet starts with no contacts
    // If this browser followed an invite link, record the referral against the
    // new member. Best-effort and non-blocking — wallet creation never waits on
    // it and never fails because of it.
    recordReferralForNewWallet(newWallet.address);
    return newWallet;
  }

  // Adopt a wallet imported by private key. The caller has already derived the
  // wallet locally and produced the encrypted backup envelope; we only persist
  // that envelope and start the session. The raw private key never reaches here.
  function adoptImportedWallet(encryptedBackup, publicInfo) {
    persistEncryptedWallet(encryptedBackup);
    unlockStoredWalletSession();
    setWallet({ address: publicInfo.address, public_key: publicInfo.public_key });
  }

  const value = {
    wallet,
    isLoggedIn: Boolean(wallet),
    login,
    logout,
    clearLocalWallet,
    createAndSaveWallet,
    adoptImportedWallet,
    addressBook,
    refreshAddressBook,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return context;
}
