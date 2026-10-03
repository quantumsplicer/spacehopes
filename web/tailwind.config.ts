import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "var(--ink)", "ink-2": "var(--ink-2)", muted: "var(--muted)", line: "var(--line)", input: "var(--input)",
        teal: { DEFAULT: "var(--teal)", tint: "var(--teal-tint)", line: "var(--teal-line)", soft: "var(--teal-soft)" },
        heart: "var(--heart)",
      },
      fontFamily: { serif: ["var(--font-serif)", "Georgia", "serif"], sans: ["var(--font-sans)", "system-ui", "sans-serif"] },
      borderRadius: { pill: "999px" },
      maxWidth: { page: "1240px" },
    },
  },
  plugins: [],
} satisfies Config;
