import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
      },
      colors: {
        bg: "#090d14",
        panel: "#121826",
        muted: "#8f9bb8",
        border: "#263047",
        accent: "#32d2a2",
      },
      boxShadow: {
        panel: "0 1px 3px rgba(0,0,0,0.3), 0 8px 24px rgba(2,6,23,0.32)",
        card: "inset 0 0 0 1px rgba(255,255,255,0.03), 0 18px 42px rgba(2,6,23,0.34)",
        "card-hover": "inset 0 0 0 1px rgba(255,255,255,0.06), 0 24px 48px rgba(2,6,23,0.44)",
      },
    },
  },
  plugins: [],
};

export default config;

