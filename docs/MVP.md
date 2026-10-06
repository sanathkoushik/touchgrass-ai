# TouchGrass AI — MVP Definition (Phase 0)

## One-line product definition

**TouchGrass AI is an open-weight personal AI agent that learns what genuinely motivates a person and designs small, realistic real-world experiences they are likely to choose over passive screen use.**

Pitch: *"AI that learns what gets you outside."*

## Core question the agent answers

What is the best next real-world action for THIS person, at THIS time, under THESE constraints, given what has already worked or failed for them?

## MVP scope

- **Three activity families:** movement, outdoor exploration, social/skill.
- **One main recommendation** per request (plus at most one fallback). No feed, no lists of ten.
- **Loop:** onboarding -> recommend -> leave the screen -> tiny feedback -> learn -> recommend better.
- **Always works without an LLM:** a deterministic activity engine produces a valid recommendation if Gemma, MongoDB or weather fail.

## Definition of success

- Per recommendation: **started + completed + at least neutral/positive enjoyment.**
- Primary metric: meaningful real-world activity started because of the agent.
- Secondary: completion rate, enjoyment score, repeat success by activity type, time-to-first-action, skips with known reasons.
- **Anti-metric:** time spent inside the app.

## Explicit non-goals

- No social network or feed.
- No automatic phone blocking.
- No custom model fine-tuning.
- No giant maps/search system (maps are deferred until the core loop is useful without them).
- No streaks/points/badge gamification.
- No paid services or Pro-only UI components.

## Acceptance test (Phase 0)

The product can be explained in one sentence without mentioning the hackathon. ✔
