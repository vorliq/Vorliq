import { createContext, useContext, useEffect, useMemo } from "react";

const ThemeContext = createContext(null);
const STORAGE_KEY = "vorliq_theme";

// Vorliq ships dark mode as its single intended theme. There is no theme
// choice to offer, so no toggle API is exposed.
const THEME = "dark";

// Apply before first paint so themed CSS variables are active immediately.
document.documentElement.setAttribute("data-theme", THEME);

export function ThemeProvider({ children }) {
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", THEME);
    window.localStorage.setItem(STORAGE_KEY, THEME);
  }, []);

  const value = useMemo(() => ({ theme: THEME }), []);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used inside ThemeProvider");
  }
  return context;
}
