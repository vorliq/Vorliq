// Standalone preview of the authenticated app shell, mounted at
// /preview/app/:section. The page-by-page migration of Dashboard, Wallet, Send,
// Mining, Lending, Governance, Faucet, and Settings into this shell is the next
// increment; until then each section shows a placeholder so the shell itself
// (sidebar, active states, wallet block, responsive tab bar) can be verified.
import { useParams } from "react-router-dom";

import "../../styles/vnext.css";
import AppShell, { APP_NAV } from "../../components/vnext/AppShell";
import { Card } from "../../components/vnext/primitives";

export default function AppShellDemo() {
  const { section } = useParams();
  const active = APP_NAV.find((item) => item.key === section)?.key || "dashboard";
  const label = APP_NAV.find((item) => item.key === active)?.label || "Dashboard";

  return (
    <AppShell active={active}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <h1 style={{ fontSize: "clamp(26px, 4vw, 36px)", fontWeight: 800, margin: 0 }}>{label}</h1>
        <span style={{ color: "var(--vn-text-2)", fontSize: "0.85rem" }}>App shell preview</span>
      </div>
      <span className="vn-underline" aria-hidden="true" style={{ marginBottom: 24 }} />
      <Card style={{ marginTop: 8 }}>
        <p style={{ color: "var(--vn-text-2)", lineHeight: 1.6, margin: 0 }}>
          This is the new application shell. The <strong style={{ color: "var(--vn-text)" }}>{label}</strong> page
          will be migrated into this layout in the next increment. The sidebar, active-item styling, wallet info
          block, and responsive tab bar are all live and theme-aware here.
        </p>
      </Card>
    </AppShell>
  );
}
