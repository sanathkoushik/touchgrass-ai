/// <reference types="node" />
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Keeps the browser bundle lean: walks the real import graph from the app entry (ignoring `import type`, which is
// erased at build time) and fails if anything server-only becomes reachable. Measured cost of one slip: zod alone was
// ~100 kB of JavaScript for every visitor.

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const EXTENSIONS = ['', '.ts', '.tsx', '/index.ts', '/index.tsx']
const FORBIDDEN = ['zod', 'hono', '@hono/zod-validator', 'wrangler', '@cloudflare/workers-types']

function resolveLocal(from: string, spec: string): string | null {
  const base = spec.startsWith('@/') ? join(SRC, spec.slice(2)) : spec.startsWith('.') ? resolve(dirname(from), spec) : null
  if (!base) return null
  for (const ext of EXTENSIONS) {
    const candidate = base + ext
    if (/\.(ts|tsx)$/.test(candidate) && existsSync(candidate)) return candidate
  }
  return null
}

/** Runtime imports only: `import type ...` and `export type ...` vanish from the bundle. */
function runtimeImports(file: string): string[] {
  const code = readFileSync(file, 'utf8')
  const out: string[] = []
  const re = /(?:^|\n)\s*(?:import|export)\s+(?!type\b)(?:[^'"\n;]*?\sfrom\s+)?['"]([^'"]+)['"]/g
  for (const m of code.matchAll(re)) out.push(m[1]!)
  // import('...') dynamic imports are still part of the browser build (as separate chunks)
  for (const m of code.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(m[1]!)
  return out
}

function reachableFromEntry(): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>()
  const packages = new Set<string>()
  const queue = [join(SRC, 'main.tsx')]
  while (queue.length) {
    const file = queue.pop()!
    if (files.has(file)) continue
    files.add(file)
    for (const spec of runtimeImports(file)) {
      const local = resolveLocal(file, spec)
      if (local) queue.push(local)
      else if (!spec.startsWith('.') && !spec.startsWith('@/')) packages.add(spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]!)
    }
  }
  return { files, packages }
}

describe('browser bundle stays lean', () => {
  const { files, packages } = reachableFromEntry()

  it('actually walks the app (sanity check for this test itself)', () => {
    expect(files.size).toBeGreaterThan(20)
    expect(packages.has('react')).toBe(true)
    expect(packages.has('react-router-dom')).toBe(true)
  })

  it('never imports server-only packages', () => {
    for (const bad of FORBIDDEN) expect(packages.has(bad), `${bad} is reachable from the browser entry`).toBe(false)
  })

  it('never imports Worker code', () => {
    const worker = [...files].filter((f) => f.replace(/\\/g, '/').includes('/src/worker/'))
    expect(worker).toEqual([])
  })

  it('does not use the full Motion runtime or framer-motion directly', () => {
    expect(packages.has('framer-motion')).toBe(false)
  })
})
