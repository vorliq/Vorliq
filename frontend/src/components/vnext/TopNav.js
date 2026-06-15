// Fixed, blurred top navigation for the new design layer. Center links use the
// brand's locked labels/routes (not the spec's generic ones); the logo is the
// existing brand mark used unmodified. Theme toggle sits to the left of the
// action buttons on desktop and centered at the bottom of the mobile drawer.
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Menu, X } from "lucide-react";

import logo from "../../assets/logo.png";
import ThemeToggle from "./ThemeToggle";
import { Button } from "./primitives";

// Locked brand navigation — maps to real, existing routes.
const NAV_LINKS = [
  { label: "Features", to: "/features" },
  { label: "Blockchain", to: "/blockchain" },
  { label: "Community", to: "/forum" },
  { label: "Whitepaper", to: "/whitepaper" },
  { label: "Roadmap", to: "/roadmap" },
];

function Brand({ onClick }) {
  return (
    <Link className="vn-brand" to="/" onClick={onClick}>
      <img src={logo} alt="Vorliq logo" width="34" height="34" />
      <span>Vorliq</span>
    </Link>
  );
}

export default function TopNav() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const drawerRef = useRef(null);

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <header className="vn-nav">
        <div className="vn-nav__inner vn-container">
          <Brand />
          <nav className="vn-nav__links" aria-label="Primary">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className={`vn-nav__link ${location.pathname === link.to ? "is-active" : ""}`}
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <div className="vn-nav__actions">
            <ThemeToggle className="vn-nav__desktop-only" />
            <span className="vn-nav__desktop-only">
              <Button variant="secondary" to="/login">
                Sign In
              </Button>
            </span>
            <span className="vn-nav__desktop-only">
              <Button variant="primary" to="/register">
                Create Account
              </Button>
            </span>
            <button
              type="button"
              className="vn-hamburger"
              aria-label="Open navigation menu"
              aria-expanded={open}
              onClick={() => setOpen(true)}
            >
              <Menu size={22} aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      {open && (
        <>
          <div className="vn-drawer-backdrop" onClick={() => setOpen(false)} aria-hidden="true" />
          <aside
            ref={drawerRef}
            className="vn-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
          >
            <div className="vn-drawer__head">
              <Brand onClick={() => setOpen(false)} />
              <button
                type="button"
                className="vn-theme-toggle"
                aria-label="Close navigation menu"
                onClick={() => setOpen(false)}
              >
                <X size={20} aria-hidden="true" />
              </button>
            </div>
            {NAV_LINKS.map((link) => (
              <Link key={link.to} to={link.to} className="vn-nav__link" onClick={() => setOpen(false)}>
                {link.label}
              </Link>
            ))}
            <div style={{ marginTop: 18, display: "grid", gap: 12 }}>
              <Button variant="secondary" to="/login" onClick={() => setOpen(false)}>
                Sign In
              </Button>
              <Button variant="primary" to="/register" onClick={() => setOpen(false)}>
                Create Account
              </Button>
            </div>
            {/* Theme toggle: centered, alone, below all items and the primary action. */}
            <div className="vn-drawer__toggle">
              <ThemeToggle />
            </div>
          </aside>
        </>
      )}
    </>
  );
}
