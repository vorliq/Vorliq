import { useState } from "react";

import { getStoredTheme, setStoredTheme } from "../helpers/theme";

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

  function choose(next) {
    setTheme(setStoredTheme(next));
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
    </div>
  );
}

export default Settings;
