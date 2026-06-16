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
          // Bridged onto the vnext palette so the shared nav/footer match the
          // rest of the site (teal #00a896, royal blue, near-black navy bg).
          bg: "#080B14",
          surface: "#0D1628",
          border: "rgba(255, 255, 255, 0.15)",
          accent: "#00a896",
          gold: "#F5A623",
          muted: "#A0AEC0",
        },
      },
      fontFamily: {
        sans: ['"Inter"', '"Plus Jakarta Sans"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', '"Fira Code"', "ui-monospace", "monospace"],
      },
      boxShadow: {
        glow: "0 0 34px rgba(0, 168, 150, 0.24)",
        panel: "0 22px 80px rgba(0, 0, 0, 0.32)",
      },
    },
  },
  plugins: [],
};
