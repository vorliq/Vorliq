import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { QrReader } from "react-qr-reader";
import { toast } from "react-toastify";

function buildPaymentUrl(walletAddress, amount) {
  const query = new URLSearchParams({ to: walletAddress || "" });
  if (amount !== undefined && amount !== null && String(amount).trim()) {
    query.set("amount", String(amount).trim());
  }
  return `vorliq://pay?${query.toString()}`;
}

export function parseVorliqPaymentUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "vorliq:" || url.hostname !== "pay") {
      return null;
    }

    const to = url.searchParams.get("to");
    const amount = url.searchParams.get("amount") || "";
    if (!to) {
      return null;
    }

    return { to, amount };
  } catch {
    return null;
  }
}

function QRPayment({ walletAddress, amount = "", onScanComplete, defaultScanMode = false }) {
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [scanMode, setScanMode] = useState(defaultScanMode);
  const [lastScan, setLastScan] = useState("");
  const paymentUrl = useMemo(() => buildPaymentUrl(walletAddress, amount), [walletAddress, amount]);

  useEffect(() => {
    let mounted = true;

    async function renderQr() {
      if (!walletAddress) {
        setQrDataUrl("");
        return;
      }

      const dataUrl = await QRCode.toDataURL(paymentUrl, {
        errorCorrectionLevel: "M",
        margin: 2,
        width: 260,
        color: {
          dark: "#111111",
          light: "#ffffff",
        },
      });

      if (mounted) {
        setQrDataUrl(dataUrl);
      }
    }

    renderQr();

    return () => {
      mounted = false;
    };
  }, [paymentUrl, walletAddress]);

  function handleScan(result) {
    const scannedText = result?.text;
    if (!scannedText || scannedText === lastScan) {
      return;
    }

    setLastScan(scannedText);
    const payment = parseVorliqPaymentUrl(scannedText);
    if (!payment) {
      toast.error("That QR code is not a Vorliq payment request.");
      return;
    }

    onScanComplete?.(payment);
    setScanMode(false);
    toast.success("Vorliq payment QR code scanned.");
  }

  return (
    <div className="qr-payment">
      <div className="section-title">
        <h3>{scanMode ? "Scan Payment QR" : "Vorliq Payment QR"}</h3>
        <button className="button secondary compact" type="button" onClick={() => setScanMode((current) => !current)}>
          {scanMode ? "Show QR" : "Scan QR Code"}
        </button>
      </div>

      {scanMode ? (
        <div className="qr-scanner">
          <QrReader
            constraints={{ facingMode: "environment" }}
            onResult={(result) => handleScan(result)}
            containerStyle={{ width: "100%" }}
            videoStyle={{ borderRadius: 8 }}
          />
          <p className="help-text">Point your camera at a Vorliq payment QR code.</p>
        </div>
      ) : qrDataUrl ? (
        <div className="qr-image-wrap">
          <img src={qrDataUrl} alt="Vorliq payment QR code" />
          <span>scan to receive VLQ</span>
        </div>
      ) : (
        <div className="empty-state">Enter or create a wallet address to generate a payment QR code.</div>
      )}
    </div>
  );
}

export default QRPayment;
