#!/usr/bin/env node

import { create_password_hash } from "../argon2/pkg-node/argon2.js"
import { randomBytes } from "node:crypto"
import readline from "readline"

function main() {
  if (process.argv.length > 2) {
    console.error("Usage: pnpm password")
    process.exit(1)
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: null,
    terminal: true,
  })

  process.stderr.write("Enter password (Argon2id, m=8192 KiB, t=2, p=1): ")
  rl.question("", (password) => {
    rl.close()
    try {
      const hash = create_password_hash(password, randomBytes(16))
      process.stdout.write("\n" + hash + "\n")
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
      process.exit(1)
    }
  })
}

main()
