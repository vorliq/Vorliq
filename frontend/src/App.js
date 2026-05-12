import { BrowserRouter, NavLink, Route, Routes } from "react-router-dom";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

import Dashboard from "./pages/Dashboard";
import Wallet from "./pages/Wallet";
import Send from "./pages/Send";
import Blockchain from "./pages/Blockchain";
import Mine from "./pages/Mine";
import Whitepaper from "./pages/Whitepaper";
import Footer from "./components/Footer";
import logo from "./logo.svg";

function App() {
  return (
    <BrowserRouter>
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
    </BrowserRouter>
  );
}

export default App;
