/** @type {import('tailwindcss').Config} */
export default {
  content: ["./frontend/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        background: "var(--color-background)",
        foreground: "var(--color-foreground)",
        content1: "var(--color-content1)",
        divider: "var(--color-divider)",
        primary: {
          DEFAULT: "var(--color-primary)",
          50: "var(--color-primary-50)",
          100: "var(--color-primary-100)",
          foreground: "var(--color-primary-foreground)",
        },
        default: {
          100: "var(--color-default-100)",
          200: "var(--color-default-200)",
          300: "var(--color-default-300)",
          400: "var(--color-default-400)",
          500: "var(--color-default-500)",
          700: "var(--color-default-700)",
        },
        success: {
          DEFAULT: "var(--color-success)",
          50: "var(--color-success-50)",
          100: "var(--color-success-100)",
        },
        danger: "var(--color-danger)",
      },
      borderRadius: {
        medium: "var(--radius-medium)",
      },
    },
  },
}
