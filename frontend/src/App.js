import { useEffect, useRef, useState } from "react";
import { BrowserRouter, NavLink, Route, Routes } from "react-router-dom";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

import AnimatedBrandBackground from "./components/AnimatedBrandBackground";
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
import Health from "./pages/Health";
import Exchange from "./pages/Exchange";
import Governance from "./pages/Governance";
import Forum from "./pages/Forum";
import Leaderboard from "./pages/Leaderboard";
import Treasury from "./pages/Treasury";
import Price from "./pages/Price";
import Ambassador from "./pages/Ambassador";
import Chat from "./pages/Chat";
import Achievements from "./pages/Achievements";
import Transparency from "./pages/Transparency";
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
  { to: "/lending", label: "Lending" },
  { to: "/exchange", label: "Exchange" },
  { to: "/governance", label: "Governance" },
  { to: "/treasury", label: "Treasury" },
  { to: "/price", label: "Price" },
  { to: "/leaderboard", label: "Leaderboard" },
  { to: "/registry", label: "Registry" },
  { to: "/blockchain", label: "Blockchain" },
  { to: "/network", label: "Network" },
  { to: "/stats", label: "Stats" },
  { to: "/health", label: "Health" },
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
      { to: "/lending", label: "Lending" },
      { to: "/exchange", label: "Exchange" },
      { to: "/governance", label: "Governance" },
      { to: "/treasury", label: "Treasury" },
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
  const { glowMode, theme, toggleTheme } = useTheme();
  const { unreadCount } = useNotifications();
  const [backendOnline, setBackendOnline] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreMenuRef = useRef(null);

  useEffect(() => {
    document.body.classList.toggle("mobile-nav-open", mobileNavOpen);
    return () => document.body.classList.remove("mobile-nav-open");
  }, [mobileNavOpen]);

  useEffect(() => {
    function closeOnEscape(event) {
      if (event.key === "Escape") {
        setMobileNavOpen(false);
        setMoreOpen(false);
      }
    }

    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

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
                aria-label={glowMode === "full" ? "Reduce background glow" : "Restore full background glow"}
                title={glowMode === "full" ? "Reduce background glow" : "Restore full background glow"}
              >
                {glowMode === "full" ? <GlowIcon /> : <MoonIcon />}
              </button>
              <button
                className="icon-button notification-bell"
                type="button"
                onClick={() => setNotificationsOpen((open) => !open)}
                aria-label={notificationsOpen ? "Close notifications" : "Open notifications"}
                aria-expanded={notificationsOpen}
                aria-controls="notification-panel"
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

          <div className={`mobile-drawer ${mobileNavOpen ? "nav-open" : ""}`} id="mobile-navigation">
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
                aria-label={glowMode === "full" ? "Reduce background glow" : "Restore full background glow"}
                title={glowMode === "full" ? "Reduce background glow" : "Restore full background glow"}
              >
                {glowMode === "full" ? <GlowIcon /> : <MoonIcon />}
              </button>
              <button
                className="icon-button notification-bell"
                type="button"
                onClick={() => setNotificationsOpen((open) => !open)}
                aria-label={notificationsOpen ? "Close notifications" : "Open notifications"}
                aria-expanded={notificationsOpen}
                aria-controls="notification-panel"
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
        </div>
      </nav>

      <IncidentBanner />

      <main id="main-content" tabIndex="-1">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/wallet" element={<Wallet />} />
          <Route path="/send" element={<Send />} />
          <Route path="/blockchain" element={<Blockchain />} />
          <Route path="/mine" element={<Mine />} />
          <Route path="/whitepaper" element={<Whitepaper />} />
          <Route path="/network" element={<Network />} />
          <Route path="/lending" element={<Lending />} />
          <Route path="/exchange" element={<Exchange />} />
          <Route path="/governance" element={<Governance />} />
          <Route path="/treasury" element={<Treasury />} />
          <Route path="/price" element={<Price />} />
          <Route path="/forum" element={<Forum />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="/ambassador" element={<Ambassador />} />
          <Route path="/achievements" element={<Achievements />} />
          <Route path="/stats" element={<Stats />} />
          <Route path="/registry" element={<Registry />} />
          <Route path="/health" element={<Health />} />
          <Route path="/transparency" element={<Transparency />} />
          <Route path="/login" element={<Login />} />
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

function GlowIcon() {
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
