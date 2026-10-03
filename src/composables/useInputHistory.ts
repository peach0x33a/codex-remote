import { computed, onMounted, onScopeDispose, ref, watch, type Ref } from 'vue'
import { INPUT_HISTORY_LIMIT, parseHistoryEntries, type InputHistoryEntry } from '../../shared/input-history'
import { messageParts, toInputs, type PromptPart } from '../lib/prompt'
import { randomId } from '../lib/random-id'

async function requestHistory(deviceId: string, entry?: InputHistoryEntry): Promise<InputHistoryEntry[]> {
  const body = entry && JSON.stringify({ deviceId, id: entry.id, input: entry.input })
  const response = await fetch('/api/input-history' + (entry ? '' : '?deviceId=' + encodeURIComponent(deviceId)), {
    method: entry ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'X-Codex-Remote': '1' },
    ...(body ? { body, keepalive: new TextEncoder().encode(body).length < 60 * 1024 } : {}), signal: AbortSignal.timeout(10_000),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : '输入历史未同步，请检查 Bun 服务。')
  const entries = parseHistoryEntries(data?.entries)
  if (entries.some(entry => entry.deviceId !== deviceId)) throw new Error('输入历史的设备标识不匹配。')
  return entries
}

/** Device-wide server history is independent of the loaded conversation page. */
export function useInputHistory(deviceId: Ref<string>, authenticated: Ref<boolean>, fallback: Ref<PromptPart[][]>, toast: (message: string) => void) {
  const saved = ref(new Map<string, InputHistoryEntry[]>())
  const writes = new Map<string, Promise<void>>(), revisions = new Map<string, number>(), reads = new Map<string, Promise<void>>()
  let disposed = false
  const entries = computed(() => {
    const server = (saved.value.get(deviceId.value) ?? []).map(entry => messageParts(entry.input))
    const known = new Set(server.map(parts => JSON.stringify(toInputs(parts))))
    return [...fallback.value.filter(parts => !known.has(JSON.stringify(toInputs(parts)))), ...server].slice(-INPUT_HISTORY_LIMIT)
  })
  function refresh() {
    const id = deviceId.value
    if (!id || !authenticated.value || disposed) return Promise.resolve()
    if (reads.has(id)) return reads.get(id)!
    const version = revisions.get(id) ?? 0
    const read = requestHistory(id).then(entries => {
      if (!disposed && authenticated.value && version === (revisions.get(id) ?? 0)) saved.value.set(id, entries)
    }).catch(() => { /* Loaded conversation inputs remain available on read failure. */ }).finally(() => { if (reads.get(id) === read) reads.delete(id) })
    reads.set(id, read); return read
  }
  function remember(parts: PromptPart[], id = deviceId.value) {
    if (!id || !authenticated.value || disposed) return Promise.resolve()
    const entry: InputHistoryEntry = { id: randomId(), deviceId: id, createdAt: Date.now(), input: toInputs(parts) }
    saved.value.set(id, [...(saved.value.get(id) ?? []), entry].slice(-INPUT_HISTORY_LIMIT))
    revisions.set(id, (revisions.get(id) ?? 0) + 1)
    const write = (writes.get(id) ?? Promise.resolve()).then(async () => {
      const entries = await requestHistory(id, entry)
      if (disposed || !authenticated.value) return
      // A later submission can already be visible while its write waits in this queue.
      const local = saved.value.get(id) ?? [], index = local.findIndex(row => row.id === entry.id)
      saved.value.set(id, [...entries, ...(index < 0 ? [] : local.slice(index + 1).filter(row => !entries.some(saved => saved.id === row.id)))].slice(-INPUT_HISTORY_LIMIT))
    }).catch(cause => { if (!disposed && authenticated.value) toast('消息已提交，但输入历史未保存：' + (cause instanceof Error ? cause.message : '请检查 Bun 服务。')) })
      .finally(() => { if (writes.get(id) === write) writes.delete(id) })
    writes.set(id, write); return write
  }
  watch([deviceId, authenticated], () => { if (!authenticated.value) { saved.value.clear(); revisions.clear() }; void refresh() }, { immediate: true })
  const focused = () => { void refresh() }
  onMounted(() => window.addEventListener('focus', focused))
  onScopeDispose(() => { disposed = true; window.removeEventListener('focus', focused) })
  return { entries, remember, refresh }
}
