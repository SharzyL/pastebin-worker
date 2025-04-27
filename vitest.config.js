import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    coverage: {
      provider: "istanbul", // v8 is not supported due for cf workers
      reporter: ["text", "json-summary", "html", "json"],
    },
  },
})
