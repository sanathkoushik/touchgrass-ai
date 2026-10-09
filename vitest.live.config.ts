import path from 'node:path'
import { defineConfig } from 'vitest/config'

// Manual real-model checks (they spend free Workers AI quota): `npm run test:live`. Not part of `npm test`.
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  test: {
    environment: 'node',
    include: ['live/**/*.test.ts'],
    hookTimeout: 120_000,
    testTimeout: 600_000,
  },
})
