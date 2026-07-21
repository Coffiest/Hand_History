import type { Config } from "tailwindcss";

/**
 * Design tokens carried over from the RRPoker hand-review screen and the
 * project CLAUDE.md rules: Apple-native, warm off-white base, grey text
 * hierarchy, gold (#F2A900) as the single accent, generous rounding.
 * Suit colours use the 4-colour deck (spade black / heart red / diamond blue /
 * club green) matching Meta-GEO's PlayingCard.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#FFFBF5",
        surface: "#F5F3EF",
        border: "#E8E3DB",
        gold: { DEFAULT: "#F2A900", dark: "#D4910A" },
        ink: "#1D1D1F",
        gray2: "#6E6E73",
        gray3: "#AEAEB2",
        suit: {
          spade: "#1D1D1F",
          heart: "#E53E3A",
          diamond: "#2563EB",
          club: "#16A34A",
        },
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "SF Pro Text",
          "SF Pro Display",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
      borderRadius: {
        "4xl": "2rem",
      },
      boxShadow: {
        card: "0 2px 12px rgba(0, 0, 0, 0.06)",
        lift: "0 8px 30px rgba(0, 0, 0, 0.10)",
      },
    },
  },
  plugins: [],
};

export default config;
