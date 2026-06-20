// Single shared source for the connected wallet's balance. The app shell shows
// the balance in the persistent sidebar AND on several pages at once (Dashboard,
// Wallet, Send, Faucet, Governance). Each of those used to call useWalletBalance
// independently, so the same figure was fetched many times over and the sidebar
// could briefly disagree with the page while one request was still in flight.
// This provider runs the fetch once, keyed on the logged-in wallet, and every
// surface reads the same state — so balance is consistent everywhere by
// construction, not by coincidence of hitting the same endpoint.
import { createContext, useContext } from "react";

import { useAuth } from "./AuthContext";
import useWalletBalance from "../helpers/useWalletBalance";

const WalletBalanceContext = createContext(null);

export function WalletBalanceProvider({ children }) {
  const { wallet } = useAuth();
  const balance = useWalletBalance(wallet?.address);
  return <WalletBalanceContext.Provider value={balance}>{children}</WalletBalanceContext.Provider>;
}

// Read the shared balance. When the provider is present this returns the single
// shared state and the fallback hook does nothing (null address → no fetch).
// When it is absent (e.g. an isolated unit-test render of one page), it falls
// back to a direct fetch so the component still works rather than crashing.
export function useSharedWalletBalance() {
  const ctx = useContext(WalletBalanceContext);
  const { wallet } = useAuth();
  const fallback = useWalletBalance(ctx ? null : wallet?.address);
  return ctx || fallback;
}

export default WalletBalanceContext;
