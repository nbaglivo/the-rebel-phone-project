// Stand-in for ffmpeg in tests: copies the file after -i to the last argument.
import { copyFileSync, writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const input = args[args.indexOf('-i') + 1]
if (input.includes('FAIL')) {
  console.error('fake-ffmpeg: boom')
  process.exit(1)
}
if (input.includes('HANG')) {
  // A stuck encode: half an output, then never exits.
  writeFileSync(args[args.length - 1], 'half')
  setInterval(() => {}, 1_000)
  await new Promise(() => {})
}
if (input.includes('SLOW')) await new Promise((r) => setTimeout(r, 300))
copyFileSync(input, args[args.length - 1])
