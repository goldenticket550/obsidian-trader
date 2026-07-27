import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Mapped onto the CSS custom properties in globals.css so the
        // palette has exactly one source of truth. Existing class names
        // are preserved, so no component needs a sweeping rename.
        obsidian: {
          black: "var(--page)",
          charcoal: "var(--panel-muted)",
          panel: "var(--panel)",
          raised: "var(--panel-raised)",
          border: "var(--border)",
          soft: "var(--border-soft)",
        },
        platinum: {
          DEFAULT: "var(--text-secondary)",
          bright: "var(--text)",
          dim: "var(--text-muted)",
        },
        signal: {
          green: "var(--green)",
          yellow: "var(--amber)",
          red: "var(--red)",
        },
        // Executive Command Center accents. Deliberately desaturated so
        // they read as institutional rather than neon, and so the only
        // genuinely loud colors on screen stay the signal states.
        accent: {
          champagne: "var(--amber)", // selection + primary actions
          emerald: "var(--green)", // confirmed / passing states
          violet: "var(--violet)", // structure-shift alerts
          blue: "var(--blue)", // EMA reclaim alerts
        },
      },
      fontFamily: {
        display: ["'Söhne'", "'Inter'", "system-ui", "sans-serif"],
        body: ["'Inter'", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "monospace"],
      },
      boxShadow: {
        panel: "0 1px 0 0 rgba(255,255,255,0.03) inset, 0 8px 24px -12px rgba(0,0,0,0.6)",
        // Selection glow for the expanded opportunity row — subtle enough
        // to read as focus, not as a status color.
        selected: "0 0 0 1px rgba(217,190,132,0.28), 0 8px 28px -14px rgba(217,190,132,0.35)",
      },
    },
  },
  plugins: [],
};

export default config;
