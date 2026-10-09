import { z } from 'zod'
import { evidenceFacts, planDuration } from '@/shared/engine'
import type { Context, ScoredActivity, UserProfile } from '@/shared/engine/types'
import type { AiRequest } from './provider'

/** What we ask the model to do. Deliberately small: the code already made the hard decisions. */
const SYSTEM_PROMPT = [
  'You help one person choose a real-world activity to do right now instead of using their phone.',
  'You get up to 3 candidate activities that are already confirmed possible right now, plus facts about the person.',
  'Reply with ONLY a JSON object: {"activity_id": string, "reason": string, "first_step": string}.',
  'Rules:',
  '- activity_id must be exactly one of the candidate ids.',
  '- reason: one or two short sentences, second person, warm and plain. Use ONLY the facts provided. Never invent history, preferences, places, people, weather or numbers.',
  '- first_step: one concrete action that can start within a minute. You may add one small playful twist that fits the person, but it must stay faithful to the chosen activity.',
  '- No emojis, markdown, links or quotation marks around the whole reply.',
].join('\n')

export interface PromptCandidate {
  scored: ScoredActivity
  facts: string[]
}

/** What the validator needs to know about the prompt we sent. */
export interface PromptContext {
  candidates: PromptCandidate[]
  ctx: Context
}

function join(list: string[], max: number): string[] {
  return list.slice(0, max)
}

/** Builds a compact prompt (a few hundred tokens) so each call spends as few free-tier neurons as possible. */
export function buildPrompt(
  profile: UserProfile,
  ctx: Context,
  candidates: ScoredActivity[],
  retryHint?: string,
): { request: AiRequest; context: PromptContext } {
  const withFacts: PromptCandidate[] = candidates.map((scored) => ({ scored, facts: evidenceFacts(scored, ctx) }))

  const payload = {
    person: {
      likes: join(profile.preferences.likes, 8),
      dislikes: join(profile.preferences.dislikes, 8),
      motivators: join(profile.motivators, 6),
      company_preference: profile.preferences.social_preference,
    },
    now: {
      minutes_available: ctx.duration_limit,
      energy: ctx.mood,
      friend_free: ctx.social_available,
      local_hour: ctx.hour,
    },
    candidates: withFacts.map(({ scored, facts }) => ({
      id: scored.activity.id,
      title: scored.activity.title,
      minutes: planDuration(scored.activity, ctx),
      default_first_step: scored.activity.firstStep,
      facts,
    })),
  }

  const user = JSON.stringify(payload) + (retryHint ? `\nYour previous reply was rejected: ${retryHint}. Reply with the JSON object only.` : '')
  return { request: { system: SYSTEM_PROMPT, user, maxTokens: 400, temperature: 0.4 }, context: { candidates: withFacts, ctx } }
}

// ------------------------------------------------------------------ parsing

/** Finds the first balanced {...} object in text (models sometimes add prose or code fences). */
export function extractJsonObject(text: string): unknown | null {
  const start = text.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1))
        } catch {
          return null
        }
      }
    }
  }
  return null
}

const choiceSchema = z.object({
  activity_id: z.string(),
  reason: z.string().trim().min(20).max(220),
  first_step: z.string().trim().min(15).max(200),
})

export interface AiChoice {
  activityId: string
  reason: string
  firstStep: string
}

export type Validation = { ok: true; choice: AiChoice } | { ok: false; reason: string }

const FORBIDDEN_MARKUP = /https?:\/\/|www\.|[`*#<>[\]{}|]|@\w|\\n|\\"/
/** Claims about history that only count if our own facts said them. */
const HISTORY_CLAIMS = /\b(always|never|every time|every day|last time|last week|yesterday|usually|as usual|again|favou?rite|you love|you adore)\b/i

const numbersIn = (s: string): number[] => (s.match(/\d+/g) ?? []).map(Number)

/** Filler words that appear in nearly every sentence and say nothing about which activity it is. */
const STOP_WORDS = new Set([
  'your', 'with', 'that', 'this', 'then', 'they', 'them', 'from', 'have', 'into', 'what', 'when', 'will',
  'just', 'than', 'there', 'here', 'some', 'more', 'most', 'over', 'back', 'down', 'away', 'before', 'after',
  'while', 'about', 'first', 'start', 'next', 'take', 'make', 'that', 'could', 'would', 'minute', 'minutes',
])

/** Meaningful words, cut to 5 letters so "walking" ~ "walk" and "photograph" ~ "photography". */
const stems = (s: string): Set<string> =>
  new Set((s.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !STOP_WORDS.has(w)).map((w) => w.slice(0, 5)))

/**
 * Accepts the model's reply only if it is safe to show. Returns a short reason when rejecting,
 * which is shown back to the model on the single retry (never to the user).
 */
export function validateChoice(raw: unknown, pc: PromptContext): Validation {
  const parsed = choiceSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return { ok: false, reason: `invalid JSON shape at "${issue?.path.join('.') ?? ''}"` }
  }
  const { activity_id, reason, first_step } = parsed.data

  const chosen = pc.candidates.find((c) => c.scored.activity.id === activity_id)
  if (!chosen) return { ok: false, reason: 'activity_id is not one of the candidate ids' }

  if (FORBIDDEN_MARKUP.test(reason) || FORBIDDEN_MARKUP.test(first_step)) {
    return { ok: false, reason: 'contains links, markdown or special characters' }
  }

  // Everything the model was allowed to know. Numbers outside this set were invented.
  const factText = pc.candidates.flatMap((c) => c.facts).join(' ')
  const knownText = [factText, ...pc.candidates.map((c) => c.scored.activity.firstStep)].join(' ')
  const allowedNumbers = new Set<number>([
    ...numbersIn(knownText),
    ...pc.candidates.map((c) => planDuration(c.scored.activity, pc.ctx)),
    pc.ctx.duration_limit,
  ])

  for (const n of numbersIn(reason)) {
    if (!allowedNumbers.has(n)) return { ok: false, reason: `reason mentions the number ${n}, which was not provided` }
  }
  for (const n of numbersIn(first_step)) {
    if (!allowedNumbers.has(n) && n > pc.ctx.duration_limit) {
      return { ok: false, reason: `first_step mentions ${n}, more than the minutes available` }
    }
  }

  const claim = HISTORY_CLAIMS.exec(reason)
  if (claim && !new RegExp(`\\b${claim[0]}\\b`, 'i').test(factText)) {
    return { ok: false, reason: `reason claims "${claim[0]}", which the facts do not support` }
  }

  // The twist must still be about the chosen activity.
  const a = chosen.scored.activity
  const activityWords = stems([a.title, a.firstStep, a.tags.join(' '), a.id.replace(/_/g, ' ')].join(' '))
  if (![...stems(first_step)].some((w) => activityWords.has(w))) {
    return { ok: false, reason: 'first_step does not match the chosen activity' }
  }

  return { ok: true, choice: { activityId: activity_id, reason: reason.trim(), firstStep: first_step.trim() } }
}
