import { createApp } from './app'
import { D1Repository } from './d1-repository'

// Profiles and history live in Cloudflare D1 (binding `DB`, see wrangler.jsonc and migrations/).
// A repository is cheap to build, so each request gets one bound to that request's env.
const app = createApp({ repo: (env) => new D1Repository(env.DB) })

export default app
