import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config"

const cfg = defineWorkersConfig({
  test: {
    coverage: {
      provider: "istanbul", // v8 is not supported due for cf workers
      reporter: ["text", "json-summary", "html", "json"],
    },
    poolOptions: {
      workers: {
        wrangler: {
          configPath: "./wrangler.toml",
        },
      },
    },
  },
})

export default cfg
