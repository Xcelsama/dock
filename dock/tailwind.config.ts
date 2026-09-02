import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: "#101314",
        surface: "#171B1D",
        surfaceRaised: "#1E2325",
        border: "#2A3033",
        borderStrong: "#3A4144",
        ink: "#ECEDEE",
        muted: "#8B9296",
        faint: "#5B6266",
        accent: "#4FD1C5",
        accentDim: "#2E7A72",
        warn: "#E0A84D",
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Inter",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
      borderRadius: {
        sm: "4px",
        md: "6px",
      },
    },
  },
  plugins: [],
};

export default config;
