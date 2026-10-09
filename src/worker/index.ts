import { AiGate } from './ai/gate'
import { WorkersAiProvider, type AiBinding } from './ai/workers-ai'
import { createApp } from './app'
import { OpenMeteoProvider } from './context/open-meteo'
import { D1Repository } from './d1-repository'

// Shared by every request this Worker instance serves, so a quota or capacity problem is remembered
// and the next requests skip straight to the deterministic engine instead of waiting on the AI.
const aiGate = new AiGate()

// Live weather and city search from Open-Meteo (free, no key). Kept for the life of the Worker instance so its
// short-lived cache and failure cool-down work across requests.
const weather = new OpenMeteoProvider()

const app = createApp({
  context: weather,
  // Profiles and history live in Cloudflare D1 (binding `DB`, see wrangler.jsonc and migrations/).
  repo: (env) => new D1Repository(env.DB),
  ai: {
    // Gemma 4 on Workers AI (binding `AI`). If the binding is missing the app simply uses the engine alone.
    provider: (env) => {
      const binding = (env as { AI?: unknown }).AI
      return binding ? new WorkersAiProvider(binding as AiBinding) : null
    },
    gate: aiGate,
  },
})

export default app
