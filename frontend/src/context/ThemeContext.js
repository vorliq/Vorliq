import { createContext, useContext, useEffect, useMemo, useState } from "react";

const ThemeContext = createContext(null);
const STORAGE_KEY = "vorliq_motion";

function getInitialGlowMode() {
  const savedMode = window.localStorage.getItem(STORAGE_KEY);
  const mode = savedMode === "reduced" ? "reduced" : "full";
  document.documentElement.setAttribute("data-theme", "dark");
  document.documentElement.setAttribute("data-glow", mode);
  return mode;
}

export function ThemeProvider({ children }) {
  const [glowMode, setGlowMode] = useState(getInitialGlowMode);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", "dark");
    document.documentElement.setAttribute("data-glow", glowMode);
    window.localStorage.setItem(STORAGE_KEY, glowMode);
  }, [glowMode]);

  function toggleTheme() {
    setGlowMode((currentMode) => (currentMode === "full" ? "reduced" : "full"));
  }

  const value = useMemo(
    () => ({
      theme: "dark",
      glowMode,
      toggleTheme,
    }),
    [glowMode]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used inside ThemeProvider");
  }
  return context;
}
