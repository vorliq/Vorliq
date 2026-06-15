// Wallet page inside the new app shell (/preview/app/wallet). Shows the full
// connected address (copyable) with a theme-aware QR, the full VLQ balance in
// large centered text (reusing the shared balance hook), and Send / Receive
// actions — Receive opens a centered modal, Send reveals the inline SendForm.
import { useState } from "react";
import { Link } from "react-router-dom";
import { Download, Send as SendIcon } from "lucide-react";

import "../../styles/vnext.css";
import AppShell from "../../components/vnext/AppShell";
import Modal from "../../components/vnext/Modal";
import SendForm from "../../components/vnext/SendForm";
import WalletQR from "../../components/vnext/WalletQR";
import { Button, Card, CopyButton, InlineError, Skeleton } from "../../components/vnext/primitives";
import { useAuth } from "../../context/AuthContext";
import { formatVlq } from "../../helpers/publicApi";
import useWalletBalance from "../../helpers/useWalletBalance";

function ReceiveContents({ address, qrSize }) {
  return (
    <div className="vn-receive">
      <WalletQR address={address} size={qrSize} />
      <div className="vn-receive__addr vn-mono">{address}</div>
      <CopyButton value={address} label="Copy address" />
    </div>
  );
}

export default function Wallet() {
  const { isLoggedIn, wallet } = useAuth();
  const address = wallet?.address;
  const { balance, loading, error, reload } = useWalletBalance(address);

  const [showSend, setShowSend] = useState(false);
  const [showReceive, setShowReceive] = useState(false);

  if (!isLoggedIn || !address) {
    return (
      <AppShell active="wallet">
        <div className="vn-page-head">
          <h1>Wallet</h1>
        </div>
        <Card>
          <p style={{ margin: 0, color: "var(--vn-text-2)" }}>
            <Link className="vn-block-link" to="/login">
              Sign in
            </Link>{" "}
            to view your wallet address, balance, and send or receive VLQ.
          </p>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell active="wallet">
      <div className="vn-page-head">
        <h1>Wallet</h1>
      </div>

      {/* Address card with QR */}
      <Card className="vn-wallet-card">
        <span className="vn-overline">Your wallet address</span>
        <div className="vn-wallet-card__addr vn-mono">{address}</div>
        <CopyButton value={address} label="Copy address" />
        <div className="vn-wallet-card__qr">
          <WalletQR address={address} size={180} />
        </div>
      </Card>

      {/* Big balance */}
      <div className="vn-balance">
        {error ? (
          <InlineError message={error} onRetry={reload} />
        ) : loading ? (
          <Skeleton height={56} width="280px" style={{ margin: "0 auto" }} />
        ) : (
          <div className="vn-balance__value">{balance == null ? "Unavailable" : formatVlq(balance)}</div>
        )}
        <div className="vn-balance__label">Confirmed balance</div>
      </div>

      {/* Actions */}
      <div className="vn-wallet-actions">
        <Button
          variant="primary"
          size="lg"
          onClick={() => {
            setShowSend((v) => !v);
            setShowReceive(false);
          }}
        >
          <SendIcon size={18} aria-hidden="true" /> Send VLQ
        </Button>
        <Button variant="secondary" size="lg" onClick={() => setShowReceive(true)}>
          <Download size={18} aria-hidden="true" /> Receive VLQ
        </Button>
      </div>

      {/* Inline send form */}
      {showSend && (
        <Card style={{ marginTop: 18 }}>
          <h2 className="vn-panel-title">Send VLQ</h2>
          <SendForm />
        </Card>
      )}

      {/* Receive modal */}
      {showReceive && (
        <Modal title="Receive VLQ" onClose={() => setShowReceive(false)}>
          <ReceiveContents address={address} qrSize={240} />
        </Modal>
      )}
    </AppShell>
  );
}

export { ReceiveContents };
