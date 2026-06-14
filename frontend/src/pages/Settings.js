import { useState } from "react";
import { Link } from "react-router-dom";

import { useAuth } from "../context/AuthContext";
import { isAnalyticsEnabled, setAnalyticsEnabled } from "../helpers/analytics";
import { formatHash } from "../helpers/publicApi";
import { hasWallet } from "../helpers/storage";
import { getStoredTheme, setStoredTheme } from "../helpers/theme";

const dataStored = [
  "Your wallet, encrypted with your password, in this browser's local storage only",
  "Public blockchain records: blocks, transactions, and balances on the Vorliq chain",
  "Your public profile fields, if you choose to create a profile",
  "Anonymous product analytics, only while analytics is turned on",
];

const dataNeverStored = [
  "Your private key or seed phrase in readable form on any Vorliq server",
  "Your wallet password (it never leaves this device)",
  "IP addresses or raw device fingerprints tied to your activity",
];

const yourResponsibility = [
  "Keep your password safe. Vorliq cannot reset it or recover your wallet without it.",
  "Export an encrypted backup and store it somewhere safe before holding meaningful VLQ.",
  "Never share your private key or seed phrase. Anyone who has it controls your wallet.",
];

const tracked = [
  "Which pages you open and how sections of the landing page are viewed",
  "Clicks on buttons, navigation, and product cards, by their on-screen label",
  "Your device size bucket (mobile, tablet, or desktop), never your exact device",
  "An anonymous random session id that is not linked to any wallet or account",
  "Frontend errors and failed or slow public data requests, to find problems",
];

const neverTracked = [
  "Private keys, seed phrases, or wallet passwords",
  "Your wallet address or any account identity",
  "IP addresses or raw device fingerprints",
  "Anything you type into forms",
];

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" className="vq-theme-icon" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" className="vq-theme-icon" aria-hidden="true" focusable="false">
      <path
        d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const options = [
  { value: "dark", label: "Dark", icon: MoonIcon, hint: "Deep navy surfaces. The default Vorliq look." },
  { value: "light", label: "Light", icon: SunIcon, hint: "Bright surfaces with strong contrast for daytime use." },
];

function WalletStatus() {
  const { wallet, isLoggedIn } = useAuth();
  const accountExists = isLoggedIn || hasWallet();

  let state;
  if (isLoggedIn && wallet?.address) {
    state = {
      badge: { className: "executed", label: "Unlocked" },
      title: "Wallet unlocked on this device",
      body: "Your saved wallet is unlocked for this session. You can view your balance, history, and account activity.",
      address: wallet.address,
      actions: [
        { label: "Open account", to: "/account" },
        { label: "Open wallet", to: "/wallet" },
        { label: "Send VLQ", to: "/send" },
      ],
    };
  } else if (accountExists) {
    state = {
      badge: { className: "active", label: "Locked" },
      title: "Wallet saved but locked",
      body: "An encrypted wallet is saved in this browser but the session is locked. Sign in with your password to unlock it.",
      address: null,
      actions: [{ label: "Sign in", to: "/login" }],
    };
  } else {
    state = {
      badge: { className: "expired", label: "No wallet" },
      title: "No wallet on this device",
      body: "There is no Vorliq wallet saved in this browser. Create an account to get a wallet, or restore an encrypted backup.",
      address: null,
      actions: [
        { label: "Create account", to: "/register" },
        { label: "Restore a wallet", to: "/login" },
      ],
    };
  }

  return (
    <section className="card card-pad stack" aria-label="Connected wallet">
      <div className="section-title">
        <div>
          <span className="eyebrow">Your wallet</span>
          <h2>{state.title}</h2>
        </div>
        <span className={`status-badge ${state.badge.className}`} role="status">
          {state.badge.label}
        </span>
      </div>
      <p className="muted-text">{state.body}</p>
      {state.address ? (
        <div className="field">
          <span className="meta-label">Wallet address</span>
          <span className="value-box mono-wrap" title={state.address}>
            {formatHash(state.address, 14, 8)}
          </span>
        </div>
      ) : null}
      <div className="button-row">
        {state.actions.map((action) => (
          <Link className="button secondary small-button" to={action.to} key={action.to + action.label}>
            {action.label}
          </Link>
        ))}
      </div>
    </section>
  );
}

function Settings() {
  const [theme, setTheme] = useState(getStoredTheme());
  const [analyticsOn, setAnalyticsOn] = useState(isAnalyticsEnabled());

  function choose(next) {
    setTheme(setStoredTheme(next));
  }

  function toggleAnalytics(next) {
    setAnalyticsEnabled(next);
    setAnalyticsOn(next);
  }

  return (
    <div className="page">
      <section className="hero">
        <span className="eyebrow">Settings</span>
        <h1>Settings</h1>
        <p className="subtitle">
          Control how Vorliq looks and behaves on this device, review your wallet status, and understand exactly what
          Vorliq stores and what it never stores.
        </p>
      </section>

      <WalletStatus />

      <section className="card card-pad stack" aria-label="Theme settings">
        <div className="section-title">
          <div>
            <span className="eyebrow">Theme</span>
            <h2>Choose dark or light</h2>
          </div>
          <span className="status-badge executed" role="status">
            {theme === "light" ? "Light" : "Dark"} active
          </span>
        </div>
        <p className="muted-text">
          The theme changes immediately and stays the way you set it next time you open Vorliq on this device.
        </p>
        <div className="vq-theme-toggle" role="group" aria-label="Theme">
          {options.map((option) => {
            const Icon = option.icon;
            const active = theme === option.value;
            return (
              <button
                key={option.value}
                type="button"
                className={`vq-theme-option ${active ? "active" : ""}`}
                aria-pressed={active}
                aria-label={`Use ${option.label.toLowerCase()} theme`}
                onClick={() => choose(option.value)}
              >
                <span className="vq-theme-option__top">
                  <Icon />
                  <strong>{option.label}</strong>
                  {active ? <span className="vq-theme-check" aria-hidden="true">Selected</span> : null}
                </span>
                <span className="vq-theme-option__hint">{option.hint}</span>
                <span className={`vq-theme-swatch vq-theme-swatch--${option.value}`} aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </section>

      <section className="card card-pad stack" aria-label="Analytics and privacy settings">
        <div className="section-title">
          <div>
            <span className="eyebrow">Analytics and privacy</span>
            <h2>Privacy-conscious product analytics</h2>
          </div>
          <span className={`status-badge ${analyticsOn ? "executed" : "expired"}`} role="status">
            {analyticsOn ? "On" : "Off"}
          </span>
        </div>
        <p className="muted-text">
          Vorliq uses its own self-hosted analytics to understand how the product is used and to find problems. It is
          not a third party service, and the data stays on the Vorliq server. You can turn it off at any time.
        </p>
        <div className="vq-privacy-grid">
          <div className="vq-privacy-card">
            <h3>What is collected</h3>
            <ul className="vq-privacy-list">
              {tracked.map((item) => (
                <li key={item}>
                  <span className="vq-privacy-mark ok" aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="vq-privacy-card">
            <h3>What is never collected</h3>
            <ul className="vq-privacy-list">
              {neverTracked.map((item) => (
                <li key={item}>
                  <span className="vq-privacy-mark no" aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="vq-toggle-row">
          <div>
            <strong>Share anonymous usage analytics</strong>
            <p className="muted-text">When off, the analytics client is disabled and no events are sent from this browser.</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={analyticsOn}
            aria-label="Share anonymous usage analytics"
            className={`vq-switch ${analyticsOn ? "on" : ""}`}
            onClick={() => toggleAnalytics(!analyticsOn)}
          >
            <span className="vq-switch__dot" aria-hidden="true" />
          </button>
        </div>
      </section>

      <section className="card card-pad stack" aria-label="Security and your data">
        <div className="section-title">
          <div>
            <span className="eyebrow">Security and your data</span>
            <h2>What Vorliq stores, and what stays yours</h2>
          </div>
        </div>
        <p className="muted-text">
          Vorliq is self-custody software. Your wallet is encrypted on your own device, and you stay in control of it.
          Vorliq does not insure VLQ, guarantee its value, or recover lost wallets.
        </p>
        <div className="vq-privacy-grid">
          <div className="vq-privacy-card">
            <h3>What Vorliq stores</h3>
            <ul className="vq-privacy-list">
              {dataStored.map((item) => (
                <li key={item}>
                  <span className="vq-privacy-mark ok" aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="vq-privacy-card">
            <h3>What Vorliq never stores</h3>
            <ul className="vq-privacy-list">
              {dataNeverStored.map((item) => (
                <li key={item}>
                  <span className="vq-privacy-mark no" aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="risk-box">
          <strong>What you are responsible for</strong>
          <ul className="vq-privacy-list vq-responsibility-list">
            {yourResponsibility.map((item) => (
              <li key={item}>
                <span className="vq-privacy-mark warn" aria-hidden="true" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="button-row">
          <Link className="button secondary small-button" to="/transparency">
            Read transparency
          </Link>
          <a
            className="button secondary small-button"
            href="https://vorliq.github.io/Vorliq/terms.html#risk-notice"
            target="_blank"
            rel="noreferrer"
          >
            Risk notice
          </a>
        </div>
      </section>
    </div>
  );
}

export default Settings;
