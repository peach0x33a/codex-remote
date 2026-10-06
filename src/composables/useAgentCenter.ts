import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'
import type { Turn } from '../../shared/protocol'
import { buildAgentRows, recentAgentMessages, type AgentThread, type AgentUsage } from '../lib/agent-center'
import { activityTime, fetchRecentThreads, withinRecentWindow, type RecentWindow } from '../lib/recent-window'
import { threadTimeWindow, type ThreadTimeRange } from '../lib/thread-time-range'

export type AgentCenterRequest = <T>(method: string, params?: Record<string, unknown>, options?: { signal?: AbortSignal; timeoutMs?: number }) => Promise<T>
export type AgentCenterOptions = { request: AgentCenterRequest; isConnected: () => boolean; isVisible: () => boolean; deviceKey: () => string; timeRange?: () => ThreadTimeRange }
export type AgentCenterDetails = { thread: AgentThread; messages: { user?: string; agent?: string }; usage?: AgentUsage; notice: string }
type ReadMethod = 'thread/read' | 'thread/turns/list' | 'account/usage/read'
const MAX_RECENT_PAGES = 20
const DEFAULT_TIME_RANGE: ThreadTimeRange = { kind: 'recent', days: 2 }
const SOURCE_PARAMS = [{ modelProviders: [], sourceKinds: [] }, { modelProviders: [], sourceKinds: ['exec', 'appServer', 'subAgent'] }]
type Continuation = { cursor: string; sortKey: 'recency_at' | 'updated_at' }
export const AGENT_CENTER_REFRESH_MS = 15_000

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const optionalString = (value: unknown) => value == null || typeof value === 'string'
function isThread(value: unknown): value is AgentThread {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id) return false
  if (!['name', 'preview', 'cwd', 'model', 'agentNickname', 'reasoningEffort', 'parentThreadId'].every(key => optionalString(value[key]))) return false
  const status = value.status, git = value.gitInfo
  return (status == null || (isRecord(status) && typeof status.type === 'string' && (status.activeFlags == null || (Array.isArray(status.activeFlags) && status.activeFlags.every(flag => typeof flag === 'string')))))
    && (git == null || (isRecord(git) && optionalString(git.branch)))
}
function isHistory(value: unknown): value is Turn[] {
  return Array.isArray(value) && value.every(turn => isRecord(turn) && Array.isArray(turn.items) && turn.items.every(item =>
    isRecord(item) && typeof item.type === 'string' && optionalString(item.text)
    && (item.content == null || (Array.isArray(item.content) && item.content.every(part => typeof part === 'string' || (isRecord(part) && optionalString(part.text))))),
  ))
}
function isUsage(value: unknown, id: string): value is AgentUsage {
  return isRecord(value) && value.threadId === id && Array.isArray(value.groups) && value.groups.every(isRecord)
}

/** Read-only snapshot controller. Getters must access reactive parent props. */
export function useAgentCenter(options: AgentCenterOptions) {
  const threads = shallowRef<AgentThread[]>([]), rows = computed(() => buildAgentRows(threads.value))
  const selectedId = ref(''), details = shallowRef<AgentCenterDetails | null>(null)
  const loading = ref(false), detailLoading = ref(false), error = ref(''), detailError = ref(''), notice = ref('')
  const updatedAt = ref<number | null>(null)
  const pageVisible = ref(typeof document === 'undefined' || document.visibilityState !== 'hidden')
  let epoch = 0, listSequence = 0, detailSequence = 0, disposed = false
  let pageBudget = MAX_RECENT_PAGES
  const dateWindow = shallowRef<RecentWindow | null>(null)
  const continuations = shallowRef<(Continuation | null)[]>([])
  const hasMore = computed(() => continuations.value.some(Boolean))
  const inRange = (thread: AgentThread) => options.timeRange?.().kind === 'all' || withinRecentWindow(thread, dateWindow.value)
  let listAbort: AbortController | undefined, detailAbort: AbortController | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  const enabled = () => !disposed && options.isVisible() && options.isConnected() && pageVisible.value
  const messageOf = (reason: unknown) => reason instanceof Error ? reason.message : String(reason)
  const read = async <T>(method: ReadMethod, params: Record<string, unknown>, signal: AbortSignal): Promise<T> => {
    if (signal.aborted) return Promise.reject<T>(new DOMException('已取消', 'AbortError'))
    return options.request<T>(method, params, { signal, timeoutMs: 12_000 })
  }

  function cancelDetails() {
    detailSequence++; detailAbort?.abort(); detailAbort = undefined
    details.value = null; detailLoading.value = false; detailError.value = ''
  }
  function clear() {
    epoch++; listSequence++; listAbort?.abort(); listAbort = undefined
    if (timer !== undefined) clearInterval(timer)
    timer = undefined; cancelDetails(); selectedId.value = ''
    threads.value = []; dateWindow.value = null; continuations.value = []; pageBudget = MAX_RECENT_PAGES; loading.value = false; error.value = ''; notice.value = ''; updatedAt.value = null
  }

  async function refreshDetails() {
    const id = selectedId.value, fallback = threads.value.find(thread => thread.id === id)
    if (!enabled() || !id || !fallback || !inRange(fallback)) return
    detailAbort?.abort()
    const controller = new AbortController(), version = ++detailSequence, scope = epoch, device = options.deviceKey()
    detailAbort = controller; detailLoading.value = true; detailError.value = ''
    const current = () => enabled() && !controller.signal.aborted && epoch === scope && detailSequence === version && selectedId.value === id && options.deviceKey() === device
    try {
      const [metadata, history, usage] = await Promise.allSettled([
        read<unknown>('thread/read', { threadId: id, includeTurns: false }, controller.signal),
        read<unknown>('thread/turns/list', { threadId: id, limit: 3, sortDirection: 'desc', itemsView: 'summary' }, controller.signal),
        read<unknown>('account/usage/read', { threadId: id }, controller.signal),
      ])
      if (!current()) return
      const candidate = metadata.status === 'fulfilled' && isRecord(metadata.value) ? metadata.value.thread : undefined
      const thread = isThread(candidate) && candidate.id === id && inRange(candidate) ? candidate : fallback
      if (metadata.status === 'rejected') detailError.value = '详情读取失败：' + messageOf(metadata.reason)
      else if (!isThread(candidate)) detailError.value = '服务器返回的会话详情格式无效，请重试。'
      else if (candidate.id !== id) detailError.value = '服务器返回的会话与所选任务不一致，请重试。'
      else if (!inRange(candidate)) detailError.value = '所选任务不在当前日期范围内，请刷新列表。'
      const turns = history.status === 'fulfilled' && isRecord(history.value) ? history.value.data : undefined
      const validHistory = isHistory(turns)
      const actualUsage = usage.status === 'fulfilled' && isRecord(usage.value) ? usage.value.threadUsage : undefined
      details.value = { thread, messages: validHistory ? recentAgentMessages(turns) : {}, usage: isUsage(actualUsage, id) ? actualUsage : undefined, notice: validHistory ? '' : '最近消息暂不可用，可重试读取详情。' }
    } catch (reason) {
      if (current()) detailError.value = '详情读取失败：' + messageOf(reason)
    } finally {
      if (current()) { detailLoading.value = false; detailAbort = undefined }
    }
  }

  async function refresh(more = false) {
    if (!enabled() || more && (!hasMore.value || loading.value)) return
    listAbort?.abort()
    const controller = new AbortController(), version = ++listSequence, scope = epoch, device = options.deviceKey()
    if (more) pageBudget += MAX_RECENT_PAGES
    listAbort = controller; loading.value = true; error.value = ''; notice.value = ''
    const range = options.timeRange?.() ?? DEFAULT_TIME_RANGE
    const current = () => enabled() && !controller.signal.aborted && epoch === scope && listSequence === version && options.deviceKey() === device
    try {
      // Read raw first pages from both sources before choosing a shared date
      // window. Older/custom ranges must not be truncated by the default window.
      const firstPages = more ? [] : await Promise.allSettled(SOURCE_PARAMS.map(params => fetchRecentThreads<AgentThread>(options.request, {
        params, signal: controller.signal, maxPages: 1, allTime: true,
      }).then(page => {
        if (!page.data.every(isThread)) throw new Error('任务列表格式无效')
        return page
      })))
      if (!current()) return
      if (!more) {
        if (firstPages.every(page => page.status === 'rejected')) throw new Error('无法读取任务列表，请检查连接后刷新。')
        const anchors = firstPages.flatMap(page => page.status === 'fulfilled' ? page.value.data.map(activityTime).filter((time): time is number => time !== undefined) : [])
        dateWindow.value = threadTimeWindow(range, anchors.length ? Math.max(...anchors) : undefined)
        continuations.value = firstPages.map(page => {
          if (page.status === 'rejected' || !page.value.nextCursor || dateWindow.value && page.value.data.some(thread => {
            const time = activityTime(thread)
            return time !== undefined && time < dateWindow.value!.start
          })) return null
          return { cursor: page.value.nextCursor, sortKey: page.value.sortKey }
        })
      }
      const snapshot = new Map<string, AgentThread>(more ? threads.value.map(thread => [thread.id, thread]) : [])
      let selectionRefreshed = false
      const publish = (complete = false) => {
        if (!current()) return
        const visible = new Map(snapshot), selected = rows.value.find(row => row.thread.id === selectedId.value)
        // Keep the current selection available while later pages or metadata arrive.
        if (!complete && selected && inRange(selected.thread) && !visible.has(selected.thread.id)) {
          for (const member of selected.members) if (!visible.has(member.id) && inRange(member)) visible.set(member.id, member)
        }
        threads.value = [...visible.values()]; updatedAt.value = Date.now()
        const id = rows.value.some(row => row.thread.id === selectedId.value) ? selectedId.value : rows.value[0]?.thread.id || ''
        if (selectedId.value !== id) selectedId.value = id
        else if (id && !selectionRefreshed) void refreshDetails()
        if (id) selectionRefreshed = true
      }
      const mergeRecent = (data: AgentThread[]) => {
        if (!current()) return
        if (!data.every(isThread)) throw new Error('任务列表格式无效')
        for (const thread of data) if (!thread.ephemeral && inRange(thread)) snapshot.set(thread.id, thread)
        if (snapshot.size) publish()
      }
      mergeRecent(firstPages.flatMap(page => page.status === 'fulfilled' ? page.value.data : []))
      publish()
      const pending = [...continuations.value]
      const remaining = await Promise.allSettled(pending.map((page, index) => {
        if (!page || range.kind !== 'all' && !dateWindow.value) return null
        return fetchRecentThreads<AgentThread>(options.request, {
          params: SOURCE_PARAMS[index], signal: controller.signal, window: dateWindow.value, cursor: page.cursor,
          allTime: range.kind === 'all', sortKey: page.sortKey, maxPages: more ? MAX_RECENT_PAGES : pageBudget - 1, onPage: page => mergeRecent(page.data),
        })
      }))
      if (!current()) return
      continuations.value = remaining.map((page, index) => page.status === 'rejected' ? pending[index] ?? null
        : page.value?.nextCursor ? { cursor: page.value.nextCursor, sortKey: page.value.sortKey } : null)
      const partial = [...firstPages, ...remaining].some(page => page.status === 'rejected')
      notice.value = [partial ? '部分任务读取失败，可手动刷新重试。' : '', hasMore.value ? '当前范围尚有会话未读取，可继续读取。' : ''].filter(Boolean).join(' ')
      publish(true)
    } catch (reason) { if (current()) error.value = messageOf(reason) }
    finally { if (current()) { loading.value = false; listAbort = undefined } }
  }

  function select(id: string) {
    if (id && !threads.value.some(thread => thread.id === id)) return
    selectedId.value = id
  }
  watch(selectedId, () => { cancelDetails(); void refreshDetails() }, { flush: 'sync' })
  watch([options.isVisible, options.isConnected, options.deviceKey, () => pageVisible.value, () => JSON.stringify(options.timeRange?.() ?? DEFAULT_TIME_RANGE)], () => {
    clear()
    if (!enabled()) return
    void refresh()
    timer = setInterval(() => { if (enabled() && !loading.value && !hasMore.value) void refresh() }, AGENT_CENTER_REFRESH_MS)
  }, { immediate: true, flush: 'sync' })
  const visibilityChanged = () => { pageVisible.value = document.visibilityState !== 'hidden' }
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', visibilityChanged)
  onScopeDispose(() => {
    disposed = true; clear()
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', visibilityChanged)
  })
  const loadMore = () => refresh(true)
  return { rows, selectedId, details, loading, detailLoading, error, detailError, notice, updatedAt, dateWindow, hasMore, refresh, loadMore, refreshDetails, select, clear }
}
