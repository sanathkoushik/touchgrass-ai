// Applies any new D1 migrations to the LOCAL development database before `npm run dev`.
// stdin is closed on purpose: that makes Wrangler non-interactive, so it never stops to ask "continue?".
// Safe to run repeatedly: already-applied migrations are skipped.
import { spawnSync } from 'node:child_process'

const result = spawnSync('npx', ['wrangler', 'd1', 'migrations', 'apply', 'DB', '--local'], {
  stdio: ['ignore', 'inherit', 'inherit'],
  shell: true,
})
process.exit(result.status ?? 1)
