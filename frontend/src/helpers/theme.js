// Frontend-only theme preference. Persisted in localStorage and applied to the
// <html> data-theme attribute, which drives the CSS token system (dark/light).
// No backend involvement.

export const THEME_STORAGE_KEY = "vorliq_theme";
export const THEMES = ["dark", "light"];
const DEFAULT_THEME = "dark";

export function getStoredTheme() {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return THEMES.includes(stored) ? stored : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function applyTheme(theme) {
  const next = THEMES.includes(theme) ? theme : DEFAULT_THEME;
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", next);
  }
  return next;
}

export function setStoredTheme(theme) {
  const next = THEMES.includes(theme) ? theme : DEFAULT_THEME;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // ignore storage errors; the in-memory attribute is still applied
  }
  return applyTheme(next);
}

export function toggleTheme() {
  const next = getStoredTheme() === "light" ? "dark" : "light";
  return setStoredTheme(next);
}
