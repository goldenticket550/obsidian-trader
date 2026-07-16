import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        obsidian: {
          black: "#0A0A0B",
          charcoal: "#141416",
          panel: "#1B1B1E",
          border: "#2A2A2E",
        },
        platinum: {
          DEFAULT: "#C9CDD3",
          bright: "#E8EAED",
          dim: "#8A8E96",
        },
        signal: {
          green: "#3FB27F",
          yellow: "#D9A441",
          red: "#C24B4B",
        },
      },
      fontFamily: {
        display: ["'Söhne'", "'Inter'", "system-ui", "sans-serif"],
        body: ["'Inter'", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "monospace"],
      },
      boxShadow: {
        panel: "0 1px 0 0 rgba(255,255,255,0.03) inset, 0 8px 24px -12px rgba(0,0,0,0.6)",
      },
    },
  },
  plugins: [],
};

export default config;
