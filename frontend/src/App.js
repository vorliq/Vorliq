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
import Login from "./pages/Login";
import Account from "./pages/Account";
import Footer from "./components/Footer";
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

  return (
    <div className="app-shell">
      <nav className="navbar">
        <div className="navbar-inner">
          <NavLink className="brand" to="/">
            <img className="brand-logo" src={logo} alt="Vorliq logo" />
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
