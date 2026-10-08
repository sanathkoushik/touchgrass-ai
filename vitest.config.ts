import path from 'node:path'
import { defineConfig } from 'vitest/config'

// Unit tests run in plain Node on purpose: the engine and the Hono app are runtime-agnostic,
// so they do not need the Cloudflare Vite plugin (and its workerd process) to be tested.
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // The D1 tests start a real (local) workerd via Miniflare.
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
})
