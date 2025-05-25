#!/usr/bin/env node

import { hashSync } from "bcrypt-ts"
import readline from "readline"

function main() {
  const args = process.argv.slice(2)
  let rounds = 8
  if (args.length === 2 && args[0] === "-n") {
    rounds = parseInt(args[1])
    if (isNaN(rounds)) {
      console.error(`cannot parse ${args[1]} as integer`)
      process.exit(1)
    } else if (rounds < 5) {
      console.error(`expected rounds at least 5 for security, get ${rounds}`)
      process.exit(1)
    } else if (rounds > 15) {
      console.error(`expected rounds at most 15 to prevent it being too slow, get ${rounds}`)
    }
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: null,
    terminal: true,
  })

  process.stderr.write("Enter password (max 72 bytes): ")
  rl.question("", (password) => {
    rl.close()
    try {
      const hash = hashSync(password, rounds)
      process.stdout.write("\n" + hash + "\n")
    } catch (err) {
      console.error(`Error: ${err.message}`)
      process.exit(1)
    }
  })
}

main()
