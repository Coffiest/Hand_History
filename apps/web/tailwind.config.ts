import type { Config } from "tailwindcss";

/**
 * "White Cube" design tokens — v0.7.0 redesign.
 *
 * The app is a white gallery: pure-white canvas, faint cool-grey section walls,
 * hairline separations, and liquid-glass surfaces floating above. Gold stays
 * the single solid accent; the iridescent gradient lives only in glass edges,
 * progress strokes and hero light (never as a fill).
 *
 * Existing token NAMES are kept (bg/surface/border/ink/gray2/gray3/gold/suit)
 * so every component keeps compiling; their VALUES define the new look.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // White Cube base
        bg: "#FFFFFF",
        canvas: "#FFFFFF",
        surface: "#F7F7F8",
        gallery: "#F7F7F8",
        border: "rgba(10, 10, 12, 0.08)",
        hairline: "rgba(10, 10, 12, 0.08)",
        ink: "#0A0A0C",
        gray2: "#6E6E73",
        gray3: "#AEAEB2",
        gold: { DEFAULT: "#F2A900", dark: "#D4910A" },
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
        // Gallery elevation scale: broad, faint, diffuse — glass floating on air.
        card: "0 2px 12px rgba(10, 10, 12, 0.05)",
        lift: "0 8px 32px rgba(10, 10, 12, 0.08)",
        glass:
          "0 8px 32px rgba(10, 10, 12, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.9)",
        "glass-strong":
          "0 16px 48px rgba(10, 10, 12, 0.14), inset 0 1px 0 rgba(255, 255, 255, 0.95)",
        gold: "0 6px 24px rgba(242, 169, 0, 0.35)",
      },
      transitionTimingFunction: {
        // The one easing used app-wide for enters (expo-out).
        gallery: "cubic-bezier(0.16, 1, 0.3, 1)",
      },
    },
  },
  plugins: [],
};

export default config;
