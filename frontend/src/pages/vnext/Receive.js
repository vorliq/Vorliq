// Standalone Receive route (/preview/app/receive) for the sidebar nav item.
// Shows the connected address with an enlarged theme-aware QR and a copy
// button — the same contents the Wallet page surfaces in its Receive modal.
import { Link } from "react-router-dom";

import "../../styles/vnext.css";
import AppShell from "../../components/vnext/AppShell";
import { Card } from "../../components/vnext/primitives";
import { ReceiveContents } from "./Wallet";
import { useAuth } from "../../context/AuthContext";

export default function Receive() {
  const { isLoggedIn, wallet } = useAuth();
  const address = wallet?.address;

  return (
    <AppShell active="receive">
      <div className="vn-page-head">
        <h1>Receive VLQ</h1>
      </div>
      <Card style={{ maxWidth: 480, margin: "0 auto" }}>
        {!isLoggedIn || !address ? (
          <p style={{ margin: 0, color: "var(--vn-text-2)" }}>
            <Link className="vn-block-link" to="/login">
              Sign in
            </Link>{" "}
            to view your address and receive QR code.
          </p>
        ) : (
          <ReceiveContents address={address} qrSize={240} />
        )}
      </Card>
    </AppShell>
  );
}
