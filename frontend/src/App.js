import { useEffect, useState } from "react";
import { BrowserRouter, NavLink, Route, Routes } from "react-router-dom";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

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

const navSections = [
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
      { to: "/lending", label: "Lending" },
      { to: "/exchange", label: "Exchange" },
      { to: "/governance", label: "Governance" },
      { to: "/treasury", label: "Treasury" },
      { to: "/price", label: "Price" },
      { to: "/forum", label: "Forum" },
      { to: "/chat", label: "Chat" },
      { to: "/leaderboard", label: "Leaderboard" },
      { to: "/registry", label: "Registry" },
    ],
  },
  {
    title: "Network",
    links: [
      { to: "/blockchain", label: "Blockchain" },
      { to: "/network", label: "Network" },
      { to: "/stats", label: "Stats" },
      { to: "/health", label: "Health" },
      { to: "/transparency", label: "Transparency" },
      { to: "/whitepaper", label: "Whitepaper" },
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
  const [backendOnline, setBackendOnline] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  useEffect(() => {
    const hamburger = document.querySelector(".hamburger");
    const navMenu = document.querySelector(".nav-links");

    function toggleMenu() {
      navMenu?.classList.toggle("nav-open");
      hamburger?.classList.toggle("is-open");
      const isOpen = navMenu?.classList.contains("nav-open") || false;
      hamburger?.setAttribute("aria-expanded", String(isOpen));
      document.body.classList.toggle("mobile-nav-open", isOpen);
    }

    function closeMobileMenu() {
      navMenu?.classList.remove("nav-open");
      hamburger?.classList.remove("is-open");
      hamburger?.setAttribute("aria-expanded", "false");
      document.body.classList.remove("mobile-nav-open");
    }

    function closeMenu(event) {
      if (event.target.closest("a") || event.target.closest(".nav-button")) {
        closeMobileMenu();
      }
    }

    function closeOnOutsideClick(event) {
      if (!navMenu?.classList.contains("nav-open")) {
        return;
      }

      if (!event.target.closest(".navbar-inner")) {
        closeMobileMenu();
      }
    }

    function closeOnEscape(event) {
      if (event.key === "Escape") {
        closeMobileMenu();
      }
    }

    hamburger?.addEventListener("click", toggleMenu);
    navMenu?.addEventListener("click", closeMenu);
    document.addEventListener("click", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      hamburger?.removeEventListener("click", toggleMenu);
      navMenu?.removeEventListener("click", closeMenu);
      document.removeEventListener("click", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
      document.body.classList.remove("mobile-nav-open");
    };
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
            className="hamburger"
            type="button"
            aria-label="Open navigation menu"
            aria-expanded="false"
          >
            <span />
            <span />
            <span />
          </button>

          <div className="nav-links">
            {navSections.map((section) => (
              <div className="nav-section" key={section.title}>
                <span className="nav-section-title">{section.title}</span>
                {section.links.map((link) => (
                  <NavLink className="nav-link" to={link.to} end={link.end} key={link.to}>
                    {link.label}
                  </NavLink>
                ))}
              </div>
            ))}

            <div className="nav-tools">
              <button
                className="icon-button"
                type="button"
                onClick={toggleTheme}
                aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              >
                {theme === "dark" ? <SunIcon /> : <MoonIcon />}
              </button>
              <button
                className="icon-button notification-bell"
                type="button"
                onClick={() => setNotificationsOpen((open) => !open)}
                aria-label="Open notifications"
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

      <IncidentBanner />

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

export { navSections };

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
