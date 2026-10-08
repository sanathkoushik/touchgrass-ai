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
