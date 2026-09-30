import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'
import type { Turn } from '../../shared/protocol'
import { buildAgentRows, recentAgentMessages, type AgentThread, type AgentUsage } from '../lib/agent-center'
import { fetchRecentThreads, recentWindow, withinRecentWindow, type RecentWindow } from '../lib/recent-window'

export type AgentCenterRequest = <T>(method: string, params?: Record<string, unknown>, options?: { signal?: AbortSignal; timeoutMs?: number }) => Promise<T>
export type AgentCenterOptions = { request: AgentCenterRequest; isConnected: () => boolean; isVisible: () => boolean; deviceKey: () => string }
export type AgentCenterDetails = { thread: AgentThread; messages: { user?: string; agent?: string }; usage?: AgentUsage; notice: string }
type ReadMethod = 'thread/read' | 'thread/turns/list' | 'account/usage/read'
const MAX_RECENT_PAGES = 20
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
  let window: RecentWindow | null = null
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
    threads.value = []; window = null; loading.value = false; error.value = ''; notice.value = ''; updatedAt.value = null
  }

  async function refreshDetails() {
    const id = selectedId.value, fallback = threads.value.find(thread => thread.id === id)
    if (!enabled() || !id || !fallback || !withinRecentWindow(fallback, window)) return
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
      const thread = isThread(candidate) && candidate.id === id && withinRecentWindow(candidate, window) ? candidate : fallback
      if (metadata.status === 'rejected') detailError.value = '详情读取失败：' + messageOf(metadata.reason)
      else if (!isThread(candidate)) detailError.value = '服务器返回的会话详情格式无效，请重试。'
      else if (candidate.id !== id) detailError.value = '服务器返回的会话与所选任务不一致，请重试。'
      else if (!withinRecentWindow(candidate, window)) detailError.value = '所选任务不在当前日期范围内，请刷新列表。'
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

  async function refresh() {
    if (!enabled()) return
    listAbort?.abort()
    const controller = new AbortController(), version = ++listSequence, scope = epoch, device = options.deviceKey()
    listAbort = controller; loading.value = true; error.value = ''
    const current = () => enabled() && !controller.signal.aborted && epoch === scope && listSequence === version && options.deviceKey() === device
    try {
      // Rust source_kind_matches treats subAgent as all sub-agent variants.
      const sourceParams = [{ modelProviders: [], sourceKinds: [] }, { modelProviders: [], sourceKinds: ['exec', 'appServer', 'subAgent'] }]
      // Probe both sources before choosing one shared activity anchor. Loaded IDs
      // carry no activity timestamp, so they must not trigger metadata fan-out.
      const firstPages = await Promise.allSettled(sourceParams.map(params => fetchRecentThreads<AgentThread>(options.request, {
        params, signal: controller.signal, maxPages: 1,
      }).then(page => {
        if (!page.data.every(isThread)) throw new Error('任务列表格式无效')
        return page
      })))
      if (!current()) return
      if (firstPages.every(page => page.status === 'rejected')) throw new Error('无法读取任务列表，请检查连接后刷新。')
      const anchors = firstPages.flatMap(page => page.status === 'fulfilled' && page.value.window ? [page.value.window.latest] : [])
      window = anchors.length ? recentWindow(Math.max(...anchors)) : null
      const snapshot = new Map<string, AgentThread>()
      let selectionRefreshed = false
      const publish = (complete = false) => {
        if (!current()) return
        const visible = new Map(snapshot), selected = rows.value.find(row => row.thread.id === selectedId.value)
        // Keep the current selection available while later pages or metadata arrive.
        if (!complete && selected && withinRecentWindow(selected.thread, window) && !visible.has(selected.thread.id)) {
          for (const member of selected.members) if (!visible.has(member.id) && withinRecentWindow(member, window)) visible.set(member.id, member)
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
        for (const thread of data) if (!thread.ephemeral && withinRecentWindow(thread, window)) snapshot.set(thread.id, thread)
        if (snapshot.size) publish()
      }
      mergeRecent(firstPages.flatMap(page => page.status === 'fulfilled' ? page.value.data : []))
      publish()
      const remaining = await Promise.allSettled(firstPages.map((page, index) => {
        if (page.status === 'rejected' || !page.value.nextCursor || !window || !page.value.window
          || page.value.window.latest < window.start || page.value.data.some(thread => !withinRecentWindow(thread, window))) return null
        return fetchRecentThreads<AgentThread>(options.request, {
          params: sourceParams[index], signal: controller.signal, window, cursor: page.value.nextCursor,
          sortKey: page.value.sortKey, maxPages: MAX_RECENT_PAGES - 1, onPage: page => mergeRecent(page.data),
        })
      }))
      if (!current()) return
      const partial = [...firstPages, ...remaining].some(page => page.status === 'rejected')
      const limited = remaining.some(page => page.status === 'fulfilled' && page.value?.limited)
      notice.value = [partial ? '部分任务读取失败，可手动刷新重试。' : '', limited ? '已达到本次读取上限，仅展示已读取的任务。' : ''].filter(Boolean).join(' ')
      publish(true)
    } catch (reason) { if (current()) error.value = messageOf(reason) }
    finally { if (current()) { loading.value = false; listAbort = undefined } }
  }

  function select(id: string) {
    if (id && !threads.value.some(thread => thread.id === id)) return
    selectedId.value = id
  }
  watch(selectedId, () => { cancelDetails(); void refreshDetails() }, { flush: 'sync' })
  watch([options.isVisible, options.isConnected, options.deviceKey, () => pageVisible.value], () => {
    clear()
    if (!enabled()) return
    void refresh()
    timer = setInterval(() => { if (enabled() && !loading.value) void refresh() }, AGENT_CENTER_REFRESH_MS)
  }, { immediate: true, flush: 'sync' })
  const visibilityChanged = () => { pageVisible.value = document.visibilityState !== 'hidden' }
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', visibilityChanged)
  onScopeDispose(() => {
    disposed = true; clear()
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', visibilityChanged)
  })
  return { rows, selectedId, details, loading, detailLoading, error, detailError, notice, updatedAt, refresh, refreshDetails, select, clear }
}
