import { heroui } from "@heroui/react"

export default heroui({
  defaultTheme: "light",
  themes: {
    light: {},
    dark: {
      colors: {
        background: "#111111",
        primary: {
          DEFAULT: "#BEF264",
          foreground: "#111111",
        },
        focus: "#BEF264",
      },
    },
  },
})
