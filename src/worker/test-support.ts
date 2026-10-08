import { getPlatformProxy } from 'wrangler'
import initSql from '../../migrations/0001_init.sql?raw'
import { D1Repository } from './d1-repository'
import { MemoryRepository, type Repository } from './repository'

/**
 * Test-only. Builds either storage backend behind the same interface so one suite can run against both.
 * The D1 variant uses the real local D1 engine (SQLite via workerd) through Wrangler, NOT a mock, and applies the real migration.
 */
export type StorageKind = 'memory' | 'd1'
export const STORAGE_KINDS: readonly StorageKind[] = ['memory', 'd1']

export interface Harness {
  kind: StorageKind
  /** A repository on the shared storage. `nowMs` only affects D1 (creation time and retention cut-off). */
  create(nowMs?: () => number): Repository
  /** Wipes all data between tests. */
  reset(): Promise<void>
  /** The user keys that currently have a profile (for asserting only hashes are stored). */
  profileKeys(): Promise<string[]>
  dispose(): Promise<void>
}

/** Splits the migration file into statements (the file only uses simple `;`-terminated DDL). */
function statementsOf(sql: string): string[] {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
}

export async function makeHarness(kind: StorageKind): Promise<Harness> {
  if (kind === 'memory') {
    let repo = new MemoryRepository()
    return {
      kind,
      create: () => repo,
      reset: async () => {
        repo = new MemoryRepository()
      },
      profileKeys: async () => [...(repo as unknown as { profiles: Map<string, unknown> }).profiles.keys()],
      dispose: async () => {},
    }
  }

  // The real `DB` binding from wrangler.jsonc, backed by an ephemeral (in-memory) local D1 database.
  const proxy = await getPlatformProxy<Env>({ persist: false })
  const db = proxy.env.DB
  for (const stmt of statementsOf(initSql)) await db.prepare(stmt).run()

  return {
    kind,
    create: (nowMs) => new D1Repository(db, nowMs),
    reset: async () => {
      await db.batch([db.prepare('DELETE FROM events'), db.prepare('DELETE FROM profiles')])
    },
    profileKeys: async () => (await db.prepare('SELECT user_key FROM profiles').all<{ user_key: string }>()).results.map((r) => r.user_key),
    dispose: async () => {
      await proxy.dispose()
    },
  }
}
