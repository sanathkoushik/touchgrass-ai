# TouchGrass AI — project rules

Product: an AI agent that learns what gets a person outside. See docs/MVP.md. Success is the user leaving the screen; never optimize time-in-app.

## TouchGrass UI rules
1. Use shadcn/ui as the base system.
2. Prefer free/public Componentry, Cult UI and Aceternity registry items.
3. Never add a Pro-only component.
4. Install components through shadcn rather than copying random snippets.
5. Keep the first viewport lightweight.
6. Lazy-load WebGL, shader, particle and 3D effects.
7. Respect prefers-reduced-motion.
8. Never block initial render on API, AI or database calls.
9. Every UI addition must pass `npm run build` and a mobile/desktop smoke test.
10. Prefer one polished interaction over ten competing effects.

## Conventions
- Single animation runtime: import from `motion/react` (never add `framer-motion`).
- Use theme tokens (bg-card, text-primary, border-border...), not hard-coded colors.
- Dev server: `npm run dev -- --port 5199` (5173 is used by another app on this machine).
- Secrets only server-side; never commit .env / .dev.vars.
- List any notable new dependency/component license in THIRD_PARTY_NOTICES.md.

## Engine (src/shared/engine)
- Pure TypeScript, no browser/Worker APIs: shared by the React app, the Worker and tests.
- Pipeline: `filterActivities` (hard constraints, explains rejections) -> `scoreActivities` (observed behaviour overrides stated likes) -> `planDeterministic` (always returns a recommendation with no AI).
- `doorstep_reset` is the guaranteed fallback; never remove it from the catalog.
- Reasons shown to users must be derived from real evidence in `ScoredActivity.evidence`; never invent claims.
- Run tests with `npm test` (vitest). Test fixtures are synthetic and must never appear in the UI.

## Worker / API (src/worker, src/shared/api.ts)
- Hono app in `src/worker/app.ts` (`createApp({ repo, now })`); entry `src/worker/index.ts`. Contract + zod schemas in `src/shared/api.ts`. Docs: docs/API.md.
- Server code is checked by `tsconfig.worker.json` (no DOM lib). Never use browser APIs there. Re-run `npm run cf-typegen` after editing wrangler.jsonc bindings.
- Storage goes through the `Repository` interface only. Never touch a database from a route handler directly.
- API errors are always `{ error: { code, message, details? } }`. Never return raw exception text.
- Unit tests run in Node (`vitest.config.ts`, no Cloudflare plugin). For real-runtime checks run `npm run dev -- --port 5188` and curl it.
- Never log request bodies, headers or session ids.
