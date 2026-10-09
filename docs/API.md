# TouchGrass AI — API (Stage 5)

Hono on a Cloudflare Worker. Source: `src/worker/`. Contract (validation + types): `src/shared/api.ts`.

## Conventions

- **Identity:** every `/api/*` call except `/api/health` needs `X-Session-Id: <uuid>`. The browser generates it once
  (`crypto.randomUUID()`) and keeps it in `localStorage`. There are no accounts (a non-goal). The server stores only
  `SHA-256(session id)`, never the id itself.
- **Errors:** always JSON: `{ "error": { "code": "...", "message": "...", "details?": [{ "path", "message" }] } }`.
- **Validation:** strict. Unknown fields are rejected (400), not ignored. Bodies are capped at 16 KB (413).
- **Caching:** all API responses are `Cache-Control: no-store`.
- **Storage:** Cloudflare D1 (binding `DB`) behind the `Repository` interface. Schema: `migrations/`. Why D1 and not MongoDB: `docs/DECISIONS.md`.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/health`, `/api/health` | Liveness. No session needed. |
| POST | `/api/onboarding` | Create or replace the profile. |
| GET | `/api/profile` | Profile + stats (`recommendations`, `responded`, `completed`, `completion_rate`). |
| PATCH | `/api/profile` | Partial update (preferences are merged field by field). |
| DELETE | `/api/profile` | Delete the profile and all events. |
| POST | `/api/recommend` | One recommendation. Needs a profile (404 `profile_not_found` otherwise). |
| POST | `/api/feedback` | Report `completed` / `partial` / `skipped` / `changed`. May be corrected later. |
| GET | `/api/history?limit=20` | Recent recommendations with outcomes, newest first. |

### POST /api/recommend

```json
{ "duration_limit": 60, "mood": "low", "social_available": true, "utc_offset_minutes": 330 }
```

`duration_limit` (5-480) is required. `mood` defaults to `ok`, `social_available` to `false`. `utc_offset_minutes`
(browser: `-new Date().getTimezoneOffset()`) tells the server the user's local time of day; without it the edge
time zone is used, then UTC. Weather is not accepted from clients: the server will fetch it itself (Phase 9).
`use_ai` (default `true`) lets a client skip the AI and get the instant deterministic pick, which also saves the
free daily AI quota.

Response: `recommendation_id`, `activity_id`, `title`, `duration_min`, `reason`, `first_step`, `social_mode`,
`fallback` (a gentler second option, or null), `source` (`ai` or `deterministic`), `model` (only when `source` is
`ai`) and `persisted` (false if saving failed; the recommendation is still valid).

**How the AI fits in.** The engine always runs first and produces a complete answer. If an AI is available (and
`use_ai` is not false), Gemma 4 may choose among the top 3 candidates and word the `reason` and `first_step`. Title,
duration and social mode always come from the catalog. The reply is validated (must pick an offered activity; no
links, markdown, invented numbers or invented history; first step must match the activity), retried once, and on any
failure, timeout, busy signal or exhausted quota the deterministic answer is returned unchanged. Clients never see
an AI error. After a failure the Worker skips the AI for a while (30 s busy, 10 s error, until 00:00 UTC for quota).

### POST /api/feedback

```json
{ "recommendation_id": "r_...", "outcome": "skipped", "skip_reason": "boring" }
```

`enjoyment` (1-5) is only valid with `completed`/`partial`; `skip_reason` only with `skipped`/`changed`.
A session can only answer its own recommendations.

## Local testing

```
npm run dev -- --port 5188      # applies local DB migrations, then runs Vite + the Worker in the real workerd runtime
curl http://localhost:5188/health
npm test                        # engine, repository-contract and API tests (API + contract run on memory AND real local D1)
npm run db:reset:local          # wipe the local dev database
npm run dev:ai -- --port 5188   # same, but with the REAL Gemma 4 (needs `npx wrangler login`; spends free daily quota)
```

Plain `npm run dev` never needs a Cloudflare login and never spends AI quota: recommendations come from the engine
alone (`source: "deterministic"`).

## Decisions worth remembering

- Only **answered** recommendations teach the engine. Unanswered ones are stored as `pending` and ignored for learning
  (repetition handling for unanswered picks is part of Phase 10).
- If saving an event fails, `/api/recommend` still answers (`persisted: false`), per the failure-handling table in the report.
- `assets.run_worker_first` is set for `/api/*` and `/health` so a browser "navigation" to an API path can never be
  answered with `index.html`.
