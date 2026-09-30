<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { PhArchive, PhArrowUpRight, PhArrowsClockwise, PhMagnifyingGlass } from '@phosphor-icons/vue'
import BaseDialog from './BaseDialog.vue'
import type { Thread } from '../../shared/protocol'

type Page = { data: Thread[]; nextCursor: string | null }
const props = defineProps<{
  open: boolean
  connected: boolean
  deviceKey: string
  request: (params: { cursor?: string | null; searchTerm?: string }, options?: { signal?: AbortSignal; timeoutMs?: number }) => Promise<Page>
  restore: (id: string) => Promise<boolean>
}>()
const emit = defineEmits<{ close: []; select: [id: string] }>()
const query = ref(''), rows = ref<Thread[]>([]), cursor = ref<string | null>(null)
const loading = ref(false), error = ref(''), restoring = ref('')
const seenCursors = new Set<string>(), restored = new Set<string>()
let controller: AbortController | undefined, version = 0, scope = 0
let searchTimer: ReturnType<typeof setTimeout> | undefined
const title = (thread: Thread) => thread.name || thread.preview || '未命名对话'
const date = (seconds: number) => Number.isFinite(seconds) ? new Date(seconds * 1000).toLocaleDateString('zh-CN') : ''

function cancelRead() { version++; controller?.abort(); controller = undefined; loading.value = false; clearTimeout(searchTimer) }
async function read(append = false) {
  if (!props.open || !props.connected || restoring.value || (append && (loading.value || !cursor.value))) return
  cancelRead()
  const current = version, requestedCursor = append ? cursor.value : null
  const abort = new AbortController(); controller = abort; loading.value = true; error.value = ''
  try {
    const page = await props.request({ cursor: requestedCursor, searchTerm: query.value.trim() || undefined }, { signal: abort.signal, timeoutMs: 15_000 })
    if (current !== version || abort.signal.aborted) return
    rows.value = [...new Map([...(append ? rows.value : []), ...page.data].filter(thread => !restored.has(thread.id)).map(thread => [thread.id, thread])).values()]
    if (!append) seenCursors.clear()
    if (requestedCursor) seenCursors.add(requestedCursor)
    if (page.nextCursor && seenCursors.has(page.nextCursor)) { cursor.value = null; error.value = '归档分页返回了重复位置，请刷新后重试。' }
    else cursor.value = page.nextCursor
  } catch (cause) {
    if (current === version && !abort.signal.aborted) error.value = cause instanceof Error ? cause.message : '读取归档失败，请重试。'
  } finally {
    if (current === version) { loading.value = false; controller = undefined }
  }
}
async function restore(thread: Thread) {
  if (!props.connected || restoring.value) return
  cancelRead(); const currentScope = scope, device = props.deviceKey
  restoring.value = thread.id; error.value = ''
  try {
    const success = await props.restore(thread.id)
    if (currentScope !== scope || device !== props.deviceKey || !props.open) return
    if (!success) { error.value = '未能恢复会话，请重试。'; return }
    restored.add(thread.id); rows.value = rows.value.filter(row => row.id !== thread.id)
    emit('select', thread.id)
  } catch (cause) {
    if (currentScope === scope) error.value = cause instanceof Error ? cause.message : '恢复会话失败，请重试。'
  } finally { if (currentScope === scope) restoring.value = '' }
}
watch(query, () => {
  cancelRead(); rows.value = []; cursor.value = null; error.value = ''
  if (props.open && props.connected) searchTimer = setTimeout(() => { void read() }, 250)
})
watch(() => [props.open, props.connected, props.deviceKey], () => {
  scope++; cancelRead(); rows.value = []; cursor.value = null; error.value = ''; restoring.value = ''; restored.clear(); seenCursors.clear()
  if (props.open && props.connected) void read()
}, { immediate: true })
onBeforeUnmount(() => { scope++; cancelRead() })
</script>

<template>
  <BaseDialog class="archive-dialog" :open="open" title="归档会话" description="当前设备的归档会话" wide @close="emit('close')">
    <div class="archive-toolbar">
      <label class="archive-search"><PhMagnifyingGlass :size="17" aria-hidden="true" /><input v-model="query" type="search" aria-label="搜索归档会话" placeholder="搜索归档会话" :disabled="!connected || !!restoring" /></label>
      <button type="button" class="icon-button" aria-label="刷新归档会话" title="刷新" :disabled="!connected || loading || !!restoring" @click="read()"><PhArrowsClockwise :size="18" :class="{ spinning: loading }" /></button>
    </div>
    <p v-if="error" class="archive-error" role="alert">{{ error }}</p>
    <div v-if="!connected" class="archive-empty">连接设备后查看归档会话</div>
    <div v-else-if="loading && !rows.length" class="archive-empty" role="status"><span class="spinner" />正在读取归档…</div>
    <div v-else-if="!rows.length && !error" class="archive-empty"><PhArchive :size="26" /><span>{{ query ? '没有匹配的归档会话' : '暂无归档会话' }}</span></div>
    <ul v-else class="archive-list" aria-label="归档会话列表" :aria-busy="loading">
      <li v-for="thread in rows" :key="thread.id" class="archive-row">
        <div class="archive-row-info"><h3 :title="title(thread)">{{ title(thread) }}</h3><p><span v-if="thread.cwd" class="archive-path" :title="thread.cwd">{{ thread.cwd }}</span><time v-if="date(thread.updatedAt)">{{ date(thread.updatedAt) }}</time></p></div>
        <button type="button" class="archive-restore" :disabled="!connected || !!restoring" :aria-label="`恢复并打开 ${title(thread)}`" @click="restore(thread)"><span v-if="restoring === thread.id" class="spinner" /><PhArrowUpRight v-else :size="15" aria-hidden="true" />{{ restoring === thread.id ? '正在恢复' : '恢复并打开' }}</button>
      </li>
    </ul>
    <footer v-if="connected && rows.length" class="archive-footer"><span>已显示 {{ rows.length }} 个会话</span><button v-if="cursor" type="button" class="text-button" :disabled="loading || !!restoring" @click="read(true)">{{ loading ? '正在加载…' : '加载更多' }}</button></footer>
  </BaseDialog>
</template>

<style scoped>
.archive-dialog { width: min(760px, calc(100vw - 32px)); max-width: calc(100vw - 32px); }
.archive-toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
.archive-search { display: flex; flex: 1; align-items: center; gap: 8px; min-width: 0; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--sidebar); padding: 0 12px; color: var(--muted); }
.archive-search:focus-within { border-color: var(--accent); }
.archive-search input { width: 100%; min-width: 0; height: 36px; border: 0; color: var(--ink); background: transparent; font-size: 14px; }
.archive-search input::placeholder { color: var(--muted); }
.archive-empty { min-height: 160px; display: flex; align-items: center; justify-content: center; gap: 10px; color: var(--muted); font-size: 14px; }
.archive-list { list-style: none; padding: 0; margin: 0; max-height: min(52dvh, 520px); overflow-y: auto; scrollbar-gutter: stable; }
.archive-row { display: flex; align-items: center; gap: 16px; padding: 12px 8px; border-bottom: 1px solid var(--line-soft); }
.archive-row-info { min-width: 0; flex: 1; }
.archive-row h3 { font-size: 14px; font-weight: 500; line-height: 20px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.archive-row p { display: flex; gap: 12px; align-items: center; margin: 5px 0 0; color: var(--muted); font-size: 12px; line-height: 18px; }
.archive-path { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.archive-row time { flex-shrink: 0; font-variant-numeric: tabular-nums; }
.archive-restore { display: inline-flex; align-items: center; justify-content: center; gap: 5px; flex-shrink: 0; min-height: 32px; padding: 5px 8px; border-radius: var(--radius-sm); color: var(--ink-soft); font-size: 12px; white-space: nowrap; }
.archive-restore:hover:not(:disabled) { background: var(--hover); }
.archive-restore:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.archive-error { color: var(--danger); font-size: 13px; line-height: 1.7; margin: 0 0 12px; overflow-wrap: anywhere; }
.archive-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 12px; color: var(--muted); font-size: 12px; }
@media (max-width: 600px) {
  .archive-dialog { width: calc(100vw - 24px); max-width: calc(100vw - 24px); }
  .archive-row { gap: 8px; padding-inline: 0; }
  .archive-row p { display: block; }
  .archive-path { display: block; }
  .archive-search input { font-size: 16px; }
}
@media (hover: none), (pointer: coarse) { .archive-search input, .archive-restore { min-height: 44px; } }
</style>
