// Standalone Send route (/preview/app/send), mirroring the existing app where
// Send is its own route. Reuses the same SendForm used inline on the Wallet
// page, so there is one send + status mechanism, not two.
import "../../styles/vnext.css";
import AppShell from "../../components/vnext/AppShell";
import SendForm from "../../components/vnext/SendForm";
import { Card } from "../../components/vnext/primitives";

export default function Send() {
  return (
    <AppShell active="send">
      <div className="vn-page-head">
        <h1>Send VLQ</h1>
        <div className="vn-page-head__meta">Signed locally in your browser</div>
      </div>
      <Card style={{ maxWidth: 560 }}>
        <SendForm />
      </Card>
    </AppShell>
  );
}
