/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx}"],
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        vorliq: {
          bg: "#0A0E1A",
          surface: "#111827",
          border: "#1E2D40",
          accent: "#00C6A7",
          gold: "#F5A623",
          muted: "#A0AEC0",
        },
      },
      fontFamily: {
        sans: ['"Inter"', '"Plus Jakarta Sans"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', '"Fira Code"', "ui-monospace", "monospace"],
      },
      boxShadow: {
        glow: "0 0 34px rgba(0, 198, 167, 0.24)",
        panel: "0 22px 80px rgba(0, 0, 0, 0.32)",
      },
    },
  },
  plugins: [],
};
