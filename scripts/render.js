import { Liquid } from 'liquidjs'
import fs from 'fs'
import { spawnSync } from 'child_process'
import { ArgumentParser } from 'argparse'

function parseArgs() {
  const parser = ArgumentParser()
  parser.add_argument('-o', '--output', { required: true })
  parser.add_argument('-c', '--config', { required: true })
  parser.add_argument('-r', '--revision')
  parser.add_argument('file')
  return parser.parse_args()
}

function getCommitHash() {
  const stdout = spawnSync('git', ['rev-parse', '--short=6', 'HEAD']).stdout
  return stdout === null ? 'unknown' : stdout.toString().trim()
}

function main() {
  const args = parseArgs()

  const conf = JSON.parse(fs.readFileSync(args.config).toString())
  conf.COMMIT_HASH_6 = getCommitHash()
  conf.DEPLOY_DATE = new Date().toString()

  const engine = new Liquid()
  const rendered = engine.renderFileSync(args.file, conf)
  fs.writeFileSync(args.output, rendered)
}

main()
