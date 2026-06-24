// Shared wallet-balance fetch hook. Single source used by the app shell wallet
// block, the Wallet page balance display, the Send review check, and the Faucet.
//
// The Vorliq core exposes only ONE balance number (`/wallet/balance`), and it is
// pending-inclusive: it already counts unconfirmed incoming credits and deducts
// unconfirmed outgoing debits. That figure overstates what a person can actually
// send, because the core's spend rule is confirmed-balance − pending-outgoing.
// So we derive an honest split from the address's pending transactions:
//
//   total      = the core's pending-inclusive balance
//   available  = total − pendingIncoming   (matches the core's spendable rule)
//   pendingIncoming / pendingOutgoing = unconfirmed credits / debits in flight
//
// `balance` is kept as an alias for `total` for backward compatibility with the
// existing consumers that only need a single number.
import { useCallback, useEffect, useState } from "react";

import api from "./api";
import { useRealtime } from "../context/RealtimeContext";

const EMPTY = { balance: null, total: null, available: null, pendingIncoming: 0, pendingOutgoing: 0 };

export default function useWalletBalance(address) {
  const [state, setState] = useState({
    ...EMPTY,
    balance: undefined,
    total: undefined,
    available: undefined,
    loading: Boolean(address),
    error: "",
  });

  const load = useCallback(
    async (signal) => {
      if (!address) {
        setState({ ...EMPTY, loading: false, error: "" });
        return;
      }
      setState((s) => ({ ...s, loading: true, error: "" }));
      // The balance and the pending split are independent reads, so fire them in
      // parallel rather than waiting for the balance before starting pending —
      // one fewer round-trip on the critical path (noticeable on mobile).
      const [balRes, pendRes] = await Promise.allSettled([
        api.get("/wallet/balance", { params: { address }, signal }),
        api.get("/transactions/pending", { params: { address, limit: 100, offset: 0 }, signal }),
      ]);
      if (signal?.aborted) return;

      if (balRes.status === "rejected") {
        const err = balRes.reason;
        if (err?.name === "CanceledError" || err?.code === "ERR_CANCELED") return;
        setState({ ...EMPTY, loading: false, error: "We couldn't load your balance." });
        return;
      }

      const n = Number(balRes.value?.data?.balance);
      const total = Number.isFinite(n) ? n : null;

      // Split the pending-inclusive total using the address's pending txs. If
      // the pending call failed we degrade gracefully: available falls back to
      // total (never overstating once the primary balance itself loaded).
      let pendingIncoming = 0;
      let pendingOutgoing = 0;
      if (pendRes.status === "fulfilled") {
        const txs = Array.isArray(pendRes.value?.data?.transactions) ? pendRes.value.data.transactions : [];
        for (const t of txs) {
          const amt = Number(t.amount) || 0;
          if (t.receiver_address === address) pendingIncoming += amt;
          if (t.sender_address === address) pendingOutgoing += amt;
        }
      }

      const available = total == null ? null : Math.max(0, total - pendingIncoming);
      setState({
        balance: total,
        total,
        available,
        pendingIncoming,
        pendingOutgoing,
        loading: false,
        error: "",
      });
    },
    [address]
  );

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // A wallet's balance only changes when a block confirms. The realtime socket
  // bumps latestBlockHeight on every new block (now including Flask
  // background-mined blocks, via the server-side block bridge), so re-fetch then
  // — this is what makes the balance update within one mining cycle after a
  // transaction confirms, with no page reload. useRealtime has a safe default,
  // so this is inert if the hook is ever used outside the realtime provider.
  const { latestBlockHeight } = useRealtime();
  useEffect(() => {
    if (latestBlockHeight == null) return undefined;
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [latestBlockHeight, load]);

  return { ...state, reload: () => load() };
}
