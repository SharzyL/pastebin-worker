import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config"

const cfg = defineWorkersConfig({
  assetsInclude: [ "frontend/*", "doc/*", "test/resources/*" ],

  test: {
    poolOptions: {
      workers: {
        wrangler: {
          configPath: "./wrangler.toml"
        },
      },
    },
  },
})

export default cfg
