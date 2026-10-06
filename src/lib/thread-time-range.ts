import { recentWindow, type RecentWindow } from './recent-window'

export type ThreadTimeRange = { kind: 'recent'; days: 2 | 7 | 30 } | { kind: 'all' } | { kind: 'custom'; start: string; end: string }
export type ThreadTimeRangeChoice = '2' | '7' | '30' | 'all' | 'custom'
export const THREAD_TIME_RANGES: { value: ThreadTimeRangeChoice; label: string }[] = [
  { value: '2', label: '最近 2 天' }, { value: '7', label: '最近 7 天' }, { value: '30', label: '最近 30 天' },
  { value: 'all', label: '全部时间' }, { value: 'custom', label: '自定义日期' },
]

function calendarDate(value: unknown): Date | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return
  const date = new Date(value + 'T00:00:00')
  if (!Number.isFinite(date.getTime()) || date.getFullYear() < 1970 || localDate(date) !== value) return
  return date
}
export function localDate(date: Date): string {
  return [String(date.getFullYear()).padStart(4, '0'), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')
}
export function customRangeError(start: string, end: string): string {
  if (!calendarDate(start) || !calendarDate(end)) return '请选择有效的开始和结束日期。'
  return start > end ? '结束日期不能早于开始日期。' : ''
}
export function isThreadTimeRange(value: unknown): value is ThreadTimeRange {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const range = value as Record<string, unknown>
  return range.kind === 'all' || range.kind === 'recent' && [2, 7, 30].includes(range.days as number)
    || range.kind === 'custom' && typeof range.start === 'string' && typeof range.end === 'string' && !customRangeError(range.start, range.end)
}
export function timeRangeChoice(range: ThreadTimeRange): ThreadTimeRangeChoice {
  return range.kind === 'recent' ? String(range.days) as ThreadTimeRangeChoice : range.kind
}
export function threadTimeWindow(range: ThreadTimeRange, latest?: number): RecentWindow | null {
  if (range.kind === 'all') return null
  if (range.kind === 'recent') return latest === undefined ? null : recentWindow(latest, range.days)
  if (customRangeError(range.start, range.end)) throw new Error(customRangeError(range.start, range.end))
  const start = calendarDate(range.start)!, end = calendarDate(range.end)!
  end.setDate(end.getDate() + 1)
  return { start: start.getTime() / 1000, end: end.getTime() / 1000, latest: end.getTime() / 1000 - 1 }
}
export function timeRangeCaption(range: ThreadTimeRange, window: RecentWindow | null): string {
  if (range.kind === 'all') return '全部时间 · 按对话活动时间筛选'
  if (range.kind === 'custom') return range.start + ' 至 ' + range.end + ' · 按对话活动时间筛选'
  if (!window) return '以最新活动日为准 · 按对话活动时间筛选'
  const first = localDate(new Date(window.start * 1000)), last = localDate(new Date(window.end * 1000 - 1))
  return first + ' 至 ' + last + (range.kind === 'recent' ? ' · 以最新活动日为准' : ' · 按对话活动时间筛选')
}
