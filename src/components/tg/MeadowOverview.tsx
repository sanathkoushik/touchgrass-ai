import { Circle, Sparkles } from 'lucide-react'
import type { MeadowResponse } from '@/shared/api'
import { formatMinutes } from '@/shared/meadow'
import { earnedOn, remainingText, weekdayShort } from '@/lib/meadow-text'
import { cn } from '@/lib/utils'
import { Meadow } from './Meadow'

const KIND_LABEL = { movement: 'Moving', exploration: 'Exploring', social_skill: 'Social and skill' } as const

type Props = { summary: MeadowResponse }

/** Everything the person has added up, from their own answers. Nothing here can go down. */
export function MeadowOverview({ summary }: Props) {
  const { total_minutes, missions, quests_done, week, milestones, next, minutes_by_family } = summary
  const maxDay = Math.max(30, ...week.days.map((d) => d.minutes))
  const earned = milestones.filter((m) => m.earned)
  const waiting = milestones.filter((m) => !m.earned)
  const kinds = (Object.keys(KIND_LABEL) as (keyof typeof KIND_LABEL)[]).filter((k) => minutes_by_family[k] > 0)
  const moreThanLastWeek = week.minutes > week.last_week_minutes && week.last_week_minutes > 0 ? week.minutes - week.last_week_minutes : 0
  const nextText = next ? remainingText(next) : null

  return (
    <div className="space-y-8">
      <div className="relative overflow-hidden rounded-2xl border bg-card shadow-xl shadow-black/30">
        <Meadow minutes={total_minutes} flowers={summary.flowers} missions={missions} className="aspect-[2/1] rounded-none sm:aspect-[5/2]" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-background/90 via-background/55 to-transparent px-6 pt-16 pb-5">
          <p className="font-display text-4xl font-medium tracking-tight sm:text-5xl">
            {total_minutes > 0 ? formatMinutes(total_minutes) : 'Just seedlings'}
            <span className="ml-2 text-xl text-muted-foreground sm:text-2xl">{total_minutes > 0 ? 'outside' : 'so far'}</span>
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {missions > 0
              ? `from ${missions} mission${missions === 1 ? '' : 's'}${quests_done > 0 ? ` and ${quests_done} side quest${quests_done === 1 ? '' : 's'}` : ''}. It only ever grows.`
              : 'Your meadow grows with every minute you spend outside. Your first mission plants the first flower.'}
          </p>
        </div>
      </div>

      {next?.progress && nextText && (
        <div className="space-y-2 rounded-2xl border bg-card p-4">
          <p className="text-sm">
            <span className="font-medium">Next up: {next.title}</span> <span className="text-muted-foreground">· {nextText}</span>
          </p>
          <div
            role="progressbar"
            aria-label={next.title}
            aria-valuemin={0}
            aria-valuemax={next.progress.target}
            aria-valuenow={next.progress.current}
            className="h-2 overflow-hidden rounded-full bg-muted"
          >
            <div className="h-full rounded-full bg-primary transition-[width] duration-700" style={{ width: `${Math.round((next.progress.current / next.progress.target) * 100)}%` }} />
          </div>
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-display text-xl font-medium">This week</h2>
          <p className="text-sm text-muted-foreground">{week.minutes > 0 ? `${formatMinutes(week.minutes)} outside` : 'A fresh week. Nothing to catch up on.'}</p>
        </div>
        <div className="grid grid-cols-7 gap-2 rounded-2xl border bg-card p-4" role="img" aria-label={`Minutes outside each day this week: ${week.days.map((d) => `${weekdayShort(d.date)} ${d.minutes}`).join(', ')}`}>
          {week.days.map((d, i) => (
            <div key={d.date} className="flex flex-col items-center gap-1.5">
              <div className="flex h-20 w-full items-end justify-center">
                <div
                  className={cn('w-full max-w-6 rounded-t-md transition-all', d.minutes > 0 ? 'bg-primary' : 'bg-muted', i === 6 && d.minutes === 0 && 'bg-primary/20')}
                  style={{ height: `${d.minutes > 0 ? Math.max(8, Math.round((d.minutes / maxDay) * 100)) : 6}%` }}
                />
              </div>
              <span className={cn('text-[11px]', i === 6 ? 'font-medium text-foreground' : 'text-muted-foreground')}>{weekdayShort(d.date)}</span>
              <span className="text-[10px] text-muted-foreground">{d.minutes > 0 ? d.minutes : '·'}</span>
            </div>
          ))}
        </div>
        {moreThanLastWeek > 0 && <p className="text-sm text-muted-foreground">That is {formatMinutes(moreThanLastWeek)} more than last week.</p>}
      </div>

      {kinds.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label="Time by kind of activity">
          {kinds.map((k) => (
            <span key={k} className="rounded-full border bg-secondary/60 px-3 py-1 text-sm text-secondary-foreground">
              {KIND_LABEL[k]} <span className="text-muted-foreground">{formatMinutes(minutes_by_family[k])}</span>
            </span>
          ))}
        </div>
      )}

      <div className="space-y-3">
        <h2 className="font-display text-xl font-medium">Milestones</h2>
        <p className="-mt-1 text-sm text-muted-foreground">Earned once, kept for good.</p>
        <ul className="grid gap-3 sm:grid-cols-2">
          {earned.map((m) => (
            <li key={m.id} className="flex items-start gap-3 rounded-2xl border border-primary/40 bg-primary/10 p-4">
              <Sparkles className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
              <div>
                <p className="font-medium">{m.title}</p>
                <p className="text-sm text-muted-foreground">{m.description}</p>
                {m.earned_at && <p className="mt-1 text-xs text-primary">Earned {earnedOn(m.earned_at)}</p>}
              </div>
            </li>
          ))}
          {waiting.map((m) => (
            <li key={m.id} className="flex items-start gap-3 rounded-2xl border border-dashed bg-card/50 p-4">
              <Circle className="mt-0.5 size-5 shrink-0 text-muted-foreground/50" aria-hidden="true" />
              <div>
                <p className="font-medium text-muted-foreground">{m.title}</p>
                <p className="text-sm text-muted-foreground">{m.description}</p>
                {remainingText(m) && <p className="mt-1 text-xs text-muted-foreground">{remainingText(m)}</p>}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
