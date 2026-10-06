import { describe, expect, test } from 'bun:test'
import { customRangeError, isThreadTimeRange, localDate, threadTimeWindow, timeRangeCaption } from '../../src/lib/thread-time-range'
import { withinRecentWindow } from '../../src/lib/recent-window'

describe('conversation date range', () => {
  test('recent presets span calendar days from the latest activity, including month boundaries', () => {
    const latest = new Date(2026, 0, 2, 18).getTime() / 1000
    const window = threadTimeWindow({ kind: 'recent', days: 7 }, latest)!
    expect(localDate(new Date(window.start * 1000))).toBe('2025-12-27')
    expect(localDate(new Date(window.end * 1000 - 1))).toBe('2026-01-02')
    expect(timeRangeCaption({ kind: 'recent', days: 7 }, window)).toContain('以最新活动日为准')
    expect(threadTimeWindow({ kind: 'recent', days: 2 })).toBeNull()
    expect(threadTimeWindow({ kind: 'all' }, latest)).toBeNull()
  })
  test('custom ranges include the complete end date and reject invalid or reversed calendar dates', () => {
    const window = threadTimeWindow({ kind: 'custom', start: '2024-02-29', end: '2024-02-29' })!
    expect(withinRecentWindow({ id: 'end', updatedAt: new Date(2024, 1, 29, 23, 59, 59).getTime() / 1000 }, window)).toBe(true)
    expect(withinRecentWindow({ id: 'next', updatedAt: new Date(2024, 2, 1).getTime() / 1000 }, window)).toBe(false)
    expect(customRangeError('2026-02-29', '2026-03-01')).toContain('有效')
    expect(customRangeError('2026-09-30', '2026-09-29')).toContain('不能早于')
    for (const value of [null, { kind: 'recent', days: 0 }, { kind: 'recent', days: '7' }, { kind: 'custom', start: '', end: '' }, { kind: 'custom', start: '2026-13-01', end: '2026-13-02' }]) expect(isThreadTimeRange(value)).toBe(false)
    expect(isThreadTimeRange({ kind: 'custom', start: '2026-09-29', end: '2026-09-29' })).toBe(true)
    expect(timeRangeCaption({ kind: 'custom', start: '2026-09-29', end: '2026-09-29' }, null)).toBe('2026-09-29 至 2026-09-29 · 按对话活动时间筛选')
  })
  test('uses local midnight across a daylight-saving transition', () => {
    const child = Bun.spawnSync([process.execPath, '--eval',
      'import { threadTimeWindow } from "./src/lib/thread-time-range.ts"; console.log(JSON.stringify(threadTimeWindow({kind:"custom",start:"2026-03-08",end:"2026-03-08"})))'],
    { env: { ...process.env, TZ: 'America/New_York' }, stdout: 'pipe', stderr: 'pipe' })
    expect(child.exitCode).toBe(0)
    const window = JSON.parse(child.stdout.toString())
    expect(window.end - window.start).toBe(23 * 60 * 60)
  })
})
