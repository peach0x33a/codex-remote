import type { Item, Turn } from '../../shared/protocol'

const nonnegativeFinite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0

/** Native/history turn timestamps use seconds, but the persisted duration uses milliseconds. */
export function turnDurationSeconds(turn: Pick<Turn, 'startedAt' | 'completedAt' | 'durationMs'>): number | undefined {
  if (nonnegativeFinite(turn.durationMs)) return turn.durationMs / 1000
  if (!nonnegativeFinite(turn.startedAt) || !nonnegativeFinite(turn.completedAt)) return undefined
  const seconds = turn.completedAt - turn.startedAt
  return nonnegativeFinite(seconds) ? seconds : undefined
}

/** The caller must also establish that this is the completed turn's final message. */
export function isWorkDurationCandidate(item: Item): boolean {
  return item.type === 'agentMessage'
    && (item.phase == null || item.phase === 'final_answer')
    && (item.status == null || item.status === 'completed')
    && item.error == null
    && !!item.text?.trim()
}

/** Maps only final assistant message IDs to known durations; never reads the live clock. */
export function completedTurnDurations(turns: readonly Turn[]): Map<string, number> {
  const durations = new Map<string, number>()
  for (const turn of turns) {
    if (turn.status !== 'completed' || turn.error != null) continue
    const seconds = turnDurationSeconds(turn)
    if (seconds === undefined) continue
    // Never fall back to an earlier answer when the last assistant output is ineligible.
    // Legacy history may omit the phase entirely.
    const final = turn.items.findLast(item => item.type === 'agentMessage')
    if (final && isWorkDurationCandidate(final)) durations.set(final.id, seconds)
  }
  return durations
}

export function formatWorkDuration(seconds: number | undefined): string | undefined {
  if (!nonnegativeFinite(seconds)) return undefined
  let remaining = Math.floor(seconds)
  const parts: string[] = []
  for (const [size, unit] of [[86400, '天'], [3600, '小时'], [60, '分'], [1, '秒']] as const) {
    const amount = Math.floor(remaining / size)
    if (amount) parts.push(`${amount} ${unit}`)
    remaining %= size
  }
  return `工作了 ${parts.length ? parts.join(' ') : '0 秒'}`
}

export type StoppedTurnFooter = { key: string; turnId: string; stoppedLabel: string }

/** Append a stopped-turn footer at its boundary, even with no assistant answer. */
export function withStoppedTurnFooters<Row extends { key: string }>(turns: readonly Turn[], render: (turn: Turn) => Row[]): (Row | StoppedTurnFooter)[] {
  const result: (Row | StoppedTurnFooter)[] = []
  for (const turn of turns) {
    result.push(...render(turn))
    if (turn.status !== 'interrupted') continue
    const duration = formatWorkDuration(turnDurationSeconds(turn))
    result.push({ key: 'stopped-turn:' + turn.id, turnId: turn.id, stoppedLabel: duration ? '已停止 · ' + duration : '已停止' })
  }
  return result
}
