import { createContext, useContext, useState } from "react";

import api from "../helpers/api";
import { markWalletCreated } from "../helpers/onboarding";
import { clearWallet, loadStoredWalletPublicInfo, loadWallet, persistEncryptedWallet, saveWallet } from "../helpers/storage";

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

  async function login(password) {
    const loadedWallet = await loadWallet(password);
    unlockStoredWalletSession();
    setWallet({
      address: loadedWallet.address,
      public_key: loadedWallet.public_key,
    });
    return loadedWallet;
  }

  function logout() {
    lockStoredWalletSession();
    setWallet(null);
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
