import { useEffect, useState } from "react";
import { BrowserRouter, NavLink, Route, Routes } from "react-router-dom";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

import ProtectedRoute from "./components/ProtectedRoute";
import { AuthProvider, useAuth } from "./context/AuthContext";
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
import Footer from "./components/Footer";
import api from "./helpers/api";
import logo from "./logo.svg";

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppShell />
      </BrowserRouter>
    </AuthProvider>
  );
}

function AppShell() {
  const { isLoggedIn, logout, wallet } = useAuth();
  const [backendOnline, setBackendOnline] = useState(false);

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

          <div className="nav-links">
            <NavLink className="nav-link" to="/" end>
              Dashboard
            </NavLink>
            <NavLink className="nav-link" to="/wallet">
              Wallet
            </NavLink>
            <NavLink className="nav-link" to="/send">
              Send
            </NavLink>
            <NavLink className="nav-link" to="/blockchain">
              Blockchain
            </NavLink>
            <NavLink className="nav-link" to="/mine">
              Mine
            </NavLink>
            <NavLink className="nav-link" to="/whitepaper">
              Whitepaper
            </NavLink>
            <NavLink className="nav-link" to="/network">
              Network
            </NavLink>
            <NavLink className="nav-link" to="/lending">
              Lending
            </NavLink>
            <NavLink className="nav-link" to="/stats">
              Stats
            </NavLink>
            <NavLink className="nav-link" to="/registry">
              Registry
            </NavLink>
            <NavLink className="nav-link" to="/health">
              Health
            </NavLink>

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

      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/wallet" element={<Wallet />} />
        <Route path="/send" element={<Send />} />
        <Route path="/blockchain" element={<Blockchain />} />
        <Route path="/mine" element={<Mine />} />
        <Route path="/whitepaper" element={<Whitepaper />} />
        <Route path="/network" element={<Network />} />
        <Route path="/lending" element={<Lending />} />
        <Route path="/stats" element={<Stats />} />
        <Route path="/registry" element={<Registry />} />
        <Route path="/health" element={<Health />} />
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

      <ToastContainer
        className="toast"
        position="top-right"
        theme="dark"
        autoClose={3600}
        closeOnClick
        pauseOnHover
      />
    </div>
  );
}

export default App;
