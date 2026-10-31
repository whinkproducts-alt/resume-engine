import type { Config } from "tailwindcss";

const token = (name: string) =>
  `color-mix(in srgb, var(--${name}) calc(<alpha-value> * 100%), transparent)`;

const config: Config = {
  content: ["./src/**/*.{ts,tsx,mdx}"],
  theme: {
    extend: {
      // Tailwind cannot apply opacity modifiers (bg-gold/10, border-danger/40) to a bare
      // var(--x). Wrapping each token with <alpha-value> keeps the hex design tokens in
      // globals.css untouched while making those modifiers work.
      colors: {
        bg:        token("bg"),
        "bg-2":    token("bg-2"),
        "bg-3":    token("bg-3"),
        surface:   token("surface"),
        border:    token("border"),
        fg:        token("fg"),
        "fg-2":    token("fg-2"),
        gold:      token("gold"),
        "gold-2":  token("gold-2"),
        success:   token("success"),
        danger:    token("danger"),
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
