import { describe, expect, test } from 'bun:test'
import { activityTime, fetchRecentThreads, recentWindow, withinRecentWindow, type RecentThreadRequest } from '../../src/lib/recent-window'
const at = (day: number, hour = 0) => new Date(2026, 8, day, hour).getTime() / 1000
const row = (id: string, time: number) => ({ id, updatedAt: time })
function reader(handle: (params: Record<string, unknown>) => unknown) {
  const calls: Record<string, unknown>[] = []
  const request: RecentThreadRequest = async <T>(_method: string, params = {}) => { calls.push(params); return handle(params) as T }
  return { request, calls }
}
describe('recent session window', () => {
  test('anchors to latest activity, including all of the previous calendar date', () => {
    const window = recentWindow(at(29, 18))
    expect(window.start).toBe(at(28)); expect(window.end).toBe(at(30))
    expect(withinRecentWindow(row('previous-midnight', at(28)), window)).toBe(true)
    expect(withinRecentWindow(row('older', at(28) - 1), window)).toBe(false)
    expect(withinRecentWindow(row('future', at(30)), window)).toBe(false)
    expect(withinRecentWindow(row('invalid', NaN), window)).toBe(false)
  })
  test('uses calendar boundaries across month and year changes', () => {
    const latest = new Date(2025, 0, 1, 9).getTime() / 1000
    const window = recentWindow(latest)
    expect(window.start).toBe(new Date(2024, 11, 31).getTime() / 1000)
    expect(window.end).toBe(new Date(2025, 0, 2).getTime() / 1000)
  })
  test('prefers server recency and falls back to valid timestamps', () => {
    expect(activityTime({ id: 'a', recencyAt: at(29), updatedAt: at(27) })).toBe(at(29))
    expect(activityTime({ id: 'a', recencyAt: null, updatedAt: at(28) })).toBe(at(28))
    expect(activityTime({ id: 'a', recencyAt: Infinity, updatedAt: NaN, createdAt: at(28) })).toBe(at(28))
    expect(activityTime({ id: 'a', updatedAt: -1 })).toBeUndefined()
  })
  test('stops fetching as soon as an ordered page crosses the window', async () => {
    const rpc = reader(params => params.cursor ? { data: [row('b', at(28)), row('old', at(27))], nextCursor: 'never-fetch' } : { data: [row('a', at(29, 17))], nextCursor: 'page2' })
    const result = await fetchRecentThreads(rpc.request)
    expect(result.data.map(thread => thread.id)).toEqual(['a', 'b'])
    expect(result.nextCursor).toBeNull(); expect(result.limited).toBe(false)
    expect(rpc.calls).toHaveLength(2)
    expect(rpc.calls[0]).toMatchObject({ limit: 100, sortKey: 'recency_at', sortDirection: 'desc', useStateDbOnly: true })
  })
  test('shares a global anchor instead of re-anchoring an old project or source', async () => {
    const rpc = reader(() => ({ data: [row('old', at(27))], nextCursor: 'old-page2' }))
    const result = await fetchRecentThreads(rpc.request, { window: recentWindow(at(29)), params: { sourceKinds: ['exec'] } })
    expect(result.data).toEqual([]); expect(rpc.calls).toHaveLength(1)
    expect(result.window?.latest).toBe(at(29))
  })
  test('falls back only when the server explicitly rejects the recency sort key', async () => {
    const rpc = reader(params => { if (params.sortKey === 'recency_at') throw Object.assign(new Error('unknown variant recency_at, expected updated_at'), { code: -32602 }); return { data: [row('a', at(29))], nextCursor: null } })
    expect((await fetchRecentThreads(rpc.request)).sortKey).toBe('updated_at')
    expect(rpc.calls).toHaveLength(2)
    const failing = reader(() => { throw Object.assign(new Error('Timed out'), { code: -32603 }) })
    await expect(fetchRecentThreads(failing.request)).rejects.toThrow('Timed out')
    expect(failing.calls).toHaveLength(1)
  })
  test('bounds dense recent pages and preserves an explicit continuation', async () => {
    const rpc = reader(params => ({ data: [row(String(params.cursor || 'first'), at(29))], nextCursor: 'next-' + String(params.cursor || 'first') }))
    const result = await fetchRecentThreads(rpc.request, { maxPages: 2 })
    expect(result.limited).toBe(true); expect(result.nextCursor).toBe('next-next-first')
    expect(rpc.calls).toHaveLength(2)
  })
  test('all-time reads retain older and undated conversations instead of applying the recent window', async () => {
    const rpc = reader(params => params.cursor ? { data: [row('old', at(1)), { id: 'undated' }], nextCursor: null }
      : { data: [row('latest', at(29))], nextCursor: 'older' })
    const result = await fetchRecentThreads(rpc.request, { allTime: true })
    expect(result.data.map(thread => thread.id)).toEqual(['latest', 'old', 'undated'])
    expect(result.window).toBeNull(); expect(rpc.calls).toHaveLength(2)
  })
  test('rejects repeated cursors and malformed data, and honors cancellation', async () => {
    const repeated = reader(() => ({ data: [row('a', at(29))], nextCursor: 'same' }))
    await expect(fetchRecentThreads(repeated.request)).rejects.toThrow('重复')
    expect(repeated.calls).toHaveLength(2)
    await expect(fetchRecentThreads(reader(() => ({ data: [null] })).request)).rejects.toThrow('格式')
    const controller = new AbortController(); controller.abort()
    const cancelled = reader(() => ({}))
    await expect(fetchRecentThreads(cancelled.request, { signal: controller.signal })).rejects.toThrow('已取消')
    expect(cancelled.calls).toHaveLength(0)
  })
})
