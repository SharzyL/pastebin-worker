import { Liquid } from 'liquidjs'
import fs from 'fs'
import { ArgumentParser } from 'argparse'

function parseArgs() {
  const parser = ArgumentParser()
  parser.add_argument('-o', '--output', { required: true })
  parser.add_argument('-c', '--config', { required: true })
  parser.add_argument('file')
  return parser.parse_args()
}

function main() {
  const args = parseArgs()

  const conf = JSON.parse(fs.readFileSync(args.config).toString())
  const engine = new Liquid()
  const rendered = engine.renderFileSync(args.file, conf)
  fs.writeFileSync(args.output, rendered)
}

main()
