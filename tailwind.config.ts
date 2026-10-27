import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#f0f7f4",
          100: "#dbede4",
          200: "#b8dbc9",
          300: "#8cc2a8",
          400: "#5ea383",
          500: "#3f8768",
          600: "#2f6c53",
          700: "#275744",
          800: "#214638",
          900: "#1c3a2f",
        },
        sand: { 50: "#fbf8f3", 100: "#f4ede1", 200: "#e8dac2" },
      },
      fontFamily: { sans: ["var(--font-sans)", "system-ui", "sans-serif"] },
    },
  },
  plugins: [],
};

export default config;
