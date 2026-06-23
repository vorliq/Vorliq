// A best-effort device fingerprint for faucet abuse defence: a SHA-256 hash of
// the browser's user agent, screen dimensions, timezone, language, and a canvas
// fingerprint. It is sent with a faucet claim so the server can reject a second
// claim from the same device within the cooldown, no matter which wallet is used.
// It is not a tracking identifier — it is only ever hashed and only used at the
// faucet to stop casual multi-wallet abuse from one phone or computer.

async function sha256Hex(input) {
  const data = new TextEncoder().encode(input);
  const digest = await window.crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function canvasFingerprint() {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 240;
    canvas.height = 40;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "no-canvas";
    ctx.textBaseline = "top";
    ctx.font = "14px 'Arial'";
    ctx.fillStyle = "#f60";
    ctx.fillRect(0, 0, 100, 20);
    ctx.fillStyle = "#069";
    ctx.fillText("Vorliq faucet ✨ fingerprint", 2, 2);
    ctx.fillStyle = "rgba(86,200,112,0.7)";
    ctx.fillText("Vorliq faucet ✨ fingerprint", 4, 4);
    return canvas.toDataURL();
  } catch (error) {
    return "canvas-error";
  }
}

export async function deviceFingerprint() {
  try {
    const screen = window.screen || {};
    const parts = [
      navigator.userAgent || "",
      `${screen.width || 0}x${screen.height || 0}x${screen.colorDepth || 0}`,
      (Intl.DateTimeFormat().resolvedOptions().timeZone || "") + ":" + new Date().getTimezoneOffset(),
      navigator.language || "",
      canvasFingerprint(),
    ];
    return await sha256Hex(parts.join("|"));
  } catch (error) {
    return "";
  }
}

export default deviceFingerprint;
