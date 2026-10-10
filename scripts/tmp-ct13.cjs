const fs = require('fs')
let s = fs.readFileSync('src/worker/repository.contract.test.ts', 'utf8')

// the old rule: skipped missions expired after 180 days. The new rule: only unanswered suggestions expire.
const a = "      await early.addEvent(U1, event('skip', { outcome: 'skipped' }))\n      const later = h.create(() => t0 + 400 * DAY)\n      await later.addEvent(U1, event('fresh'))\n      const ids = (await later.listEvents(U1, 10)).map((e) => e.recommendation_id).sort()\n      expect(ids).toEqual(['r_done', 'r_fresh', 'r_part'])"
if (!s.includes(a)) throw new Error('old retention assertion not found')
s = s.replace(a, "      await early.addEvent(U1, event('skip', { outcome: 'skipped' }))\n      await early.addEvent(U1, event('swap', { outcome: 'changed' }))\n      await early.addEvent(U1, event('never-answered'))\n      const later = h.create(() => t0 + 400 * DAY)\n      await later.addEvent(U1, event('fresh'))\n      const ids = (await later.listEvents(U1, 10)).map((e) => e.recommendation_id).sort()\n      // Every ANSWERED mission is kept, honest \"it did not happen\" ones included; only the unanswered suggestion expired.\n      expect(ids).toEqual(['r_done', 'r_fresh', 'r_part', 'r_skip', 'r_swap'])")
s = s.replace("it('NEVER prunes completed or partial missions, however old (the Meadow must not shrink)'", "it('NEVER prunes an answered mission, however old (the Meadow and what is learned must not shrink)'")

const marker = "  describe.runIf(kind === 'd1')('schema guards (D1)', () => {"
if (!s.includes(marker)) throw new Error('marker missing')
s = s.replace(marker, `  describe('answered missions and the companion fields', () => {
    it('lists every answered mission (done, partial, skipped, swapped) and never an unanswered one, newest first', async () => {
      await repo.addEvent(U1, event('a', { outcome: 'completed' }))
      await repo.addEvent(U1, event('b', { outcome: 'pending' }))
      await repo.addEvent(U1, event('c', { outcome: 'skipped' }))
      await repo.addEvent(U1, event('d', { outcome: 'changed' }))
      await repo.addEvent(U1, event('e', { outcome: 'partial' }))
      expect((await repo.listAnswered(U1, 10)).map((e) => e.recommendation_id)).toEqual(['r_e', 'r_d', 'r_c', 'r_a'])
      expect((await repo.listAnswered(U1, 2)).map((e) => e.recommendation_id)).toEqual(['r_e', 'r_d'])
      expect(await repo.listAnswered(U2, 10)).toEqual([])
    })

    it('stores when they set off and what they told us afterwards, and returns it unchanged', async () => {
      await repo.addEvent(U1, event('x'))
      const e = (await repo.getEvent(U1, 'r_x'))!
      expect(e).not.toHaveProperty('started_at')
      expect(e).not.toHaveProperty('reflection')
      const reflection = { feeling: 'calmer', helper: 'noticing_things', barrier: 'too_tired', would_repeat: 'yes', note: 'Sitting felt easier than walking today.', has_photo: true, minutes_source: 'measured' } as const
      await repo.updateEvent(U1, { ...e, outcome: 'completed', started_at: '2026-10-07T12:00:00.000Z', reflection })
      expect(await repo.getEvent(U1, 'r_x')).toMatchObject({ started_at: '2026-10-07T12:00:00.000Z', reflection })
      expect((await repo.listAnswered(U1, 5))[0]).toMatchObject({ reflection })
    })

    it('replaces the reflection when the person corrects it, and clears it when they remove everything', async () => {
      await repo.addEvent(U1, event('y'))
      const e = (await repo.getEvent(U1, 'r_y'))!
      await repo.updateEvent(U1, { ...e, outcome: 'completed', reflection: { feeling: 'same', note: 'First thought.' } })
      await repo.updateEvent(U1, { ...(await repo.getEvent(U1, 'r_y'))!, reflection: { feeling: 'calmer' } })
      expect((await repo.getEvent(U1, 'r_y'))!.reflection).toEqual({ feeling: 'calmer' })
      const { reflection: _gone, ...without } = (await repo.getEvent(U1, 'r_y'))!
      await repo.updateEvent(U1, without)
      expect(await repo.getEvent(U1, 'r_y')).not.toHaveProperty('reflection')
    })

    it('keeps a note with quotes, emoji and non-latin text exactly as written (no injection, no mangling)', async () => {
      await repo.addEvent(U1, event('n'))
      const e = (await repo.getEvent(U1, 'r_n'))!
      const note = `It's "lovely" \\\\ ' ; DROP TABLE events; -- 🌿 பூங்கா \\n second line`
      await repo.updateEvent(U1, { ...e, outcome: 'completed', reflection: { note } })
      expect((await repo.getEvent(U1, 'r_n'))!.reflection?.note).toBe(note)
      expect((await repo.listEvents(U1, 5)).length).toBe(1)
    })

    it('counts the experiment arms across everyone without identifying anyone', async () => {
      const ctxFor = (flow?: 'companion' | 'classic') => ({ duration_limit: 30, mood: 'ok' as const, social_available: false, hour: 12, ...(flow ? { flow } : {}) })
      await repo.addEvent(U1, event('1', { outcome: 'completed', enjoyment: 5, context: ctxFor('companion') }))
      await repo.addEvent(U1, event('2', { outcome: 'skipped', context: ctxFor('companion') }))
      await repo.addEvent(U2, event('3', { outcome: 'completed', enjoyment: 3, context: ctxFor('classic') }))
      await repo.addEvent(U2, event('4', { outcome: 'pending', context: ctxFor('classic') }))
      await repo.addEvent(U2, event('5', { outcome: 'partial', context: ctxFor() })) // older event with no flow: counts as companion
      const e = (await repo.getEvent(U1, 'r_1'))!
      await repo.updateEvent(U1, { ...e, reflection: { would_repeat: 'yes', feeling: 'calmer' } })

      const stats = (await repo.flowStats()).sort((a, b) => (a.flow < b.flow ? -1 : 1))
      expect(stats).toEqual([
        { flow: 'classic', recommendations: 2, started: 1, full: 1, partial: 0, declined: 0, unanswered: 1, average_enjoyment: 3, would_repeat_yes: 0, with_reflection: 0 },
        { flow: 'companion', recommendations: 3, started: 2, full: 1, partial: 1, declined: 1, unanswered: 0, average_enjoyment: 5, would_repeat_yes: 1, with_reflection: 1 },
      ])
      expect(JSON.stringify(stats)).not.toMatch(/a{20}|b{20}|r_/) // no user keys, no recommendation ids
    })

    it('is empty when there is nothing to count', async () => {
      expect(await repo.flowStats()).toEqual([])
    })
  })

  describe.runIf(kind === 'd1')('companion fields (D1 only)', () => {
    it('shrugs off a reflection that cannot be read, instead of breaking the person\\'s history', async () => {
      await repo.addEvent(U1, event('bad'))
      await h.rawExec?.("UPDATE events SET reflection = '{not json' WHERE recommendation_id = 'r_bad'")
      const e = await repo.getEvent(U1, 'r_bad')
      expect(e).not.toBeNull()
      expect(e).not.toHaveProperty('reflection')
    })
  })

` + marker)
fs.writeFileSync('src/worker/repository.contract.test.ts', s)

// harness: a tiny raw-SQL escape hatch for the one D1-only corruption test
let t = fs.readFileSync('src/worker/test-support.ts', 'utf8')
t = t.replace("  dispose(): Promise<void>\n}", "  /** D1 only: run a raw statement (used to simulate corrupt data). */\n  rawExec?(sql: string): Promise<void>\n  dispose(): Promise<void>\n}")
t = t.replace("    profileKeys: async () => (await db.prepare('SELECT user_key FROM profiles').all<{ user_key: string }>()).results.map((r) => r.user_key),", "    profileKeys: async () => (await db.prepare('SELECT user_key FROM profiles').all<{ user_key: string }>()).results.map((r) => r.user_key),\n    rawExec: async (sql) => {\n      await db.prepare(sql).run()\n    },")
fs.writeFileSync('src/worker/test-support.ts', t)
