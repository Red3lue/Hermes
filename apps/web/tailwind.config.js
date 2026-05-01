/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        hermes: {
          50: "#f0f4ff",
          100: "#e0e9ff",
          200: "#c7d4ff",
          300: "#a4b4ff",
          400: "#7b8aff",
          500: "#5c5ff7",
          600: "#4740eb",
          700: "#3b31d1",
          800: "#312ba9",
          900: "#2c2985",
          950: "#1c1a52",
        },
      },
      fontFamily: {
        mono: ["'JetBrains Mono'", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
