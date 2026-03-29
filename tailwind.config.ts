import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: "#090d14",
        panel: "#121826",
        muted: "#8f9bb8",
        border: "#263047",
        accent: "#32d2a2",
      },
      boxShadow: {
        panel: "0 10px 30px rgba(5, 10, 20, 0.4)",
      },
    },
  },
  plugins: [],
};

export default config;

