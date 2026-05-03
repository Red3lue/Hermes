/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Deep navy base (replaces gray-950 in many places).
        ink: {
          950: "#05070f",
          900: "#080c1a",
          850: "#0b1124",
          800: "#0f172e",
          700: "#15203d",
          600: "#1c2a4d",
          500: "#243661",
        },
        // Primary neon — cyan/teal. Keeps the existing `hermes-*` class names.
        hermes: {
          50: "#e6fbff",
          100: "#c6f4ff",
          200: "#99e9ff",
          300: "#5cd9ff",
          400: "#2cc7ff",
          500: "#00b6ff",
          600: "#0096e0",
          700: "#0077b8",
          800: "#0a5790",
          900: "#0c3f6c",
          950: "#08243f",
        },
        // Accent neon — magenta/violet, used for highlights and "anima" feel.
        flux: {
          50: "#fbf2ff",
          100: "#f4dcff",
          200: "#e9b8ff",
          300: "#d885ff",
          400: "#c454ff",
          500: "#a738ff",
          600: "#8a25e0",
          700: "#6a1bb0",
          800: "#4d1480",
          900: "#310b54",
          950: "#1c0633",
        },
        // Tertiary — soft mint/green for "ok / public" pills.
        mint: {
          400: "#5eead4",
          500: "#2dd4bf",
          600: "#14b8a6",
        },
      },
      fontFamily: {
        display: [
          "'Orbitron'",
          "'Space Grotesk'",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
        sans: [
          "'Inter'",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
        mono: ["'JetBrains Mono'", "ui-monospace", "monospace"],
      },
      boxShadow: {
        // Neon glows for buttons/cards.
        "neon-cyan":
          "0 0 18px rgba(44,199,255,0.45), 0 0 4px rgba(44,199,255,0.65)",
        "neon-cyan-lg":
          "0 0 36px rgba(44,199,255,0.55), 0 0 12px rgba(44,199,255,0.7)",
        "neon-flux":
          "0 0 18px rgba(196,84,255,0.45), 0 0 4px rgba(196,84,255,0.65)",
        "neon-flux-lg":
          "0 0 36px rgba(196,84,255,0.55), 0 0 12px rgba(196,84,255,0.7)",
        "neon-mint":
          "0 0 14px rgba(46,212,191,0.4), 0 0 3px rgba(46,212,191,0.6)",
        "panel-inset":
          "inset 0 1px 0 rgba(255,255,255,0.04), 0 1px 0 rgba(0,0,0,0.6)",
      },
      backgroundImage: {
        "grid-cyan":
          "linear-gradient(to right, rgba(44,199,255,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(44,199,255,0.06) 1px, transparent 1px)",
        "radial-fade":
          "radial-gradient(ellipse 80% 60% at 50% 0%, rgba(44,199,255,0.18), transparent 65%)",
        "radial-flux":
          "radial-gradient(ellipse 60% 50% at 80% 30%, rgba(196,84,255,0.22), transparent 65%)",
      },
      backgroundSize: {
        "grid-32": "32px 32px",
      },
      keyframes: {
        "pulse-neon": {
          "0%, 100%": { opacity: "1", filter: "drop-shadow(0 0 6px currentColor)" },
          "50%": { opacity: "0.7", filter: "drop-shadow(0 0 14px currentColor)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "0% 50%" },
          "100%": { backgroundPosition: "200% 50%" },
        },
        "wing-float": {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-6px)" },
        },
        "spin-slow": {
          from: { transform: "rotate(0deg)" },
          to: { transform: "rotate(360deg)" },
        },
        "spin-reverse": {
          from: { transform: "rotate(0deg)" },
          to: { transform: "rotate(-360deg)" },
        },
        "halo-breathe": {
          "0%, 100%": { opacity: "0.55", transform: "scale(1)" },
          "50%": { opacity: "0.85", transform: "scale(1.04)" },
        },
        "reveal-up": {
          "0%": { opacity: "0", transform: "translateY(14px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "scan-line": {
          "0%": { transform: "translateX(-110%)", opacity: "0" },
          "20%": { opacity: "1" },
          "80%": { opacity: "1" },
          "100%": { transform: "translateX(110%)", opacity: "0" },
        },
        drift: {
          "0%": { transform: "translate(0, 0)" },
          "50%": { transform: "translate(18px, -22px)" },
          "100%": { transform: "translate(0, 0)" },
        },
        "drift-alt": {
          "0%": { transform: "translate(0, 0)" },
          "50%": { transform: "translate(-22px, 14px)" },
          "100%": { transform: "translate(0, 0)" },
        },
      },
      animation: {
        "pulse-neon": "pulse-neon 2.4s ease-in-out infinite",
        shimmer: "shimmer 6s linear infinite",
        "wing-float": "wing-float 6s ease-in-out infinite",
        "spin-slow": "spin-slow 28s linear infinite",
        "spin-reverse": "spin-reverse 22s linear infinite",
        "halo-breathe": "halo-breathe 4.5s ease-in-out infinite",
        "reveal-up": "reveal-up 0.8s cubic-bezier(0.22,1,0.36,1) both",
        "scan-line": "scan-line 4.5s ease-in-out infinite",
        drift: "drift 12s ease-in-out infinite",
        "drift-alt": "drift-alt 14s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
