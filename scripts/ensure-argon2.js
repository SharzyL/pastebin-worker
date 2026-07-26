import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const projectRoot = fileURLToPath(new URL("../", import.meta.url))
const argon2Root = join(projectRoot, "argon2")
const outputRoot = join(argon2Root, "pkg")
const stampPath = join(outputRoot, ".build-hash")
const requiredOutputs = ["argon2.js", "argon2.d.ts", "argon2_bg.wasm", "argon2_bg.wasm.d.ts", "package.json"]

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? sourceFiles(path) : [path]
  })
}

function buildHash() {
  const hash = createHash("sha256")
  const inputs = [
    join(argon2Root, "Cargo.toml"),
    join(argon2Root, "Cargo.lock"),
    ...sourceFiles(join(argon2Root, "src")),
    join(projectRoot, "package.json"),
  ].sort()

  hash.update("pastebin-worker:argon2-web:v2\0")
  for (const path of inputs) {
    hash.update(relative(projectRoot, path))
    hash.update("\0")
    hash.update(readFileSync(path))
    hash.update("\0")
  }
  return hash.digest("hex")
}

const expectedHash = buildHash()
const outputsExist = requiredOutputs.every((name) => existsSync(join(outputRoot, name)))
const existingHash = existsSync(stampPath) ? readFileSync(stampPath, "utf8").trim() : ""

if (outputsExist && existingHash === expectedHash) {
  console.log("Argon2 WASM is up to date")
  process.exit(0)
}

const wasmPackRunner = join(projectRoot, "node_modules", "wasm-pack", "run.js")
const result = spawnSync(
  process.execPath,
  [wasmPackRunner, "build", "argon2", "--target", "web", "--out-dir", "pkg", "--out-name", "argon2", "--release"],
  {
    cwd: projectRoot,
    stdio: "inherit",
  },
)
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)

writeFileSync(stampPath, `${expectedHash}\n`)
