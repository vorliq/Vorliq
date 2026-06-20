// Authenticated app shell for the vnext design layer: a 240px desktop sidebar
// that collapses to a 64px icon rail on tablet and to a bottom tab bar on
// mobile (with a "More" drawer for overflow items). Styling lives in
// styles/vnext.css and rides the shared theme tokens, so dark/light just work.
import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  Download,
  Droplets,
  Landmark,
  LayoutDashboard,
  LogOut,
  MoreHorizontal,
  Pickaxe,
  Send,
  Settings,
  Vote,
  Wallet,
  X,
} from "lucide-react";

import logo from "../../assets/logo.png";
import { useAuth } from "../../context/AuthContext";
import { formatVlq } from "../../helpers/publicApi";
import { useSharedWalletBalance } from "../../context/WalletBalanceContext";
import ThemeToggle from "./ThemeToggle";

// Single source of truth for the app navigation.
export const APP_NAV = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "wallet", label: "Wallet", icon: Wallet },
  { key: "send", label: "Send", icon: Send },
  { key: "receive", label: "Receive", icon: Download },
  { key: "mining", label: "Mining", icon: Pickaxe },
  { key: "lending", label: "Lending", icon: Landmark },
  { key: "governance", label: "Governance", icon: Vote },
  { key: "faucet", label: "Faucet", icon: Droplets },
  { key: "settings", label: "Settings", icon: Settings },
];

// Five primary destinations for the mobile tab bar; the rest live under "More".
const PRIMARY_TABS = ["dashboard", "wallet", "send", "mining"];

// Primary app routes. The nav item key is not always the URL slug (e.g. the
// "mining" item lives at /mine), so map each key to its real route.
const ROUTE_FOR = {
  dashboard: "/dashboard",
  wallet: "/wallet",
  send: "/send",
  receive: "/receive",
  mining: "/mine",
  lending: "/lending",
  governance: "/governance",
  faucet: "/faucet",
  settings: "/settings",
};
const hrefFor = (key) => ROUTE_FOR[key] || `/${key}`;

function truncateAddress(address) {
  if (!address) return null;
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

// Sign the wallet out and return to the landing page. logout() locks the
// session and clears the in-memory wallet; navigating home means no app-shell
// page is left rendering a half-empty authenticated view after sign out.
function useLogout() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  return () => {
    logout();
    navigate("/");
  };
}

function WalletInfo() {
  const { wallet, isLoggedIn } = useAuth();
  const handleLogout = useLogout();
  // Show the spendable figure (available), matching the Wallet/Send pages, so
  // the sidebar never implies more is usable than the chain will actually allow.
  const { available: balance } = useSharedWalletBalance();

  if (!isLoggedIn) {
    return (
      <div className="vn-side__wallet">
        <div className="vn-side__addr">Not connected</div>
        <Link className="vn-side__disconnect" to="/login" style={{ marginTop: 10 }}>
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="vn-side__wallet">
      <div className="vn-side__addr" title={wallet?.address}>
        {truncateAddress(wallet?.address)}
      </div>
      <div className="vn-side__bal">
        {balance === undefined ? "…" : balance == null || Number.isNaN(balance) ? "Unavailable" : formatVlq(balance)}
      </div>
      <button type="button" className="vn-side__disconnect" onClick={handleLogout}>
        <LogOut size={14} aria-hidden="true" /> Disconnect
      </button>
    </div>
  );
}

function Sidebar({ active }) {
  return (
    <aside className="vn-side" aria-label="App navigation">
      <Link className="vn-side__brand" to="/">
        <img src={logo} alt="Vorliq logo" width="32" height="32" />
        <span>Vorliq</span>
      </Link>
      <nav className="vn-side__nav">
        {APP_NAV.map((item) => {
          const Icon = item.icon;
          const isActive = item.key === active;
          return (
            <Link
              key={item.key}
              to={hrefFor(item.key)}
              className={`vn-side__item ${isActive ? "is-active" : ""}`}
              aria-current={isActive ? "page" : undefined}
              data-tooltip={item.label}
            >
              <span className="vn-side__icon">
                <Icon size={19} aria-hidden="true" />
              </span>
              <span className="vn-side__label">{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <div style={{ padding: "0 12px 12px" }}>
        <ThemeToggle />
      </div>
      <WalletInfo />
    </aside>
  );
}

function MoreDrawer({ active, onClose }) {
  const overflow = APP_NAV.filter((item) => !PRIMARY_TABS.includes(item.key));
  const { wallet, isLoggedIn } = useAuth();
  const handleLogout = useLogout();
  return (
    <>
      <div className="vn-drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="vn-drawer" role="dialog" aria-modal="true" aria-label="More navigation">
        <div className="vn-drawer__head">
          <span style={{ fontWeight: 800 }}>More</span>
          <button type="button" className="vn-theme-toggle" aria-label="Close menu" onClick={onClose}>
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        {overflow.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.key}
              to={hrefFor(item.key)}
              className={`vn-nav__link ${item.key === active ? "is-active" : ""}`}
              onClick={onClose}
              style={{ display: "flex", alignItems: "center", gap: 12 }}
            >
              <Icon size={19} aria-hidden="true" /> {item.label}
            </Link>
          );
        })}
        <div className="vn-drawer__toggle">
          <ThemeToggle />
        </div>
        {/* Wallet identity + sign out — the desktop sidebar carries these, but
            the sidebar is hidden on mobile, so without this there was no way to
            log out on a phone. */}
        <div className="vn-drawer__account">
          {isLoggedIn ? (
            <>
              <div className="vn-side__addr" title={wallet?.address}>
                {truncateAddress(wallet?.address)}
              </div>
              <button
                type="button"
                className="vn-side__disconnect"
                onClick={() => {
                  onClose();
                  handleLogout();
                }}
              >
                <LogOut size={16} aria-hidden="true" /> Disconnect
              </button>
            </>
          ) : (
            <Link className="vn-side__disconnect" to="/login" onClick={onClose}>
              <LogOut size={16} aria-hidden="true" /> Sign in
            </Link>
          )}
        </div>
      </aside>
    </>
  );
}

function BottomTabBar({ active }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const tabs = PRIMARY_TABS.map((key) => APP_NAV.find((item) => item.key === key));
  const overflowActive = !PRIMARY_TABS.includes(active);

  return (
    <>
      <nav className="vn-tabbar" aria-label="App navigation">
        {tabs.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.key}
              to={hrefFor(item.key)}
              className={`vn-tab ${item.key === active ? "is-active" : ""}`}
            >
              <Icon size={20} aria-hidden="true" />
              {item.label}
            </Link>
          );
        })}
        <button
          type="button"
          className={`vn-tab ${overflowActive ? "is-active" : ""}`}
          onClick={() => setMoreOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
        >
          <MoreHorizontal size={20} aria-hidden="true" />
          More
        </button>
      </nav>
      {moreOpen && <MoreDrawer active={active} onClose={() => setMoreOpen(false)} />}
    </>
  );
}

export default function AppShell({ active, children }) {
  const location = useLocation();
  // Derive the active key from the URL if not explicitly provided.
  const derived =
    active || APP_NAV.find((item) => location.pathname === hrefFor(item.key))?.key || "dashboard";

  return (
    <div className="vnext vn-app">
      <Sidebar active={derived} />
      {/* The sidebar/tab bar are navigation; the content region is the single
          main landmark (App.js does not wrap standalone routes in a <main>). */}
      <main className="vn-app__main" id="main-content" tabIndex="-1">
        {children}
      </main>
      <BottomTabBar active={derived} />
    </div>
  );
}
