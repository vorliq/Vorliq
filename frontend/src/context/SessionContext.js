import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "./AuthContext";

// Session lifecycle + inactivity guard for a signed-in wallet.
//
// After 30 minutes with no user activity we show a warning with a 60-second
// countdown. If the member confirms they are still there the warning is
// dismissed and the timer resets; if the countdown reaches zero we clear the
// wallet from memory (the encrypted backup stays on disk) and return to the
// landing page. The warning is dismissible so an active member is never
// interrupted by it. The same context records when the session started and the
// last time the member did anything, which the Settings → Sessions panel reads.

const IDLE_WARNING_AFTER_MS = 30 * 60 * 1000; // 30 minutes of inactivity
const COUNTDOWN_MS = 60 * 1000; // then a one-minute countdown
const SESSION_START_KEY = "vorliq_session_started_at";
const ACTIVITY_EVENTS = ["mousedown", "mousemove", "keydown", "scroll", "touchstart", "click"];

const SessionContext = createContext(null);

function readStoredStart() {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(SESSION_START_KEY);
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function SessionProvider({ children }) {
  const { isLoggedIn, logout } = useAuth();
  const navigate = useNavigate();

  const [sessionStartedAt, setSessionStartedAt] = useState(null);
  // The countdown warning, when active, holds the timestamp it started at.
  const [warningStartedAt, setWarningStartedAt] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(60);

  // Last activity is a ref so the frequent updates from mousemove/scroll never
  // re-render the whole app; the Settings panel reads it through getLastActivity.
  const lastActivityRef = useRef(Date.now());
  const warningRef = useRef(false);
  // Mirrors warningStartedAt so the 1s interval closure reads the latest value
  // without re-subscribing the interval on every countdown change.
  const warningStartedAtRef = useRef(null);

  // Establish (or restore) the session-start timestamp when a wallet is active.
  useEffect(() => {
    if (!isLoggedIn) {
      setSessionStartedAt(null);
      if (typeof window !== "undefined") window.sessionStorage.removeItem(SESSION_START_KEY);
      return;
    }
    const existing = readStoredStart();
    const start = existing || Date.now();
    if (!existing && typeof window !== "undefined") {
      window.sessionStorage.setItem(SESSION_START_KEY, String(start));
    }
    setSessionStartedAt(start);
    lastActivityRef.current = Date.now();
  }, [isLoggedIn]);

  const getLastActivity = useCallback(() => lastActivityRef.current, []);

  const endSession = useCallback(
    (redirect = true) => {
      setWarningStartedAt(null);
      warningRef.current = false;
      logout();
      if (redirect) navigate("/");
    },
    [logout, navigate]
  );

  // "I'm still here" — dismiss the warning and reset the idle clock.
  const stayActive = useCallback(() => {
    lastActivityRef.current = Date.now();
    warningRef.current = false;
    setWarningStartedAt(null);
  }, []);

  // Track activity (only while signed in, and not while the warning is up so the
  // countdown stays meaningful and dismissal is a deliberate choice).
  useEffect(() => {
    if (!isLoggedIn) return undefined;
    const onActivity = () => {
      if (warningRef.current) return;
      lastActivityRef.current = Date.now();
    };
    ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, onActivity, { passive: true }));
    return () => ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, onActivity));
  }, [isLoggedIn]);

  // The single timer that drives both the idle check and the countdown.
  useEffect(() => {
    if (!isLoggedIn) {
      setWarningStartedAt(null);
      warningRef.current = false;
      return undefined;
    }
    const tick = () => {
      const now = Date.now();
      if (!warningRef.current) {
        if (now - lastActivityRef.current >= IDLE_WARNING_AFTER_MS) {
          warningRef.current = true;
          setWarningStartedAt(now);
          setSecondsLeft(Math.round(COUNTDOWN_MS / 1000));
        }
        return;
      }
      const elapsed = now - (warningStartedAtRef.current || now);
      const remaining = Math.max(0, COUNTDOWN_MS - elapsed);
      setSecondsLeft(Math.ceil(remaining / 1000));
      if (remaining <= 0) {
        endSession(true);
      }
    };
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [isLoggedIn, endSession]);

  // Keep the ref in sync so the interval closure reads the latest start time.
  useEffect(() => {
    warningStartedAtRef.current = warningStartedAt;
  }, [warningStartedAt]);

  const value = {
    sessionStartedAt,
    getLastActivity,
    endSession,
    warningActive: warningStartedAt != null,
  };

  return (
    <SessionContext.Provider value={value}>
      {children}
      {warningStartedAt != null && (
        <div className="session-warning" role="alertdialog" aria-modal="true" aria-labelledby="session-warning-title">
          <div className="session-warning__card">
            <h2 id="session-warning-title" className="session-warning__title">
              Still there?
            </h2>
            <p className="session-warning__body">
              You have been inactive for a while. For your security, Vorliq will sign you out of this
              browser in <strong>{secondsLeft}s</strong>. Your encrypted wallet backup stays on this
              device — you can sign back in any time.
            </p>
            <div className="session-warning__actions">
              <button type="button" className="button" onClick={stayActive}>
                Stay signed in
              </button>
              <button type="button" className="button secondary" onClick={() => endSession(true)}>
                Sign out now
              </button>
            </div>
          </div>
        </div>
      )}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSession must be used inside SessionProvider");
  }
  return context;
}
