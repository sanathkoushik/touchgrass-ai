# Decisions that depart from, or refine, the project report

## 001 — Cloudflare D1 instead of MongoDB Atlas (Stage 6, 2026-10-09)

**Report said:** MongoDB Atlas Free for profile, history and feedback memory (sections 8, 16, Phase 6).

**What we found when we checked, October 2026:**

1. The Atlas **Data API** (the HTTP route most Workers tutorials use) was shut down on 2025-09-30.
2. The official MongoDB Node driver can run in Workers, but every new isolate opens a fresh TCP + TLS +
   SCRAM-authenticated connection. A MongoDB engineer's own mitigation needs Durable Objects, and a developer in the same
   thread reported 1-2 s API latency. The driver is also ~1 MB.
3. Workers **Free** allows **10 ms CPU per request**. Password-hash (SCRAM) work during connection setup spends CPU, and
   the limit is only enforced on Cloudflare's servers, so it cannot be measured locally. We would only learn at deploy time.

These conflict with the report's own rules: no cold start on the critical path, no lag, zero cost.

**Decision:** use **Cloudflare D1** (SQLite, built into Workers) through a binding.

- Free tier (checked 2026-10-09): 5M rows read/day, 100k rows written/day, 5 GB storage.
- No connection setup, no secrets, no extra account (a Cloudflare account is needed for deployment anyway).
- Runs locally in the real `workerd` engine with no login, so every test in this repo exercises the real database engine.

**What stays the same:** all route code talks to the `Repository` interface (`src/worker/repository.ts`). A MongoDB
implementation can still be added later without touching routes, and the shared contract tests
(`repository.contract.test.ts`) would prove it behaves identically.

**Mapping from the report's collections:** `users` + preferences -> `profiles`; `recommendations` + `events` -> one
`events` table (a recommendation is an event that starts as `pending`); `signals` are derived by the engine from events,
not stored.

**Trade-offs accepted:** D1 is Cloudflare-specific (moving off it later means writing another `Repository`), and the
free daily write budget (100k rows) is a quota, not unlimited. Each recommendation costs ~2 writes, each feedback ~1.
Events older than 180 days are pruned on write to keep storage bounded.

## 002 — Gemma 4 on Workers AI, behind a swappable provider, with the engine as the guarantee (Stage 7, 2026-10-09)

**Question raised:** is Gemma the best choice, and can the Claude Pro plan or another free model be used instead?

**Findings (checked 2026-10-09):**

- Claude Pro does **not** include API access ("The Pro plan does not include API usage through the Claude Console";
  API usage is billed separately). A Claude API would be pay-as-you-go, not free, and not open-weight.
- No provider offers unlimited free inference, and free tiers change: Google cut one Gemini free model from 250 to
  20 requests/day (Dec 2025); OpenRouter's free models allow 50 requests/day (1,000 after a $10 top-up); Groq's free
  allowance is per-model and small.
- Gemma 4 26B A4B stays on Workers Free (Cloudflare changelog 2026-07-28). Free allowance: 10,000 Neurons/day, i.e.
  roughly 650 compact recommendations/day (estimate: ~900 input + ~250 output tokens each; real usage is logged).
- The task given to the model is small (choose among <= 3 pre-filtered candidates and word the result), so model
  size matters far less than availability, privacy and the hackathon's open-weight requirement (report section 24).

**Decision:** Gemma 4 26B A4B on Workers AI is the primary AI. It sits behind the `AiProvider` interface
(`src/worker/ai/provider.ts`), so another provider (Groq, OpenRouter, local Ollama) is one new class. "Never run out"
is guaranteed by the architecture, not by a provider: the deterministic engine produces a full answer every time, and
the AI only ever improves it. User chose this option (over adding Groq or switching to Claude).

**Measured with the real model (2026-10-09, `npm run test:live`):**

- Gemma 4 is a *reasoning* model. With thinking left on, it spent the whole token budget reasoning and returned an
  empty answer (400 tokens, 11.6 neurons, `content: null`). With `chat_template_kwargs.enable_thinking = false` the same
  call took 38 tokens, 1.7 neurons and returned clean JSON. Thinking is therefore always off.
- Real cost: about **6 neurons per recommendation** (the API reports exact `usage.neurons`), so roughly **1,600
  recommendations/day** inside the free 10,000-neuron allowance (my earlier estimate of 650 was too pessimistic).
- 20 controlled scenarios: 20/20 AI-written, 20/20 first try, 0 rejected replies after the fixes below; the AI chose a
  different activity than the engine's top pick in about 5 of 20 cases.
- Median latency about 2 s. There is a tail: single calls occasionally take 5-8 s in local dev, so the whole AI step
  has a hard 6 s budget and falls back to the engine. **Open item: re-measure after the first real deployment and tune.**

**What the validator caught in real replies, and what we changed:**

1. The model wrote "you love X" when the person only said they like X -> rejected (both fields), prompt now says "like/enjoy".
2. The model invented small details ("your favorite racket", "favorite snacks") -> `PREFERENCE_CLAIMS` check in both fields.
3. My own check wrongly rejected "a place you have never been" (the cafe walk's own wording) and the forced retry pushed
   requests past the time budget. Words like "never" are now allowed only if they appear in the CHOSEN activity's own
   text, never from another candidate. A unit test pins both directions.

## 004 — The screen shows the engine's pick first and upgrades it with the AI (Stage 8, 2026-10-09)

The AI step is usually ~2 s but has a tail of 5-8 s, and the report demands that nothing blocks the screen. So the UI
is two calls, not one: `POST /api/recommend {use_ai:false}` (engine pick, shown immediately) then
`POST /api/recommend/:id/upgrade` (Gemma improves that same recommendation, at most once, 6 s budget).

Measured in a real browser with real Gemma: engine pick on screen at ~0.8 s, AI wording faded in at ~2.8 s.

Rules that keep it trustworthy:
- A late AI answer is applied only if that exact recommendation is still on screen and the person has not tapped
  "Let's go"; otherwise it is dropped. The card never changes under someone who has already decided.
- If the AI picks a different activity, the stored event is updated in place, so history and feedback always match
  what the person actually saw.
- Failures are invisible: the pill "Personalizing…" simply disappears and the engine pick stays.
- Costs: the first call is free of AI; the upgrade is one attempt per recommendation (marked in `context.upgrade`).
  A bot could still spend the free daily quota by creating many recommendations; the app then degrades to the
  engine. Rate limiting is part of deployment hardening (Phase 12).

## 003 — The Workers AI binding is opt-in (`TG_AI=1`) (Stage 7, 2026-10-09)

Workers AI has no local emulation. Declaring the `ai` binding in `wrangler.jsonc` made `npm run dev` and every test
run fail without a Cloudflare login (and would spend free quota on every dev session). So:

- `wrangler.jsonc` declares only D1 and assets. `npm run dev` and `npm test` need no login and no network.
- `vite.config.ts` adds `{ ai: { binding: "AI" } }` only when `TG_AI=1`. Use `npm run dev:ai` for live AI testing and
  `npm run deploy` (which sets it) for production. Do not deploy with a plain `npm run build` + `wrangler deploy`,
  or the production Worker will have no AI (it would still work, engine-only).
- The Worker reads the binding defensively (`env.AI` may be absent) and falls back to the engine.

## 005 - Live context from Open-Meteo, location never stored (Stage 9)
- Weather, daylight (is_day, sunrise/sunset) and city search come from Open-Meteo: free, no key, real-time. Terms checked 2026-10-09: non-commercial use only, under 10,000 calls/day, attribution required (shown in the Plan screen). If the app is ever monetised, switch to their paid plan or another source.
- Privacy: location is opt-in (tap), rounded to ~1 km in the browser and again on the server, sent only to Open-Meteo, kept in this browser's localStorage only, never in D1 or logs. Cleared by "Delete my data".
- Resilience: 2 s timeout, 10-minute cache per ~1 km cell, 30 s cool-down after an outage; any failure means "plan without weather", never an error. Unknown WMO codes are not guessed.
- The place's own UTC offset drives "local hour", so daylight and late-night rules are right for the place chosen.
- Venue/map search (real nearby places) is NOT part of this stage; planned later as an optional improvement (OpenStreetMap).

## 006 - Behavioural learning and the size of the day (Stage 10)
- Report Phase 10 asks for completion/enjoyment signals, skip reasons, "likes X" separate from "X works at this time", minimum/normal/excellent modes, and observed behaviour over stated preference. Most signals already existed in the scorer; Stage 10 adds the modes and makes the learning VISIBLE in the reason line.
- **Modes** (`src/shared/engine/modes.ts`): minimum = the activity's shortest real version, nothing intense or far; excellent = as long as the time allows. `chooseMode` picks automatically ("immediate recovery" after two skipped answers) and the person's own choice always wins. Explanations name the real cause ("Your last two did not happen, so this one is small on purpose.") with no guilt wording.
- **Unanswered recommendations are neutral**: not answering is not a skip, so it never lowers a score or triggers a small start. (Revisit if people never answer; the alternative would be a mild repeat penalty.)
- **Goals** (report 7.1): optional, a +0.15 nudge per supported goal on the starting belief only. Real behaviour still overrides them (tested).
- **Reasons from evidence only**: "finished this N of M", "rated this X out of 5" (only 4+), "you said the last one was too far; this needs no travel" (only the most recent skip, only when the activity truly fixes it).
- **History** shows "What we have noticed" (best part of the day, best kind of activity, most common reason, favourite), each with its counts and only when there is enough data (3+ answers in a group).
- Bug found and fixed while testing: a PATCH that omitted `goals`/`best_windows` reset them to empty (zod `.default()` wrapped in `.optional()` still applies the default). Regression-tested.
- Deviation from the report's example event: stored `context.weather` is `{category, temp_c}` (not a bare string) and events also keep `mode`, `mode_cause` and `is_daylight`, so an AI upgrade rebuilds the same situation.

## 007 - Nearby places from OpenStreetMap (Stage 10)
- The report says "do not add maps/search until the core loop is useful without them" and lists "no giant maps system" as a non-goal. The core loop has been useful since Stage 8, and this stays small: up to three real place names with distances for the suggested activity, optional, loaded after the mission is on screen, with a link to the OSM entry. No map is drawn.
- Source: the public Overpass API (free, no key, ODbL). Attribution "OpenStreetMap contributors" is shown wherever places appear. Overpass requires a User-Agent (without one it answers 406).
- **Measured reality (2026-10-09):** the shared server is best-effort. The same query alternates between HTTP 200 (about 1 to 3 s) and 504 (after about 8 s), and my own testing triggered 429 rate limits. Queries that include relations time out in dense cities, so queries use nodes and ways only (large lakes and reserves mapped only as relations can be missed).
- **So reliability comes from caching, not hope:** per-instance memory (6 h), then a shared D1 table `place_cache` (24 h fresh; entries up to 14 days old are served if OpenStreetMap is down), a 60 s cool-down for the whole service on 429/503/network errors, and a 60 s cool-down for only the affected kind on a timeout or 504. No user id is stored in the cache; it holds public place names per ~1 km cell.
- Privacy: only the rounded location and a kind of place go to Overpass; the consent text names OpenStreetMap.
- Overpass policy: an app's queries count together across all its users, so very heavy use needs another provider or a self-hosted instance.

## 008 - Performance hardening and failure drills (Stage 11)
Measured with Lighthouse (mobile profile: simulated slow 4G, 4x slower CPU) on the production build served by `wrangler dev`. Before -> after:

| | Home | Plan |
|---|---|---|
| Performance | 87 -> 91 | 92 -> 94 |
| Accessibility | 100 -> 100 | 96 -> 100 |
| Best practices | 96 -> 100 | 96 -> 100 |
| SEO | 91 -> 100 | 91 -> 100 |
| First paint | 2.7 s -> 1.9 s | 2.6 s -> 2.3 s |
| Blocking time | 180 -> 110 ms | 70 -> 30 ms |
| Main script (gzip) | 194 -> 128 kB | |

Slow 3G (400 kbps, 400 ms RTT): Home first paint 6.1 s -> 4.9 s. Pages other than Home still need the script before anything appears (about 8.5 s on 3G); Home's largest paint stays about 3.2 s because React re-creates the headline.

What changed and why:
- **zod left the browser** (it is server-only). Cause: browser code imported modules that import zod. Fix: `shared/geo.ts` and a split `places-schema.ts`. A guard test walks the browser import graph and fails if zod, hono or Worker code becomes reachable.
- **Pages load on demand** (only Home and the layout are in the main bundle) and Home pre-loads the next page after 2 s (not on "data saver").
- **Motion's engine loads lazily** (`LazyMotion`, `m.*`, domMax because the halo button uses layout animation): 25 kB gzip off the first load.
- **First-paint shell**: the Home headline is in index.html, so it paints before any JavaScript; React then replaces it with identical layout (verified to the pixel).
- **CSS inlined into index.html** by a tiny build plugin (the CSS and the script were sharing a slow connection and the CSS lost). Safe for an SPA whose HTML loads once per visit.
- **Strict CSP, generated at build time** with exact SHA-256 hashes for the two inline blocks (no blanket unsafe-inline), plus long-lived caching for hashed files, nosniff, referrer and permissions policy. The browser only talks to its own origin; weather and places go through the Worker. Verified: no violations on any route.
- **"No profile yet" is a normal 200** (`GET /api/profile` -> `{profile:null}`), so a first visit logs no console error.
- `npm run preview` was broken (Vite preview cannot run this Worker); it now serves the built output with `wrangler dev`.

Failure drills (all automated, plus real-browser checks):
- **Database down**: every data route answers a clean 503 `storage_unavailable` with nothing leaked. The browser keeps a copy of the last profile and sends it as `fallback_profile` ONLY then, so a real recommendation still comes back (unsaved, no history).
- **Server unreachable** (network error, 5xx, HTML instead of JSON): the browser plans on the device with the same engine (loaded on demand), from the profile copy. It says so ("made on your device, will not be remembered") and never claims weather or history it cannot know. If the server answered on purpose (no profile, invalid request) the answer is respected.
- **AI overloaded or hung**: engine pick within the time budget. Found and fixed a real hang: the deadline was only enforced by providers; `refine` now enforces it too.
- **Weather down**: planning continues without weather. **All three down at once**: still a real recommendation.
- Deferred to Phase 12: per-client rate limiting (needs the Cloudflare rate-limit binding) and Sentry.

## 009 - The Meadow: a reward system without streaks (user-requested, 2026-10-11)
The report lists "no streaks/points/badge gamification" as a non-goal and "time spent in the app" as the anti-metric. The product owner asked for a way to make people feel good about what they did and keep coming back. We chose the one design that serves that without the usual harms, and recorded the deviation here.

What it is:
- **The Meadow**: a picture that grows with the minutes the person really spent outside (blades of grass), plus one flower per mission by kind. It never wilts, nothing is ever taken away, skipping a day costs nothing. There is no streak, no points, no levels, no leaderboard, no timer pressure.
- **Honest numbers.** Minutes come from the clock between "Let's go" and "I am back" (the person can correct it). Credit is capped at 1.5x the plan (at least 15 min) so a forgotten phone cannot inflate anything. A skip or a swap adds nothing but never subtracts. The app cannot see device screen time (browsers do not expose it), so it says "outside", not "away from the screen".
- **13 milestones**, earned once and kept (first step, 1 h / 5 h / 24 h outside, 10 / 25 missions, a bit of everything, five different things, early start, an evening outside, welcome back after 7+ days, 10 side quests, three 5/5 ratings). Each is computed from real answers and shown with the day it was earned. "Welcome back" rewards RETURNING after a break (no catching up).
- **Side quests** (the report's scavenger/photo challenges): two small things to look for during a mission, chosen deterministically from the mission id (the same two after a reload or offline). They make the person a participant while they are out, instead of waiting for it to end.
- **Coming back**: if the person leaves mid-mission and reopens the app, Home says "I am back" with how long ago they set off, and a quiet banner on other pages does the same. No push notifications, no sounds, no nagging.
- **Celebration** after a mission: a count-up of the minutes added, the meadow growing, new milestones, and the next goal. Reduced-motion users get the same screen without the animation.
- **This week**: the last seven days as bars, with "X more than last week" shown ONLY when it is true and positive. A quiet week says "A fresh week. Nothing to catch up on."

Storage: migration 0003 adds `minutes_outside` and `quests_done` to events; the planned minutes are stored in the event context. Completed and partial missions are never pruned (the 180-day retention now only removes skipped, swapped and unanswered events), so the meadow cannot shrink as time passes. A person can still correct their own answer (change "did it" to "skipped") and "Delete my data" removes everything.

Why not streaks: they reward opening the app and punish a missed day, which teaches people to tap "done" to keep a number alive and to quit the day it breaks. That works against the product's real goal (people choosing the real world), and against "never optimize time in the app".
