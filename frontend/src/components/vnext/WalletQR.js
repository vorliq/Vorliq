// Client-side QR for a wallet address, encoded as the same vorliq://pay URL the
// existing app's scanner understands. Contrast is theme-aware so the code stays
// scannable in both modes: dark modules on a light field in light mode, light
// modules on a dark field in dark mode (not white-on-card regardless of theme).
import { useEffect, useState } from "react";
import QRCode from "qrcode";

function paymentUrl(address) {
  return `vorliq://pay?to=${encodeURIComponent(address || "")}`;
}

// Track the live data-theme attribute so the QR re-renders when the user toggles.
function useThemeName() {
  const [theme, setTheme] = useState(() =>
    typeof document !== "undefined" ? document.documentElement.getAttribute("data-theme") || "dark" : "dark"
  );
  useEffect(() => {
    if (typeof MutationObserver === "undefined") return undefined;
    const observer = new MutationObserver(() =>
      setTheme(document.documentElement.getAttribute("data-theme") || "dark")
    );
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return theme;
}

export default function WalletQR({ address, size = 200 }) {
  const theme = useThemeName();
  const [dataUrl, setDataUrl] = useState("");

  useEffect(() => {
    let active = true;
    if (!address) {
      setDataUrl("");
      return undefined;
    }
    const isLight = theme === "light";
    QRCode.toDataURL(paymentUrl(address), {
      errorCorrectionLevel: "M",
      margin: 2,
      width: size * 2, // render at 2x for crispness, displayed at `size`
      color: {
        // dark = module colour, light = background colour
        dark: isLight ? "#080b14" : "#e6edf6",
        light: isLight ? "#ffffff" : "#0d1628",
      },
    })
      .then((url) => {
        if (active) setDataUrl(url);
      })
      .catch(() => {
        if (active) setDataUrl("");
      });
    return () => {
      active = false;
    };
  }, [address, theme, size]);

  if (!address) {
    return (
      <div className="vn-qr vn-qr--empty" style={{ width: size, height: size }}>
        No address
      </div>
    );
  }
  if (!dataUrl) {
    return <div className="vn-qr vn-skel" style={{ width: size, height: size }} aria-hidden="true" />;
  }
  return (
    <img
      className="vn-qr"
      src={dataUrl}
      alt="Wallet address QR code"
      width={size}
      height={size}
      style={{ width: size, height: size }}
    />
  );
}
