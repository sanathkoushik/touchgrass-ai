// Runs a command with extra environment variables, on any OS (Windows has no `VAR=1 cmd` syntax).
// Usage: node scripts/with-env.mjs TG_AI=1 -- vite --port 5199
import { spawnSync } from 'node:child_process'

const args = process.argv.slice(2)
const sep = args.indexOf('--')
if (sep === -1 || sep === args.length - 1) {
  console.error('Usage: node scripts/with-env.mjs NAME=value [NAME=value ...] -- command [args...]')
  process.exit(2)
}

const env = { ...process.env }
for (const pair of args.slice(0, sep)) {
  const eq = pair.indexOf('=')
  if (eq < 1) {
    console.error(`Bad variable "${pair}": expected NAME=value`)
    process.exit(2)
  }
  env[pair.slice(0, eq)] = pair.slice(eq + 1)
}

const [command, ...rest] = args.slice(sep + 1)
const result = spawnSync(command, rest, { stdio: 'inherit', env, shell: true })
process.exit(result.status ?? 1)
