export type RecentActivity = { id: string; recencyAt?: number | null; updatedAt?: number; createdAt?: number }
export type RecentWindow = { latest: number; start: number; end: number }
export type RecentThreadRequest = <T>(method: string, params?: Record<string, unknown>, options?: { signal?: AbortSignal; timeoutMs?: number }) => Promise<T>
export type RecentPage<T> = { data: T[]; nextCursor?: string | null }
export type RecentSnapshot<T> = { data: T[]; window: RecentWindow | null; nextCursor: string | null; sortKey: 'recency_at' | 'updated_at'; limited: boolean }

export function activityTime(thread: RecentActivity): number | undefined {
  return [thread.recencyAt, thread.updatedAt, thread.createdAt].find((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 8.64e12)
}

/** Two calendar dates in the viewer's local timezone, anchored to actual activity. */
export function recentWindow(latest: number): RecentWindow {
  const start = new Date(latest * 1000), end = new Date(latest * 1000)
  start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - 1)
  end.setHours(0, 0, 0, 0); end.setDate(end.getDate() + 1)
  return { latest, start: start.getTime() / 1000, end: end.getTime() / 1000 }
}
export function withinRecentWindow(thread: RecentActivity, window: RecentWindow | null): boolean {
  const time = activityTime(thread)
  return window !== null && time !== undefined && time >= window.start && time < window.end
}
function unsupportedRecency(reason: unknown) {
  if (!reason || typeof reason !== 'object') return false
  const error = reason as { code?: number; message?: string }
  return error.code === -32602 && /recency_at/i.test(error.message || '') && /unknown|invalid|unsupported|expected/i.test(error.message || '')
}

/** Stop requesting older pages as soon as the ordered list crosses the date window. */
export async function fetchRecentThreads<T extends RecentActivity>(request: RecentThreadRequest, options: {
  params?: Record<string, unknown>; signal?: AbortSignal; window?: RecentWindow | null
  cursor?: string | null; sortKey?: 'recency_at' | 'updated_at'; maxPages?: number
  onPage?: (snapshot: RecentSnapshot<T>) => void
} = {}): Promise<RecentSnapshot<T>> {
  let cursor = options.cursor || null, window = options.window || null, sortKey = options.sortKey || 'recency_at'
  const all = new Map<string, T>(), seen = new Set<string>(cursor ? [cursor] : [])
  const snapshot = (): RecentSnapshot<T> => ({ data: [...all.values()].sort((a, b) => (activityTime(b) ?? 0) - (activityTime(a) ?? 0)), window, nextCursor: cursor, sortKey, limited: !!cursor })
  for (let pageIndex = 0; pageIndex < (options.maxPages ?? 20); pageIndex++) {
    if (options.signal?.aborted) throw new DOMException('已取消', 'AbortError')
    const load = () => request<RecentPage<T>>('thread/list', { ...options.params, limit: 100, cursor, sortKey, sortDirection: 'desc', archived: false, useStateDbOnly: true }, { signal: options.signal, timeoutMs: 12_000 })
    let page: RecentPage<T>
    try { page = await load() }
    catch (error) {
      if (cursor || sortKey !== 'recency_at' || !unsupportedRecency(error)) throw error
      sortKey = 'updated_at'; page = await load()
    }
    if (!page || !Array.isArray(page.data) || page.data.some(thread => !thread || typeof thread.id !== 'string')) throw new Error('会话列表格式无效')
    const times = page.data.map(activityTime).filter((time): time is number => time !== undefined)
    if (!window && times.length) window = recentWindow(Math.max(...times))
    for (const thread of page.data) if (withinRecentWindow(thread, window)) all.set(thread.id, thread)
    const crossed = window !== null && times.some(time => time < window!.start)
    const next = page.nextCursor
    if (next != null && typeof next !== 'string') throw new Error('会话列表分页格式无效')
    cursor = crossed || !page.data.length ? null : next || null
    if (cursor && seen.has(cursor)) throw new Error('会话列表返回了重复的分页标记')
    if (cursor) seen.add(cursor)
    options.onPage?.(snapshot())
    if (!cursor) break
  }
  return snapshot()
}
