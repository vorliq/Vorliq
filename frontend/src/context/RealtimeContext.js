import { createContext, useContext, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

import { useAuth } from "./AuthContext";
import { useNotifications } from "./NotificationContext";

// Same origin rule the chat socket uses: talk to the local backend in dev.
function socketUrl() {
  if (typeof window === "undefined") return "";
  return window.location.hostname === "localhost" ? "http://localhost:5000" : window.location.origin;
}

const RealtimeContext = createContext({ latestBlockHeight: null, exchangeVersion: 0 });

function formatAmount(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return Number.isInteger(number) ? String(number) : number.toFixed(2).replace(/\.?0+$/, "");
}

function humanStatus(status) {
  return String(status || "").replace(/_/g, " ");
}

// Subscribes once to the backend socket and turns the four real-time chain
// events into bell notifications (for the connected wallet) and a live block
// height (for the Mining page). One socket, listeners bound once, cleaned up on
// unmount — no listener accumulation across reconnects.
export function RealtimeProvider({ children }) {
  const { wallet } = useAuth();
  const { addNotification } = useNotifications();
  const [latestBlockHeight, setLatestBlockHeight] = useState(null);
  // Bumped whenever any exchange coordination changes, so an open Exchange view
  // can refetch live when the other party acts (accept, send VLQ, confirm, etc.).
  const [exchangeVersion, setExchangeVersion] = useState(0);

  // Read the live address inside long-lived handlers without re-subscribing.
  const addressRef = useRef(wallet?.address || null);
  useEffect(() => {
    addressRef.current = wallet?.address || null;
  }, [wallet?.address]);

  useEffect(() => {
    const socket = io(socketUrl(), { path: "/api/socket.io", transports: ["websocket", "polling"] });
    const isMine = (payload) =>
      payload && payload.address && addressRef.current && payload.address === addressRef.current;

    socket.on("block:new", (payload) => {
      const height = Number(payload?.height);
      if (Number.isFinite(height)) {
        setLatestBlockHeight((prev) => (prev == null ? height : Math.max(prev, height)));
      }
    });

    socket.on("wallet:credit", (payload) => {
      if (!isMine(payload)) return;
      addNotification("wallet_credit", "VLQ received", `You received ${formatAmount(payload.amount)} VLQ.`, "/wallet");
    });

    socket.on("loan:funded", (payload) => {
      if (!isMine(payload)) return;
      addNotification("loan_funded", "Loan funded", "Your loan request was funded from the community pool.", "/lending");
    });

    socket.on("loan:repaid", (payload) => {
      if (!isMine(payload)) return;
      addNotification("loan_repaid", "Loan repaid", "Your loan has been repaid and is now closed.", "/lending");
    });

    socket.on("exchange:update", () => {
      // Payload is intentionally ignored — the Exchange view refetches the
      // authoritative state; this is just the "something changed" signal.
      setExchangeVersion((v) => v + 1);
    });

    socket.on("proposal:outcome", (payload) => {
      if (!isMine(payload)) return;
      const title = payload.title ? `"${String(payload.title).slice(0, 48)}"` : "Your proposal";
      addNotification("proposal_outcome", "Proposal concluded", `${title} reached an outcome: ${humanStatus(payload.status)}.`, "/governance");
    });

    return () => {
      socket.off();
      socket.disconnect();
    };
  }, [addNotification]);

  return (
    <RealtimeContext.Provider value={{ latestBlockHeight, exchangeVersion }}>
      {children}
    </RealtimeContext.Provider>
  );
}

export function useRealtime() {
  return useContext(RealtimeContext);
}
