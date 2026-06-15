// Shared wallet-balance fetch hook. Single source used by the app shell wallet
// block, the Wallet page balance display, and the Send review check, so the
// balance call is not duplicated per page. Returns a numeric balance (or null
// when unavailable), a loading flag, an error string, and a reload for retry.
import { useCallback, useEffect, useState } from "react";

import api from "./api";

export default function useWalletBalance(address) {
  const [state, setState] = useState({ balance: undefined, loading: Boolean(address), error: "" });

  const load = useCallback(
    async (signal) => {
      if (!address) {
        setState({ balance: null, loading: false, error: "" });
        return;
      }
      setState((s) => ({ ...s, loading: true, error: "" }));
      try {
        const res = await api.get("/wallet/balance", { params: { address }, signal });
        const n = Number(res?.data?.balance);
        setState({ balance: Number.isFinite(n) ? n : null, loading: false, error: "" });
      } catch (err) {
        if (err?.name === "CanceledError" || err?.code === "ERR_CANCELED") return;
        setState({ balance: null, loading: false, error: "We couldn't load your balance." });
      }
    },
    [address]
  );

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return { ...state, reload: () => load() };
}
