// `wrangler types` refers to Durable Object classes as import("./worker/index"),
// which does not resolve under moduleResolution node16, so LIVE_ROOM would be
// typed as an error. Add the extension node16 requires.
import { readFileSync, writeFileSync } from "node:fs"

const path = "worker-configuration.d.ts"
const types = readFileSync(path, "utf8")
writeFileSync(path, types.replaceAll('import("./worker/index")', 'import("./worker/index.js")'))
