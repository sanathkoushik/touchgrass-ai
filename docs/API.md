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
| POST | `/api/recommend/:id/upgrade` | Ask the AI to improve a recommendation that is already on screen. Once per recommendation. |
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

### POST /api/recommend/:id/upgrade  (engine pick first, AI second)

This is how the website avoids ever waiting on the AI. The screen calls `/api/recommend` with `use_ai: false`, shows
the engine's pick at once, then calls this endpoint to let Gemma improve **that same recommendation**.

Always `200` with `{ "upgraded": false, "reason": ... }` when the AI cannot help, so the screen just keeps what it has:

| `reason` | Meaning |
|---|---|
| `ai_unavailable` | No AI is configured (plain `npm run dev`). Answered instantly. |
| `ai_cooling_down` | The AI recently failed or is out of quota; not even tried. |
| `already_attempted` | This recommendation was already upgraded (or tried). Each gets **one** attempt, so retrying cannot burn the free quota. |
| `ai_failed` | The AI timed out, was busy, or its reply failed validation. |

When `upgraded` is true, `recommendation` carries the same `recommendation_id` with new wording (and possibly a
different activity, which is then also what history and feedback refer to). Errors: `404` unknown id / not yours,
`409 already_answered` (answered recommendations are history and are never rewritten), `400` bad id.

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

## Live context (Stage 9)

All optional. A location is only ever sent with the person's consent, is rounded to 2 decimals (~1 km) and is never stored.

- `POST /api/context` body `{ location: {lat, lon} }` -> `{ available, conditions?: { weather: {category, temp_c}, daylight: 'day'|'night', sunrise?, sunset? } }`. `available:false` when the weather service cannot be reached (still HTTP 200).
- `POST /api/places` body `{ q }` (2-60 chars) -> `{ available, places: [{name, region?, country?, lat, lon}] }` (city search, Open-Meteo geocoding).
- `POST /api/recommend` accepts `location`; the response gains `context` (the conditions it was made with). Only category and temperature are stored with the event.

## Stage 10: sizes, goals, preparation, nearby places

- `POST /api/recommend` accepts `mode`: `'auto'` (default), `'minimum'`, `'normal'` or `'excellent'`. `auto` is decided by the server: a small start after the last two ANSWERED recommendations were skipped, or at low energy; a stretch at high energy after two completed-and-enjoyed (4+) ones; otherwise normal. Unanswered recommendations never count. The response carries `mode` and `preparation: string[]` (equipment and optional extras from the activity's own data).
- Profile gains optional `goals` (`move_more | be_outdoors | feel_calmer | meet_people | try_new_things | be_creative`). A PATCH that omits `goals` (or `best_windows`) leaves them unchanged.
- `POST /api/nearby` body `{ location: {lat, lon}, activity_id }` -> `{ available, kind?: {id, label}, places: [{name, distance_m, osm}] }`. At most 3 places, nearest first. `available:false` when OpenStreetMap could not be reached; activities with no place (home, any street) return an empty list.

## Stage 11 changes

- `GET /api/profile` answers `200 { "profile": null }` when there is no profile yet (a normal first-visit state), instead of a 404. `PATCH /api/profile` and `POST /api/recommend` still answer 404 `profile_not_found`.
- Any storage failure answers `503 { error: { code: "storage_unavailable" } }` (never a raw 500). `POST /api/recommend` accepts `fallback_profile` (same shape as onboarding): used only when saved data is unreachable, in which case the response has `persisted: false`.

## Stage 12: the Meadow

- `POST /api/feedback` accepts `minutes_outside` (0-480) and `quests_done` (0-3), only for completed or partial. For those outcomes the response carries `reward: { credited_minutes, total_minutes, missions, quests_done, new_milestones[] }`; a milestone appears in `new_milestones` only the first time it is earned.
- `GET /api/meadow?utc_offset_minutes=330` -> total minutes, missions, side quests, minutes by kind, one flower per mission, the last 7 local days, all milestones (with when they were earned and progress), the nearest next milestone, and a favourite activity (after two of the same).
- Run `npm run db:migrate:local` (dev) and `npm run db:migrate:remote` (before deploying): migration 0003 is required or every data route answers 503.

## Stage 13: Mission Companion
- `POST /api/recommend`: accepts `desired_outcome` (clear_head, energise, break_routine, connect); responses include `companion` (note, steps, tiny_start, alternative) and `flow`.
- `POST /api/feedback`: also accepts `feeling`, `helper`, `barrier`, `would_repeat`, `note` (max 280), `has_photo`, `minutes_source`, `started_at`; responds with `adaptations`, `recognition`, `next_step`, `ask_to_avoid`. New skip reason `couldnt_start`.
- `GET /api/learned`, `POST /api/learned/respond` (confirm | dismiss | restore), `DELETE /api/learned` (start from scratch).
- `GET /api/memories`, `PATCH /api/memories/:id` (edit or remove note / photo flag). `GET /api/missions` (full records, used by "Download my data"). `GET /api/metrics`.
- `GET /api/admin/experiment`: requires `Authorization` token equal to `ADMIN_TOKEN`; anonymous aggregates only.
