import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Menu, X } from "lucide-react";

import logo from "../assets/logo.png";
import { useAuth } from "../context/AuthContext";
import { hasWallet } from "../helpers/storage";
import SocialLinks from "./SocialLinks";

const navLinks = [
  { label: "Product", to: "/features" },
  { label: "How It Works", to: "/#how-it-works" },
  { label: "Blockchain", to: "/blockchain" },
  { label: "Community", to: "/#community" },
  { label: "Learn", to: "/#learn" },
  { label: "Transparency", to: "/transparency" },
];

const footerGroups = [
  {
    title: "Product",
    links: [
      { label: "Features", to: "/features" },
      { label: "Wallet", to: "/wallet" },
      { label: "Dashboard", to: "/dashboard" },
      { label: "Settings", to: "/settings" },
      { label: "Create Account", to: "/register" },
    ],
  },
  {
    title: "Network",
    links: [
      { label: "Blockchain", to: "/blockchain" },
      { label: "Network", to: "/network" },
      { label: "Status", to: "/status" },
      { label: "Readiness", to: "/readiness" },
      { label: "Transparency", to: "/transparency" },
    ],
  },
  {
    title: "Learn",
    links: [
      { label: "What is VLQ", to: "/vlq" },
      { label: "How It Works", to: "/#how-it-works" },
      { label: "Community", to: "/#community" },
      { label: "Whitepaper", to: "/whitepaper" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Terms", href: "https://vorliq.github.io/Vorliq/terms.html" },
      { label: "Privacy", href: "https://vorliq.github.io/Vorliq/privacy.html" },
      { label: "Risk Notice", href: "https://vorliq.github.io/Vorliq/terms.html#risk-notice" },
      { label: "MIT License", href: "https://github.com/vorliq/Vorliq/blob/main/LICENSE" },
    ],
  },
];

export function ProductNav() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const closeButtonRef = useRef(null);
  const menuRef = useRef(null);
  const location = useLocation();

  useEffect(() => {
    setOpen(false);
  }, [location.pathname, location.hash]);

  useEffect(() => {
    if (!location.hash) return undefined;
    const targetId = decodeURIComponent(location.hash.slice(1));
    const timer = window.setTimeout(() => {
      document.getElementById(targetId)?.scrollIntoView({ block: "start" });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [location.pathname, location.hash]);

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 12);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.classList.toggle("mobile-nav-open", open);
    return () => document.body.classList.remove("mobile-nav-open");
  }, [open]);

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === "Escape") {
        setOpen(false);
      }

      if (event.key !== "Tab" || !open || !menuRef.current) return;
      const focusable = Array.from(
        menuRef.current.querySelectorAll(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => closeButtonRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  return (
    <>
      <header
        className={`navbar sticky top-0 z-[1000] border-b transition duration-300 ${
          scrolled
            ? "border-white/10 bg-[#080B14]/82 shadow-panel backdrop-blur-xl"
            : "border-transparent bg-[#080B14]/55 backdrop-blur-md"
        }`}
      >
        <a
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[1200] focus:rounded-lg focus:bg-vorliq-accent focus:px-4 focus:py-3 focus:font-black focus:text-[#06101c]"
          href="#main-content"
        >
          Skip to main content
        </a>
        <nav className="navbar-inner mx-auto flex min-h-[72px] w-[min(1180px,calc(100%_-_32px))] items-center justify-between gap-5">
          <BrandLockup />
          <div className="hidden items-center gap-2 lg:flex" aria-label="Primary navigation">
            {navLinks.map((link) => (
              <NavItem key={link.label} link={link} />
            ))}
          </div>
          <div className="hidden items-center gap-3 lg:flex">
            <HeaderActions />
          </div>
          <button
            className="grid h-11 w-11 place-items-center rounded-full border border-vorliq-border bg-white/[0.04] text-white lg:hidden"
            type="button"
            aria-label="Open navigation menu"
            aria-controls="mobile-product-navigation"
            aria-expanded={open}
            onClick={() => setOpen(true)}
          >
            <Menu size={21} aria-hidden="true" />
          </button>
        </nav>
      </header>

      {open && (
        <>
          <div
            className="mobile-drawer-backdrop nav-open fixed inset-0 z-[1001] bg-black/50 backdrop-blur-sm transition lg:hidden"
            aria-hidden="true"
            onClick={() => setOpen(false)}
          />
          <aside
            ref={menuRef}
            id="mobile-product-navigation"
            className="mobile-drawer nav-open fixed bottom-0 right-0 top-0 z-[1002] w-[min(90vw,390px)] overflow-y-auto border-l border-vorliq-border bg-[#080B14] p-5 shadow-panel transition-transform duration-300 lg:hidden"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
          >
            <div className="mb-7 flex items-center justify-between">
              <BrandLockup onClick={() => setOpen(false)} />
              <button
                ref={closeButtonRef}
                className="grid h-10 w-10 place-items-center rounded-full border border-vorliq-border text-white"
                type="button"
                aria-label="Close navigation menu"
                onClick={() => setOpen(false)}
              >
                <X size={20} aria-hidden="true" />
              </button>
            </div>
            <div className="grid gap-2">
              {navLinks.map((link) => (
                <NavItem key={link.label} link={link} mobile onClick={() => setOpen(false)} />
              ))}
            </div>
            <div className="mt-8 grid gap-3">
              <HeaderActions mobile onNavigate={() => setOpen(false)} />
            </div>
          </aside>
        </>
      )}
    </>
  );
}

function NavItem({ link, mobile = false, onClick }) {
  const location = useLocation();
  const path = link.to.split("#")[0] || "/";
  const isActive = path !== "/" && location.pathname === path;

  return (
    <Link
      className={`rounded-full font-extrabold text-vorliq-muted transition hover:bg-white/[0.05] hover:text-white ${
        mobile ? "px-4 py-3 text-base" : "px-4 py-2 text-sm"
      } ${isActive ? "nav-item-active" : ""}`}
      to={link.to}
      aria-current={isActive ? "page" : undefined}
      onClick={onClick}
      data-vq-track={`nav:${link.label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      {link.label}
    </Link>
  );
}

// Authentication-aware header actions. Uses only the existing local wallet
// session state (AuthContext + stored encrypted wallet). It does not add or
// change any backend authentication. State survives refresh because the
// AuthProvider rehydrates the wallet from storage on load.
function HeaderActions({ mobile = false, onNavigate }) {
  const { isLoggedIn, logout } = useAuth();
  const navigate = useNavigate();
  const accountExists = isLoggedIn || hasWallet();

  const ghost = mobile
    ? "rounded-full border border-vorliq-border px-5 py-3 text-center font-extrabold text-white"
    : "rounded-full px-4 py-2 text-sm font-extrabold text-vorliq-muted transition hover:text-white";
  const solid = mobile
    ? "rounded-full bg-vorliq-accent px-5 py-3 text-center font-black text-[#06101c] shadow-glow"
    : "rounded-full bg-vorliq-accent px-5 py-2.5 text-sm font-black text-[#06101c] shadow-glow transition hover:translate-y-[-1px]";

  function handleSignOut() {
    logout();
    if (onNavigate) onNavigate();
    navigate("/");
  }

  if (isLoggedIn) {
    return (
      <>
        <Link className={ghost} to="/dashboard" onClick={onNavigate} data-vq-track="nav:dashboard">
          Dashboard
        </Link>
        <Link className={solid} to="/wallet" onClick={onNavigate} data-vq-track="nav:wallet">
          Wallet
        </Link>
        <button className={ghost} type="button" onClick={handleSignOut} data-vq-track="cta:sign-out">
          Sign Out
        </button>
      </>
    );
  }

  if (accountExists) {
    return (
      <>
        <Link className={ghost} to="/dashboard" onClick={onNavigate} data-vq-track="nav:dashboard">
          Dashboard
        </Link>
        <Link className={solid} to="/login" onClick={onNavigate} data-vq-track="cta:sign-in">
          Sign In
        </Link>
      </>
    );
  }

  return (
    <>
      <Link className={ghost} to="/login" onClick={onNavigate} data-vq-track="cta:sign-in">
        Sign In
      </Link>
      <Link className={solid} to="/register" onClick={onNavigate} data-vq-track="cta:create-account">
        Create Account
      </Link>
    </>
  );
}

export function BrandLockup({ compact = false, onClick }) {
  return (
    <Link className="brand inline-flex min-w-0 items-center gap-3 text-white" to="/" onClick={onClick}>
      <img
        className={`brand-logo ${compact ? "h-8 w-8" : "h-10 w-10"} rounded-full object-contain drop-shadow-[var(--brand-logo-glow)]`}
        src={logo}
        alt="Vorliq logo"
      />
      <span className="text-lg font-black tracking-normal">Vorliq</span>
    </Link>
  );
}

export function ProductFooter() {
  return (
    <footer className="site-footer relative z-10 border-t border-vorliq-border bg-[#080B14]">
      <div className="footer-inner mx-auto grid w-[min(1180px,calc(100%_-_32px))] gap-10 py-12 lg:grid-cols-[1.1fr_1.9fr]">
        <div className="footer-brand grid content-start gap-5">
          <BrandLockup compact />
          <p className="max-w-sm text-sm leading-7 text-vorliq-muted">A community savings bank built on its own blockchain with the VLQ coin.</p>
          <SocialLinks compact />
        </div>
        <div className="footer-links grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {footerGroups.map((group) => (
            <div className="footer-link-group grid content-start gap-3" key={group.title}>
              <h2 className="text-sm font-black uppercase tracking-[0.12em] text-white">{group.title}</h2>
              {group.links.map((link) =>
                link.to ? (
                  <Link className="text-sm font-semibold text-vorliq-muted transition hover:text-white" to={link.to} key={link.label}>
                    {link.label}
                  </Link>
                ) : (
                  <a
                    className="text-sm font-semibold text-vorliq-muted transition hover:text-white"
                    href={link.href}
                    target="_blank"
                    rel="noreferrer"
                    key={link.label}
                  >
                    {link.label}
                  </a>
                )
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="border-t border-vorliq-border">
        <div className="mx-auto flex w-[min(1180px,calc(100%_-_32px))] flex-col gap-3 py-5 text-sm font-semibold text-vorliq-muted sm:flex-row sm:items-center sm:justify-between">
          <span>© 2026 Vorliq. Open source. Built for communities.</span>
          <span>VLQ runs on Vorliq's own lightweight blockchain.</span>
        </div>
      </div>
    </footer>
  );
}
