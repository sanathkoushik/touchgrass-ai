# TouchGrass AI — API (Stage 5)

Hono on a Cloudflare Worker. Source: `src/worker/`. Contract (validation + types): `src/shared/api.ts`.

## Conventions

- **Identity:** every `/api/*` call except `/api/health` needs `X-Session-Id: <uuid>`. The browser generates it once
  (`crypto.randomUUID()`) and keeps it in `localStorage`. There are no accounts (a non-goal). The server stores only
  `SHA-256(session id)`, never the id itself.
- **Errors:** always JSON: `{ "error": { "code": "...", "message": "...", "details?": [{ "path", "message" }] } }`.
- **Validation:** strict. Unknown fields are rejected (400), not ignored. Bodies are capped at 16 KB (413).
- **Caching:** all API responses are `Cache-Control: no-store`.
- **Storage:** in-memory for now (per Worker instance, lost on restart). Stage 6 replaces it with MongoDB Atlas behind the
  same `Repository` interface.

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

Response: `recommendation_id`, `activity_id`, `title`, `duration_min`, `reason`, `first_step`, `social_mode`,
`fallback` (a gentler second option, or null), `source` (`deterministic` for now) and `persisted`
(false if saving failed; the recommendation is still valid).

### POST /api/feedback

```json
{ "recommendation_id": "r_...", "outcome": "skipped", "skip_reason": "boring" }
```

`enjoyment` (1-5) is only valid with `completed`/`partial`; `skip_reason` only with `skipped`/`changed`.
A session can only answer its own recommendations.

## Local testing

```
npm run dev -- --port 5188      # Vite + the Worker in the real workerd runtime
curl http://localhost:5188/health
npm test                        # engine + API tests (Node)
```

## Decisions worth remembering

- Only **answered** recommendations teach the engine. Unanswered ones are stored as `pending` and ignored for learning
  (repetition handling for unanswered picks is part of Phase 10).
- If saving an event fails, `/api/recommend` still answers (`persisted: false`), per the failure-handling table in the report.
- `assets.run_worker_first` is set for `/api/*` and `/health` so a browser "navigation" to an API path can never be
  answered with `index.html`.
