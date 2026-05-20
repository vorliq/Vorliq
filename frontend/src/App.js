import { useEffect, useRef, useState } from "react";
import { BrowserRouter, NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

import AnimatedBrandBackground from "./components/AnimatedBrandBackground";
import AnalyticsRouteTracker from "./components/AnalyticsRouteTracker";
import NotificationPanel from "./components/NotificationPanel";
import Onboarding from "./components/Onboarding";
import ProtectedRoute from "./components/ProtectedRoute";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { NotificationProvider, useNotifications } from "./context/NotificationContext";
import { ThemeProvider, useTheme } from "./context/ThemeContext";
import Dashboard from "./pages/Dashboard";
import Wallet from "./pages/Wallet";
import Send from "./pages/Send";
import Blockchain from "./pages/Blockchain";
import Mine from "./pages/Mine";
import Whitepaper from "./pages/Whitepaper";
import Network from "./pages/Network";
import Lending from "./pages/Lending";
import Stats from "./pages/Stats";
import Registry from "./pages/Registry";
import Login from "./pages/Login";
import Account from "./pages/Account";
import Profile from "./pages/Profile";
import Health from "./pages/Health";
import Exchange from "./pages/Exchange";
import Governance from "./pages/Governance";
import Growth from "./pages/Growth";
import Forum from "./pages/Forum";
import Leaderboard from "./pages/Leaderboard";
import Treasury from "./pages/Treasury";
import Faucet from "./pages/Faucet";
import Price from "./pages/Price";
import Ambassador from "./pages/Ambassador";
import Chat from "./pages/Chat";
import Achievements from "./pages/Achievements";
import Transparency from "./pages/Transparency";
import Admin from "./pages/Admin";
import Notifications from "./pages/Notifications";
import TransactionDetail from "./pages/TransactionDetail";
import BlockDetail from "./pages/BlockDetail";
import Footer from "./components/Footer";
import IncidentBanner from "./components/IncidentBanner";
import api from "./helpers/api";
import logo from "./assets/logo.png";

const primaryLinks = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/wallet", label: "Wallet" },
  { to: "/send", label: "Send" },
  { to: "/mine", label: "Mine" },
  { to: "/forum", label: "Forum" },
];

const moreLinks = [
  { to: "/chat", label: "Chat" },
  { to: "/profile", label: "Profiles" },
  { to: "/lending", label: "Lending" },
  { to: "/exchange", label: "Exchange" },
  { to: "/governance", label: "Governance" },
  { to: "/treasury", label: "Treasury" },
  { to: "/faucet", label: "Faucet" },
  { to: "/price", label: "Price" },
  { to: "/leaderboard", label: "Leaderboard" },
  { to: "/registry", label: "Registry" },
  { to: "/blockchain", label: "Blockchain" },
  { to: "/network", label: "Network" },
  { to: "/stats", label: "Stats" },
  { to: "/health", label: "Health" },
  { to: "/growth", label: "Growth" },
  { to: "/transparency", label: "Transparency" },
  { to: "/whitepaper", label: "Whitepaper" },
];

const mobileNavSections = [
  {
    title: "Core",
    links: [
      { to: "/", label: "Dashboard", end: true },
      { to: "/wallet", label: "Wallet" },
      { to: "/send", label: "Send" },
      { to: "/mine", label: "Mine" },
    ],
  },
  {
    title: "Community",
    links: [
      { to: "/forum", label: "Forum" },
      { to: "/chat", label: "Chat" },
      { to: "/profile", label: "Profiles" },
      { to: "/lending", label: "Lending" },
      { to: "/exchange", label: "Exchange" },
      { to: "/governance", label: "Governance" },
      { to: "/treasury", label: "Treasury" },
      { to: "/faucet", label: "Faucet" },
    ],
  },
  {
    title: "Network",
    links: [
      { to: "/blockchain", label: "Blockchain" },
      { to: "/network", label: "Network" },
      { to: "/registry", label: "Registry" },
      { to: "/stats", label: "Stats" },
      { to: "/leaderboard", label: "Leaderboard" },
      { to: "/health", label: "Health" },
    ],
  },
  {
    title: "Trust",
    links: [
      { to: "/transparency", label: "Transparency" },
      { to: "/whitepaper", label: "Whitepaper" },
      { href: "https://vorliq.github.io/Vorliq/wallet-safety.html", label: "Wallet Safety" },
      { href: "https://vorliq.github.io/Vorliq/terms.html#risk-notice", label: "Risk Notice" },
    ],
  },
];

function App() {
  return (
    <ThemeProvider>
      <NotificationProvider>
        <AuthProvider>
          <BrowserRouter>
            <AppShell />
          </BrowserRouter>
        </AuthProvider>
      </NotificationProvider>
    </ThemeProvider>
  );
}

function AppShell() {
  const { isLoggedIn, logout, wallet } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { unreadCount } = useNotifications();
  const navigate = useNavigate();
  const [backendOnline, setBackendOnline] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreMenuRef = useRef(null);
  const mobileDrawerRef = useRef(null);
  const hamburgerRef = useRef(null);

  useEffect(() => {
    document.body.classList.toggle("mobile-nav-open", mobileNavOpen);
    return () => document.body.classList.remove("mobile-nav-open");
  }, [mobileNavOpen]);

  useEffect(() => {
    function getDrawerFocusTargets() {
      if (!mobileDrawerRef.current) return [];
      return Array.from(
        mobileDrawerRef.current.querySelectorAll(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );
    }

    function closeOnKeyboard(event) {
      if (event.key === "Escape") {
        setMobileNavOpen(false);
        setMoreOpen(false);
        if (mobileNavOpen && hamburgerRef.current) {
          hamburgerRef.current.focus();
        }
        return;
      }

      if (event.key === "Tab" && mobileNavOpen) {
        const focusTargets = getDrawerFocusTargets();
        if (!focusTargets.length) return;

        const firstTarget = focusTargets[0];
        const lastTarget = focusTargets[focusTargets.length - 1];

        if (event.shiftKey && document.activeElement === firstTarget) {
          event.preventDefault();
          lastTarget.focus();
        } else if (!event.shiftKey && document.activeElement === lastTarget) {
          event.preventDefault();
          firstTarget.focus();
        }
      }
    }

    document.addEventListener("keydown", closeOnKeyboard);
    return () => {
      document.removeEventListener("keydown", closeOnKeyboard);
    };
  }, [mobileNavOpen]);

  useEffect(() => {
    if (!mobileNavOpen || !mobileDrawerRef.current) return undefined;

    const focusTarget = mobileDrawerRef.current.querySelector("a, button");
    const focusTimer = window.setTimeout(() => {
      if (focusTarget) {
        focusTarget.focus();
      }
    }, 0);

    return () => window.clearTimeout(focusTimer);
  }, [mobileNavOpen]);

  useEffect(() => {
    function closeMoreOnOutsideClick(event) {
      if (moreMenuRef.current && !moreMenuRef.current.contains(event.target)) {
        setMoreOpen(false);
      }
    }

    document.addEventListener("pointerdown", closeMoreOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeMoreOnOutsideClick);
  }, []);

  useEffect(() => {
    let mounted = true;

    async function checkHealth() {
      try {
        const response = await api.get("/health", { timeout: 5000 });
        if (mounted) {
          setBackendOnline(Boolean(response.data?.success));
        }
      } catch (error) {
        if (mounted) {
          setBackendOnline(false);
        }
      }
    }

    checkHealth();
    const interval = window.setInterval(checkHealth, 15000);
    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, []);

  return (
    <div className="app-shell">
      <AnimatedBrandBackground />
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <nav className="navbar">
        <div className="navbar-inner">
          <NavLink className="brand" to="/">
            <img className="brand-logo" src={logo} alt="Vorliq logo" />
            <span
              className={`connection-dot ${backendOnline ? "online" : "offline"}`}
              title={backendOnline ? "all systems running" : "backend offline"}
              aria-label={backendOnline ? "all systems running" : "backend offline"}
            />
            <span>Vorliq</span>
          </NavLink>

          <button
            className={`hamburger ${mobileNavOpen ? "is-open" : ""}`}
            type="button"
            ref={hamburgerRef}
            aria-label={mobileNavOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={mobileNavOpen}
            aria-controls="mobile-navigation"
            onClick={() => setMobileNavOpen((open) => !open)}
          >
            <span />
            <span />
            <span />
          </button>

          <div className="desktop-navigation" id="primary-navigation">
            <div className="primary-links" aria-label="Primary navigation">
              {primaryLinks.map((link) => (
                <NavLink className="nav-link" to={link.to} end={link.end} key={link.to}>
                  {link.label}
                </NavLink>
              ))}
              <div className="more-menu" ref={moreMenuRef}>
                <button
                  className={`nav-link more-trigger ${moreOpen ? "active" : ""}`}
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={moreOpen}
                  aria-controls="more-navigation"
                  onClick={() => setMoreOpen((open) => !open)}
                >
                  More
                  <span aria-hidden="true">+</span>
                </button>
                <div
                  className={`more-dropdown ${moreOpen ? "open" : ""}`}
                  id="more-navigation"
                  role="menu"
                  aria-label="More navigation"
                >
                  {moreLinks.map((link) => (
                    <NavLink
                      className="more-link"
                      to={link.to}
                      role="menuitem"
                      key={link.to}
                      onClick={() => setMoreOpen(false)}
                    >
                      {link.label}
                    </NavLink>
                  ))}
                </div>
              </div>
            </div>

            <div className="nav-tools">
              <button
                className="icon-button"
                type="button"
                onClick={toggleTheme}
                aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
                aria-pressed={theme === "light"}
                title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              >
                {theme === "dark" ? <SunIcon /> : <MoonIcon />}
              </button>
              <button
                className="icon-button notification-bell"
                type="button"
                onClick={() => {
                  setNotificationsOpen(false);
                  navigate("/notifications");
                }}
                aria-label="Open notifications page"
                title="Notifications"
              >
                <BellIcon />
                {unreadCount > 0 && <span className="notification-badge">{unreadCount}</span>}
              </button>
            </div>

            <div className="auth-actions">
              {isLoggedIn ? (
                <>
                  <NavLink className="wallet-chip" to="/account">
                    {wallet.address.slice(0, 12)}
                  </NavLink>
                  <button className="button secondary nav-button" type="button" onClick={logout}>
                    Logout
                  </button>
                </>
              ) : (
                <NavLink className="button nav-button" to="/login">
                  Login
                </NavLink>
              )}
            </div>
          </div>

        </div>
      </nav>

      <div
        className={`mobile-drawer-backdrop ${mobileNavOpen ? "nav-open" : ""}`}
        aria-hidden="true"
        onClick={() => {
          setMobileNavOpen(false);
          hamburgerRef.current?.focus();
        }}
      />

      <div
        className={`mobile-drawer ${mobileNavOpen ? "nav-open" : ""}`}
        id="mobile-navigation"
        ref={mobileDrawerRef}
        role={mobileNavOpen ? "dialog" : undefined}
        aria-modal={mobileNavOpen ? "true" : undefined}
        aria-label={mobileNavOpen ? "Navigation menu" : undefined}
        aria-hidden={!mobileNavOpen}
      >
        {mobileNavSections.map((section) => (
          <div className="nav-section" key={section.title}>
            <span className="nav-section-title">{section.title}</span>
            {section.links.map((link) =>
              link.to ? (
                <NavLink
                  className="nav-link"
                  to={link.to}
                  end={link.end}
                  key={link.to}
                  onClick={() => setMobileNavOpen(false)}
                >
                  {link.label}
                </NavLink>
              ) : (
                <a
                  className="nav-link"
                  href={link.href}
                  target="_blank"
                  rel="noreferrer"
                  key={link.href}
                  onClick={() => setMobileNavOpen(false)}
                >
                  {link.label}
                </a>
              )
            )}
          </div>
        ))}

        <div className="mobile-drawer-tools">
          <button
            className="icon-button"
            type="button"
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            aria-pressed={theme === "light"}
            title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          >
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
          </button>
          <button
            className="icon-button notification-bell"
            type="button"
            onClick={() => {
              setMobileNavOpen(false);
              setNotificationsOpen(false);
              navigate("/notifications");
            }}
            aria-label="Open notifications page"
            title="Notifications"
          >
            <BellIcon />
            {unreadCount > 0 && <span className="notification-badge">{unreadCount}</span>}
          </button>
        </div>

        <div className="mobile-auth-actions">
          {isLoggedIn ? (
            <>
              <NavLink className="wallet-chip" to="/account" onClick={() => setMobileNavOpen(false)}>
                {wallet.address.slice(0, 12)}
              </NavLink>
              <button
                className="button secondary nav-button"
                type="button"
                onClick={() => {
                  logout();
                  setMobileNavOpen(false);
                }}
              >
                Logout
              </button>
            </>
          ) : (
            <NavLink className="button nav-button" to="/login" onClick={() => setMobileNavOpen(false)}>
              Login
            </NavLink>
          )}
        </div>
      </div>

      <IncidentBanner />
      <AnalyticsRouteTracker />

      <main id="main-content" tabIndex="-1">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/wallet" element={<Wallet />} />
          <Route path="/send" element={<Send />} />
          <Route path="/blockchain" element={<Blockchain />} />
          <Route path="/tx/:txId" element={<TransactionDetail />} />
          <Route path="/block/:blockId" element={<BlockDetail />} />
          <Route path="/mine" element={<Mine />} />
          <Route path="/whitepaper" element={<Whitepaper />} />
          <Route path="/network" element={<Network />} />
          <Route path="/lending" element={<Lending />} />
          <Route path="/exchange" element={<Exchange />} />
          <Route path="/governance" element={<Governance />} />
          <Route path="/treasury" element={<Treasury />} />
          <Route path="/faucet" element={<Faucet />} />
          <Route path="/price" element={<Price />} />
          <Route path="/forum" element={<Forum />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="/ambassador" element={<Ambassador />} />
          <Route path="/achievements" element={<Achievements />} />
          <Route path="/stats" element={<Stats />} />
          <Route path="/registry" element={<Registry />} />
          <Route path="/health" element={<Health />} />
          <Route path="/growth" element={<Growth />} />
          <Route path="/transparency" element={<Transparency />} />
          <Route path="/login" element={<Login />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route
            path="/account"
            element={
              <ProtectedRoute>
                <Account />
              </ProtectedRoute>
            }
          />
        </Routes>
      </main>

      <Footer />
      <Onboarding />
      <NotificationPanel open={notificationsOpen} onClose={() => setNotificationsOpen(false)} />

      <ToastContainer
        className="toast"
        position="top-right"
        theme={theme}
        autoClose={3600}
        closeOnClick
        pauseOnHover
      />
    </div>
  );
}

export { mobileNavSections as navSections, moreLinks, primaryLinks };

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="M4.93 4.93l1.41 1.41" />
      <path d="M17.66 17.66l1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="M4.93 19.07l1.41-1.41" />
      <path d="M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 12.8A8.5 8.5 0 1 1 11.2 3 6.6 6.6 0 0 0 21 12.8Z" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

export default App;
