import { useState } from "react";

import { isAnalyticsEnabled, setAnalyticsEnabled } from "../helpers/analytics";
import { getStoredTheme, setStoredTheme } from "../helpers/theme";

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
        <h1>Appearance</h1>
        <p className="subtitle">
          Control how Vorliq looks on this device. Your choice is saved in this browser and applied across the site.
        </p>
      </section>

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
    </div>
  );
}

export default Settings;
