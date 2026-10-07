import path from 'node:path'
import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // cloudflare() runs the Hono Worker in the real Workers runtime during `vite dev`,
  // and builds both the static client and the Worker for deployment.
  plugins: [react(), tailwindcss(), cloudflare()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
})
