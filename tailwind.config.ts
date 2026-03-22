import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: "hsl(var(--card))",
        border: "hsl(var(--border))",
        muted: "hsl(var(--muted))",
        accent: "hsl(var(--accent))",
        ring: "hsl(var(--ring))"
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(29, 205, 255, 0.25), 0 20px 60px rgba(9, 182, 154, 0.25)"
      }
    }
  },
  plugins: []
};

export default config;
