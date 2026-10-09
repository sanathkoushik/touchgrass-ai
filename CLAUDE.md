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

## Database (Stage 6)
- Storage is Cloudflare D1 (binding `DB`), NOT MongoDB: see docs/DECISIONS.md before changing this.
- Schema changes are new numbered files in `migrations/` (never edit an applied one). `npm run dev` applies them locally; `npm run db:migrate:remote` applies them to production (needs a Cloudflare login).
- Every SQL statement uses `?` + `.bind()`; every query is scoped by `user_key`. Never build SQL from strings.
- Any new `Repository` method must be added to `repository.contract.test.ts` and pass on both Memory and D1.
- Free-tier budget: 100k rows written/day. Avoid per-request writes that are not needed.

## AI (Stage 7, src/worker/ai)
- The engine is the product; the AI only refines it. Every AI path must fall back to the deterministic recommendation and must never surface an AI error to the client.
- Talk to models only through `AiProvider`. Never import Workers AI types into routes or the engine.
- Model output is untrusted: it must pass `validateChoice` (offered activity only; no links, markdown, invented numbers or invented history; first step must match the activity). Do not loosen these checks to "get more AI answers".
- The prompt carries only compact, anonymous facts from `evidenceFacts`. Never put session ids, user keys, or free text from the user into it. Never log prompts or replies.
- The `AI` binding is opt-in via `TG_AI=1` (`npm run dev:ai`, `npm run deploy`). Do not add it to wrangler.jsonc: it would force a Cloudflare login for dev and tests. See docs/DECISIONS.md (002, 003).
- Tests use scripted fake providers. Real-model checks are manual because they spend the free daily quota: `npm run test:live` (20 scenarios, ~120 neurons; `TG_LIVE_N`, `TG_LIVE_ONLY`, `TG_LIVE_REPEAT` narrow it) and `node live/probe.mjs` (prints one raw reply). Re-run `test:live` after ANY change to the prompt, the validator or the model.
- Gemma 4 must be called with `chat_template_kwargs: { enable_thinking: false }`; with thinking on it returns an empty answer and wastes ~7x the neurons. Do not remove it.
- The whole AI step has a 6 s budget (`refineWithAi` default). Use the exact `usage.neurons` the API reports for budgeting.

## Screens (Stage 8: src/pages, src/hooks, src/lib)
- The browser talks to the server ONLY through `src/lib/api.ts` (typed, with timeouts, errors as `ApiError`). Never call `fetch` from a component.
- The mission flow lives in `useMission`: engine pick first (`use_ai:false`), then ONE background `upgrade`. The AI step must never block the screen, and a late upgrade must be dropped if the person has already acted. Do not "simplify" this into a single awaited AI call.
- All user-facing wording for engine values lives in `src/lib/vocab.ts` as `Record<Union, ...>`, so a new motivator/equipment/skip reason fails to compile until it has a label. Every interest chip must match a real activity tag (a test enforces it).
- Screens must render something useful immediately; profile/history load in the background (skeletons the same size as the final content, to avoid layout shift).
- Wording stays guilt-free: no streaks, no red failure marks, "Did not go" not "Failed".
- `PrimaryAction` sets one explicit accessible name (the Halo button splits its label into per-letter spans).
- Browser-test with plain `npm run dev`; use `npm run dev:ai` only to see the real AI upgrade (it spends free quota). Delete test data afterwards (`npm run db:reset:local` or DELETE /api/profile).

## Live context (Stage 9, src/worker/context, src/lib/location.ts)
- Weather comes only through `ContextProvider` (Open-Meteo). Any failure means "no weather", never an error to the client.
- Coordinates are rounded (`roundCoord`) and are NEVER stored, logged, or put in the AI prompt. Store only weather category/temp and daylight.
- Location is requested only from a user tap. The app must stay non-commercial while on the free Open-Meteo plan, and keep the attribution visible.

## Behavioural learning and places (Stage 10)
- Modes live in `src/shared/engine/modes.ts`. Unanswered recommendations are neutral. The person's chosen mode always beats `auto`. Never add shame wording (no "failed", "lazy", "should", streaks).
- Any sentence in a reason must come from `ScoredActivity.evidence`; add the evidence field first, then the sentence, then a test that it is NOT said when the evidence is absent.
- Zod: never wrap a `.default()` schema in `.optional()` for PATCH schemas; build the PATCH from the plain schema (see `goalList`/`windowList` in api.ts).
- Places: `OverpassProvider` + `PlaceCache` (src/worker/context). Queries are built from constants only, nodes and ways only (relations time out), always with a User-Agent. Do not hammer the public server when testing: it rate-limits (429) and the real feature depends on caching. Live probes belong in `live/`, run sparingly.
- Migrations so far: 0001 init, 0002 place_cache. Run `npm run db:migrate:remote` before deploying.
