// Manual probe: prints the RAW response of the real model so we can see its true shape. Spends a few neurons.
// Usage: node live/probe.mjs [maxTokens] [thinking: on|off]
import { getPlatformProxy } from 'wrangler'

const maxTokens = Number(process.argv[2] ?? 400)
const thinking = process.argv[3] ?? 'default'
const proxy = await getPlatformProxy({ configPath: 'wrangler.live.jsonc', persist: false })

const input = {
  messages: [
    { role: 'system', content: 'Reply with ONLY a JSON object: {"activity_id": string, "reason": string}. activity_id must be "a" or "b".' },
    { role: 'user', content: 'Pick one for a calm person with 30 minutes. Candidates: a = a walk, b = a nap.' },
  ],
  max_completion_tokens: maxTokens,
  temperature: 0.3,
  response_format: { type: 'json_object' },
}
if (thinking === 'off') input.chat_template_kwargs = { enable_thinking: false }

const t0 = Date.now()
try {
  const out = await proxy.env.AI.run('@cf/google/gemma-4-26b-a4b-it', input, { rejectIfBusy: true })
  console.log(JSON.stringify({ ms: Date.now() - t0, maxTokens, thinking, raw: out }, null, 2))
} catch (e) {
  console.log(JSON.stringify({ ms: Date.now() - t0, maxTokens, thinking, error: String(e?.message ?? e) }, null, 2))
}
await proxy.dispose()
