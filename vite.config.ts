import path from 'node:path'
import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const withAi = process.env.TG_AI === '1'

// https://vite.dev/config/
export default defineConfig({
  // cloudflare() runs the Hono Worker in the real Workers runtime during `vite dev`,
  // and builds both the static client and the Worker for deployment.
  // The Workers AI binding is opt-in (TG_AI=1): see the note in wrangler.jsonc.
  plugins: [react(), tailwindcss(), cloudflare(withAi ? { config: { ai: { binding: 'AI' } } } : {})],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
})
