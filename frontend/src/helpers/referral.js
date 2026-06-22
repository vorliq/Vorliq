import api from "./api";

// Member invite links. A link is just the site URL with the referrer's wallet
// address in a `ref` query param, so it is a plain URL anyone can paste into any
// messaging app and it works on any device or browser — there is nothing stored
// on the sender's device that the recipient needs. When a new visitor lands with
// a `ref`, we remember it locally; when they create their wallet we record the
// relationship against the new member. Recording is best-effort and the backend
// is the source of truth (it validates the referrer actually exists on chain).
const STORAGE_KEY = "vorliq_referrer";
// Vorliq addresses are base58 (~27-34 chars). Be lenient here — this only guards
// against obviously bogus query values; the backend does the real validation.
const ADDRESS_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{20,48}$/;

export function captureReferrerFromUrl() {
  try {
    const ref = (new URLSearchParams(window.location.search).get("ref") || "").trim();
    // Keep the first referrer we ever see for this browser; never overwrite it.
    if (ref && ADDRESS_PATTERN.test(ref) && !localStorage.getItem(STORAGE_KEY)) {
      localStorage.setItem(STORAGE_KEY, ref);
    }
  } catch (error) {
    // Storage may be unavailable (private mode); invites are non-critical.
  }
}

export function storedReferrer() {
  try {
    return localStorage.getItem(STORAGE_KEY) || "";
  } catch (error) {
    return "";
  }
}

export function clearStoredReferrer() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    /* ignore */
  }
}

// Called once, right after a brand-new wallet is created. If this browser
// followed an invite link, record the new member against that referrer. Always
// clears the stored referrer afterwards so it is only ever used once.
export async function recordReferralForNewWallet(newAddress) {
  const referrer = storedReferrer();
  if (!referrer || !newAddress || referrer === newAddress) {
    clearStoredReferrer();
    return;
  }
  try {
    await api.post("/invites/record", { wallet_address: newAddress, referrer_address: referrer });
  } catch (error) {
    // Best-effort: a non-existent referrer or a transient failure simply means no
    // relationship is recorded. It must never block wallet creation.
  } finally {
    clearStoredReferrer();
  }
}

export function inviteLinkFor(address) {
  const origin =
    (typeof window !== "undefined" && window.location && window.location.origin) || "https://vorliq.org";
  return `${origin}/?ref=${encodeURIComponent(String(address || ""))}`;
}
