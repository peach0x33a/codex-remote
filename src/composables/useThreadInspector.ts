import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import type { Thread } from '../../shared/protocol'
import { buildThreadInsights } from '../lib/thread-insights'

type Request = <T>(method: string, params: Record<string, unknown>, options?: { signal?: AbortSignal; timeoutMs?: number }) => Promise<T>
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

export function useThreadInspector(options: { thread: Ref<Thread | null>; deviceId: Ref<string>; connected: Ref<boolean>; knownThreads: Ref<Thread[]>; request: Request }) {
  const summaries = ref<Record<string, unknown>[]>([]), error = ref(''), pending = ref(new Set<string>())
  const insights = computed(() => buildThreadInsights(options.thread.value, [...options.knownThreads.value, ...summaries.value]))
  const loading = computed(() => pending.value.size > 0)
  let generation = 0
  const controllers = new Map<string, AbortController>()
  function reset() {
    generation++
    for (const controller of controllers.values()) controller.abort()
    controllers.clear(); pending.value.clear(); summaries.value = []; error.value = ''
  }
  watch([options.deviceId, () => options.thread.value?.id, options.connected], reset, { flush: 'sync' })
  async function inspect(id: string, refresh = false) {
    if (!options.connected.value || !insights.value.agents.some(agent => agent.id === id) || pending.value.has(id)) return
    if (!refresh && summaries.value.some(summary => summary.id === id)) return
    const epoch = generation, controller = new AbortController()
    controllers.set(id, controller); pending.value.add(id); error.value = ''
    try {
      const response = await options.request<unknown>('thread/read', { threadId: id, includeTurns: false }, { signal: controller.signal, timeoutMs: 8000 })
      if (generation !== epoch) return
      if (!record(response) || !record(response.thread) || response.thread.id !== id) throw new Error('子代理响应无效。')
      const summary = { ...response.thread }
      summaries.value = [...summaries.value.filter(item => item.id !== id), summary]
      // Read a bounded recent page; merely viewing an agent must never resume it.
      const page = await options.request<unknown>('thread/items/list', { threadId: id, limit: 20, sortDirection: 'desc' }, { signal: controller.signal, timeoutMs: 8000 })
      if (generation !== epoch) return
      if (!record(page) || !Array.isArray(page.data)) throw new Error('子代理消息响应无效。')
      const last = page.data.find(entry => record(entry) && record(entry.item) && entry.item.type === 'agentMessage' && typeof entry.item.text === 'string')
      if (record(last) && record(last.item)) summary.lastMessage = last.item.text
      summaries.value = [...summaries.value.filter(item => item.id !== id), summary]
    } catch (cause) {
      if (epoch === generation && !controller.signal.aborted) error.value = cause instanceof Error ? cause.message : '读取子代理失败。'
    } finally {
      if (controllers.get(id) === controller) { controllers.delete(id); pending.value.delete(id) }
    }
  }
  async function refresh() {
    const epoch = generation
    const ids = summaries.value.length ? summaries.value.map(summary => String(summary.id)) : insights.value.agents.slice(0, 6).map(agent => agent.id)
    // Keep reads bounded, including after the user expands a large agent list.
    for (let i = 0; i < ids.length && generation === epoch; i += 3) await Promise.allSettled(ids.slice(i, i + 3).map(id => inspect(id, true)))
  }
  onBeforeUnmount(reset)
  return { insights, loading, error, inspect, refresh }
}
