import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { readFileSync } from "node:fs"
import * as toml from "toml"

export default defineConfig(({ mode }) => {
  const wranglerConfigPath = "wrangler.toml"
  const wranglerConfigText = readFileSync(wranglerConfigPath, "utf8")
  const wranglerConfigParsed = toml.parse(wranglerConfigText)

  function getVar(name) {
    if (wranglerConfigParsed.vars !== undefined && wranglerConfigParsed.vars[name] !== undefined) {
      return wranglerConfigParsed.vars[name]
    } else {
      throw new Error(`Cannot find vars.${name} in ${wranglerConfigPath}`)
    }
  }
  let deployUrl = getVar("DEPLOY_URL")

  return {
    plugins: [react(), tailwindcss()],
    define: {
      DEPLOY_URL: mode === "development" ? JSON.stringify("http://localhost:8787") : JSON.stringify(deployUrl),
      REPO: JSON.stringify(getVar("REPO")),
      MAX_EXPIRATION: JSON.stringify(getVar("MAX_EXPIRATION")),
      DEFAULT_EXPIRATION: JSON.stringify(getVar("DEFAULT_EXPIRATION")),
    },
    server: {
      port: 5173,
    },
  }
})
