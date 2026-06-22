// First-run onboarding tour state. Persisted in localStorage so the tour
// survives reloads and navigation and never restarts once a member has finished
// or dismissed it. Triggered only for a freshly created wallet (markWalletCreated
// sets a one-shot pending flag), so members who import or sign back in are not
// shown the new-member tour.

const STATE_KEY = "vorliq_onboarding_v1";
const PENDING_KEY = "vorliq_onboarding_pending";

// The five essential first actions, each a plain sentence about what it does and
// why it matters, plus where its button leads.
export const TOUR_STEPS = [
  {
    id: "faucet",
    title: "Get your first VLQ",
    body: "Your wallet starts empty. Claim a small amount of free VLQ from the community faucet so you have something to send, save, and vote with.",
    cta: "Open the faucet",
    to: "/faucet",
  },
  {
    id: "send",
    title: "Send VLQ to someone",
    body: "Sending is how value moves on Vorliq. Send a little VLQ to another address to see how a transaction is signed in your browser and confirmed on the chain.",
    cta: "Go to send",
    to: "/send",
  },
  {
    id: "explorer",
    title: "See the chain for yourself",
    body: "Every block and transfer is public. Open the block explorer to watch the chain update and verify your own activity — nothing is hidden behind a login.",
    cta: "Open the explorer",
    to: "/blockchain",
  },
  {
    id: "governance",
    title: "Have a say",
    body: "Vorliq is run by its members, not a company. Visit governance to see the open proposals and how the community votes on the rules together.",
    cta: "View governance",
    to: "/governance",
  },
  {
    id: "profile",
    title: "Make it yours",
    body: "Add a display name and picture so the community can recognise you in the forum and on your proposals. You stay in control of what is public.",
    cta: "Set up your profile",
    to: "/settings",
  },
];

const DEFAULT_STATE = { status: "active", stepIndex: 0 };

function read() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STATE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_error) {
    return null;
  }
}

function write(state) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch (_error) {
    /* storage unavailable — tour simply won't persist */
  }
}

// Flag a brand-new wallet so the dashboard knows to start the tour once.
export function markWalletCreated() {
  if (typeof window === "undefined") return;
  try {
    if (!read()) window.localStorage.setItem(PENDING_KEY, "true");
  } catch (_error) {
    /* ignore */
  }
}

// Resolve the tour state the dashboard should render. Starts the tour the first
// time a freshly created wallet reaches the dashboard; otherwise returns the
// stored state (which may be dismissed/completed, in which case nothing shows).
export function resolveTourState() {
  const stored = read();
  if (stored) return stored;
  if (typeof window !== "undefined" && window.localStorage.getItem(PENDING_KEY) === "true") {
    window.localStorage.removeItem(PENDING_KEY);
    write(DEFAULT_STATE);
    return { ...DEFAULT_STATE };
  }
  return null;
}

export function setTourStep(stepIndex) {
  const next = { status: "active", stepIndex };
  write(next);
  return next;
}

export function dismissTour() {
  const next = { status: "dismissed", stepIndex: read()?.stepIndex ?? 0 };
  write(next);
  return next;
}

export function completeTour() {
  const next = { status: "completed", stepIndex: TOUR_STEPS.length };
  write(next);
  return next;
}
