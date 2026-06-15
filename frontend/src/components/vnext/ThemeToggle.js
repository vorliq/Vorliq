// Icon-only theme toggle (no label, anywhere) per spec. Reuses the existing
// site-wide theme helper so dark/light stays in sync with the rest of the app.
import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

import { getStoredTheme, toggleTheme } from "../../helpers/theme";

export default function ThemeToggle({ className = "" }) {
  const [theme, setTheme] = useState(getStoredTheme);

  // Keep in sync if another part of the app changes the theme.
  useEffect(() => {
    function sync() {
      setTheme(document.documentElement.getAttribute("data-theme") || "dark");
    }
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  function handleToggle() {
    setTheme(toggleTheme());
  }

  const isDark = theme !== "light";
  return (
    <button
      type="button"
      className={`vn-theme-toggle ${className}`.trim()}
      onClick={handleToggle}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {isDark ? <Moon size={20} aria-hidden="true" /> : <Sun size={20} aria-hidden="true" />}
    </button>
  );
}
