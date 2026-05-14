import { createContext, useContext, useState } from "react";

import api from "../helpers/api";
import { loadWallet, saveWallet } from "../helpers/storage";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [wallet, setWallet] = useState(null);

  async function login(password) {
    const loadedWallet = await loadWallet(password);
    setWallet(loadedWallet);
    return loadedWallet;
  }

  function logout() {
    setWallet(null);
  }

  async function createAndSaveWallet(password) {
    const response = await api.post("/wallet/create");
    const newWallet = response.data;
    await saveWallet(newWallet, password);
    setWallet({
      address: newWallet.address,
      public_key: newWallet.public_key,
      private_key: newWallet.private_key,
    });
    return newWallet;
  }

  const value = {
    wallet,
    isLoggedIn: Boolean(wallet),
    login,
    logout,
    createAndSaveWallet,
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
