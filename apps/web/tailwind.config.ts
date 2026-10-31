import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        bg:        "var(--bg)",
        "bg-2":    "var(--bg-2)",
        "bg-3":    "var(--bg-3)",
        surface:   "var(--surface)",
        border:    "var(--border)",
        fg:        "var(--fg)",
        "fg-2":    "var(--fg-2)",
        gold:      "var(--gold)",
        "gold-2":  "var(--gold-2)",
        success:   "var(--success)",
        danger:    "var(--danger)",
      },
      fontFamily: {
        sans: ["Outfit", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["DM Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      borderRadius: { xl: "0.875rem", "2xl": "1.125rem" },
      boxShadow: {
        card: "0 1px 0 rgba(255,255,255,0.04), 0 8px 24px rgba(0,0,0,0.45)",
      },
    },
  },
  plugins: [require("@tailwindcss/forms")],
};

export default config;
