import { defineConfig } from "vitest/config"
import { cloudflareTest } from "@cloudflare/vitest-pool-workers"

export default defineConfig({
  test: {
    coverage: {
      provider: "istanbul", // v8 is not supported due for cf workers
      reporter: ["text", "json-summary", "html", "json"],
      exclude: ["**/test/**"],
    },
    projects: [
      defineConfig({
        plugins: [
          cloudflareTest({
            miniflare: {
              bindings: {
                BASIC_AUTH: {},
              },
            },
            wrangler: {
              configPath: "./wrangler.toml",
            },
          }),
        ],
        test: {
          name: "Workers",
          include: ["worker/test/**/*.spec.ts"],
          // BASIC_AUTH is mutable test state, and password hashing can block
          // unrelated Worker files when the pool runs them in parallel.
          fileParallelism: false,
          coverage: {
            provider: "istanbul", // v8 is not supported due for cf workers
            reporter: ["text", "json-summary", "html", "json"],
            exclude: ["**/test/**"],
          },
        },
      }),
      {
        extends: "frontend/vite.config.js",
        test: {
          include: ["frontend/test/**/*.spec.{ts,tsx}"],
          name: "Frontend",
          environment: "jsdom",
          coverage: {
            provider: "istanbul",
            reporter: ["text", "json-summary", "html", "json"],
            exclude: ["**/test/**"],
          },
        },
      },
      {
        test: {
          include: ["shared/test/**/*.spec.ts"],
          name: "Shared",
          environment: "node",
          coverage: {
            provider: "istanbul",
            reporter: ["text", "json-summary", "html", "json"],
            exclude: ["**/test/**"],
          },
        },
      },
    ],
  },
})
