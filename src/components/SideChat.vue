<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, onUnmounted, provide, ref, watch } from 'vue'
import { PhArrowUp, PhListNumbers, PhSquare, PhX } from '@phosphor-icons/vue'
import { useCodex } from '../composables/useCodex'
import MessageItem from './MessageItem.vue'
import TurnFailure from './TurnFailure.vue'
import WorkspaceFilePanel from './WorkspaceFilePanel.vue'
import SubAgentBadge from './SubAgentBadge.vue'
import { subAgentIdentity } from '../lib/thread-insights'
import type { FileLinkTarget } from '../lib/file-links'
import { resolveImageFileId } from '../lib/tool-content'
import { markdownImageContext } from '../lib/markdown-images'
import ApprovalIsland from './ApprovalIsland.vue'
import PromptEditor from './PromptEditor.vue'
import QueuePane from './QueuePane.vue'
import { hasPrompt, type PromptPart } from '../lib/prompt'
import type { ConnectionProfile } from '../../shared/protocol'
import { conversationInputs } from '../lib/input-history'
import { useInputHistory } from '../composables/useInputHistory'
import { completedTurnDurations, withStoppedTurnFooters } from '../lib/turn-duration'
import type { TaskNotice } from '../lib/task-notifications'
const props = defineProps<{ threadId: string; profile: ConnectionProfile; token: string }>()
const emit = defineEmits<{ close: []; notice: [event: TaskNotice]; copy: [text: string]; busy: [boolean] }>()
const codex = useCodex({ autoConnect: false, persistConnection: false })
provide(markdownImageContext, computed(() => ({ cwd: codex.active.value?.cwd || props.profile.cwd, connected: codex.connected.value, run: codex.runWorkspaceCommand, resolveFileId: (id: string) => resolveImageFileId(codex.items.value, id) })))
const agentIdentity = computed(() => subAgentIdentity(codex.active.value))
const fileTarget = ref<FileLinkTarget | null>(null)
const draft = ref<PromptPart[]>([]), ready = ref(false), inheritedIds = new Set<string>(), inheritedTurnIds = new Set<string>()
const opening = ref(false), submitting = ref(false), attaching = ref(false), queueEditing = ref(false)
const openError = ref(''), draftError = ref('')
const editor = ref<InstanceType<typeof PromptEditor>>(), messages = ref<HTMLElement>()
const atBottom = ref(true)
// Capture only confirmed history, once. Reconnects must not hide side-chat replies.
function retainInheritedHistory() {
  if (disposed || ready.value || !codex.connected.value || codex.loadingThread.value || codex.threadLoadError.value || codex.active.value?.id !== props.threadId) return
  for (const turn of codex.active.value.turns) { inheritedTurnIds.add(turn.id); for (const item of turn.items) inheritedIds.add(item.id) }
  ready.value = true
}
const visibleTurns = computed(() => ready.value && codex.active.value?.id === props.threadId
  ? codex.displayTurns.value.map(turn => ({ ...turn, items: turn.items.filter(item => !inheritedIds.has(item.id)) })).filter(turn => turn.items.length || !inheritedTurnIds.has(turn.id)) : [])
const visible = computed(() => visibleTurns.value.flatMap(turn => turn.items))
const transcript = computed(() => withStoppedTurnFooters(visibleTurns.value, turn => turn.items.map(item => ({ key: item.id, item }))))
const workDurations = computed(() => completedTurnDurations(codex.displayTurns.value))
const inputHistory = computed(() => conversationInputs([{ id: props.threadId, status: 'inProgress', items: visible.value }]))
const history = useInputHistory(computed(() => props.profile.id), codex.authenticated, inputHistory, codex.toast)
const blocked = computed(() => codex.interrupting.value || !ready.value || opening.value || !codex.connected.value || codex.active.value?.id !== props.threadId || codex.loadingThread.value || !!codex.threadLoadError.value || codex.revising.value || codex.sending.value || codex.steering.value || submitting.value || attaching.value)
const hasQueue = computed(() => !!codex.currentQueue.value.length || queueEditing.value)
const serverManaged = computed(() => (codex.serverQueueSupported.value || codex.currentQueue.value.some(job => job.source === 'server')) && !codex.currentQueue.value.some(job => job.source !== 'server'))
const updateBusy = computed(() => codex.interrupting.value || hasPrompt(draft.value) || opening.value || submitting.value || attaching.value || codex.busy.value || !!codex.activeTurn.value || codex.sending.value || codex.steering.value || codex.pendingSteers.value.some(steer => !steer.ended) || hasQueue.value || codex.revising.value)
watch(updateBusy, value => emit('busy', value), { immediate: true, flush: 'sync' })
const connectionError = computed(() => openError.value || codex.threadLoadError.value || codex.error.value)
const statusMessage = computed(() => {
  if (opening.value || codex.loadingThread.value) return ready.value ? '正在恢复侧边聊天…' : '正在打开侧边聊天…'
  if (!codex.connected.value) return codex.status.value === 'reconnecting' ? '连接中断，正在重新连接…' : '侧边聊天未连接，草稿已保留。'
  if (codex.revising.value) return '正在更新会话…'
  if (codex.reconnectStatus.value) return codex.reconnectStatus.value
  if (codex.compacting.value) return '压缩上下文中'
  if (codex.activeApprovals.value.length) return '等待处理请求'
  if (codex.busy.value || submitting.value) return 'Codex 正在工作…'
  return ''
})
const off = codex.onTaskNotice(event => emit('notice', event)); onUnmounted(off)
let disposed = false
onBeforeUnmount(() => { disposed = true })
onUnmounted(() => emit('busy', false))
watch([codex.connected, codex.loadingThread, codex.threadLoadError, () => codex.active.value?.id], retainInheritedHistory, { flush: 'sync' })
onMounted(() => { void open() })
async function open() {
  if (disposed || opening.value || codex.revising.value) return
  opening.value = true; openError.value = ''
  try {
    // A credential-backed profile may intentionally have an empty token.
    if (!codex.connected.value) await codex.connectWithToken(props.profile, props.token)
    if (disposed || !codex.connected.value) return
    await codex.openThread(props.threadId)
    retainInheritedHistory()
  } catch (cause) { if (!disposed) openError.value = cause instanceof Error ? cause.message : String(cause) }
  finally { if (!disposed) opening.value = false }
}
async function send(queueOnly = false) {
  if (blocked.value || !hasPrompt(draft.value)) return
  const parts = draft.value
  submitting.value = true; draftError.value = ''
  try {
    if (await (codex.busy.value && !queueOnly ? codex.steer(parts) : codex.send(parts))) {
      void history.remember(parts)
      if (!disposed && draft.value === parts) draft.value = []
    }
  } catch (cause) { if (!disposed) draftError.value = cause instanceof Error ? cause.message : String(cause) }
  finally { if (!disposed) submitting.value = false }
}
function onKey(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return
  if (event.key === 'Tab' && codex.busy.value && hasPrompt(draft.value)) { event.preventDefault(); void send(true) }
  else if (event.key === 'Enter') { event.preventDefault(); void send() }
}
function restoreDraft(parts: PromptPart[]) {
  if (disposed) return
  draft.value = [...draft.value, ...(hasPrompt(draft.value) ? [{ type: 'text' as const, text: '\n' }] : []), ...parts.map(part => ({ ...part }))]
  codex.toast('消息草稿已放回输入框。')
  void nextTick(() => { if (!disposed) editor.value?.focus(true) })
}
function restoreSteer(id: string) { const parts = codex.takePendingSteer(id); if (parts) restoreDraft(parts) }
async function retryFailure() {
  if (blocked.value || codex.busy.value || codex.active.value?.turns.at(-1)?.status !== 'failed') return
  codex.cancelAutoRetry(); submitting.value = true
  try { await codex.send([{ type: 'text', text: '继续' }]) } finally { if (!disposed) submitting.value = false }
}
async function attach(files: File[]) {
  if (disposed || attaching.value || submitting.value) return
  attaching.value = true; draftError.value = ''
  const insertion = editor.value?.reserveInsertion()
  try {
    const images = await codex.readAttachments(files, draft.value)
    if (!disposed) images.forEach((image, index) => editor.value?.insertAttachment(image, index === 0 ? insertion : undefined))
  } catch (cause) { if (!disposed) draftError.value = cause instanceof Error ? cause.message : String(cause) }
  finally { if (!disposed) attaching.value = false }
}
function onScroll() {
  const host = messages.value
  if (host) atBottom.value = host.scrollHeight - host.clientHeight - host.scrollTop <= 32
}
watch([visible, statusMessage, connectionError, codex.currentTurnFailure], async () => {
  if (!atBottom.value) return
  await nextTick()
  if (!disposed && atBottom.value && messages.value) messages.value.scrollTop = messages.value.scrollHeight
}, { deep: true })
</script>
<template>
  <aside class="side-chat" aria-label="侧边聊天">
    <WorkspaceFilePanel floating :target="fileTarget" :cwd="codex.active.value?.cwd || profile.cwd" :device-name="profile.name" :connected="codex.connected.value" :run="codex.runWorkspaceCommand" @close="fileTarget = null" @copy="emit('copy', $event)" />
    <header><div><strong>侧边聊天</strong><small>{{ profile.name }}</small></div><SubAgentBadge v-if="agentIdentity" :name="agentIdentity.name" :role="agentIdentity.role" /><button type="button" class="icon-button" aria-label="关闭侧边聊天" @click="emit('close')"><PhX :size="18" /></button></header>
    <div ref="messages" class="side-chat-messages" @scroll.passive="onScroll">
      <template v-for="row in transcript" :key="row.key"><p v-if="'stoppedLabel' in row" class="turn-stopped-duration" :data-turn-id="row.turnId">{{ row.stoppedLabel }}</p><MessageItem v-else @open-file="fileTarget = $event" :work-duration-seconds="workDurations.get(row.item.id)" :item="row.item" :now="codex.clockNow.value" actions-disabled @copy="emit('copy', $event)" /></template>
      <TurnFailure class="side-chat-error" :failure="codex.currentTurnFailureInfo.value" :retryable="codex.active.value?.turns.at(-1)?.status === 'failed'" :loading="submitting || codex.autoRetryStarting.value" :disabled="blocked || codex.busy.value" :auto-retry-status="codex.autoRetryStatus.value" :auto-retry-pending="codex.autoRetryPending.value" @retry="retryFailure" @cancel-auto-retry="codex.cancelAutoRetry()" />
      <p v-if="connectionError" class="side-chat-error" role="alert">{{ connectionError }}</p>
      <p v-if="statusMessage" role="status" aria-live="polite" aria-atomic="true">{{ statusMessage }}</p>
      <button v-if="!opening && (!codex.connected.value || codex.threadLoadError.value || !ready)" class="text-button" type="button" :disabled="codex.loadingThread.value || codex.revising.value" @click="open">{{ codex.connected.value ? '重新加载侧边聊天' : '重新连接侧边聊天' }}</button>
      <p v-if="codex.notice.value" role="status">{{ codex.notice.value }}</p>
    </div>
    <div class="side-chat-input">
      <ApprovalIsland @open-file="fileTarget = $event" :approvals="codex.activeApprovals.value" :steers="codex.pendingSteers.value" :has-queue="hasQueue" :reasoning="codex.reconnectStatus.value || codex.compacting.value ? '' : codex.liveReasoning.value" :thinking-elapsed="codex.thinkingElapsed.value" :disabled="!codex.connected.value || codex.revising.value" @respond="codex.respond" @withdraw-steer="codex.withdrawPendingSteer" @restore-steer="restoreSteer">
        <template #queue><QueuePane @open-file="fileTarget = $event" :messages="codex.currentQueue.value" :working="codex.busy.value" :paused="codex.queuePaused.value" :server-managed="serverManaged" :save="codex.updateQueued" :read-attachments="codex.readAttachments" :disabled="!codex.connected.value || codex.loadingThread.value || opening || codex.revising.value" @editing="queueEditing = $event" @remove="codex.removeQueued" @restore="restoreDraft" @resume="codex.resumeQueue" @pause="codex.pauseQueue" /></template>
      </ApprovalIsland>
      <form @submit.prevent="send()">
        <PromptEditor :input-history="history.entries.value" @refresh-history="history.refresh()" :history-scope="profile.id + '/' + threadId" ref="editor" v-model="draft" label="侧边聊天消息" placeholder="继续讨论…" :disabled="codex.revising.value" @files="attach" @keydown="onKey" />
        <p v-if="draftError" class="side-chat-error" role="alert">{{ draftError }}</p>
        <div class="side-chat-actions">
          <button v-if="(codex.busy.value || hasQueue) && hasPrompt(draft)" type="button" class="icon-button" aria-label="加入侧边聊天队列" :disabled="blocked" @click="send(true)"><PhListNumbers :size="18" /></button>
          <button v-if="codex.activeTurn.value && !hasPrompt(draft)" type="button" class="icon-button" aria-label="停止侧边聊天生成" :disabled="!codex.connected.value || codex.revising.value || codex.interrupting.value" @click="codex.interrupt()"><PhSquare :size="16" /></button>
          <button v-else class="send-button" type="submit" aria-label="发送侧边聊天消息" :disabled="blocked || !hasPrompt(draft)"><PhArrowUp :size="20" /></button>
        </div>
      </form>
    </div>
  </aside>
</template>
<style scoped>
.side-chat { display: flex; flex-direction: column; width: min(420px, 38vw); min-width: 300px; margin: 8px; border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--surface); overflow: hidden; }
.side-chat > header { display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; border-bottom: 1px solid var(--line-soft); }
.side-chat > header strong { font-size: calc(14px * var(--ui-font-scale, 1)); font-weight: 500; }
.side-chat > header small { display: block; margin-top: 3px; color: var(--muted); font-size: calc(12px * var(--ui-font-scale, 1)); }
.side-chat-messages { flex: 1; min-height: 0; overflow: auto; padding: 16px 12px; font-size: calc(13px * var(--ui-font-scale, 1)); }
.side-chat-messages :deep(.markdown) { font-size: calc(14px * var(--ui-font-scale, 1)); }
.side-chat-messages :deep(.user-message-actions) { display: none; }
.side-chat-messages :deep(.activity) { margin-left: 0; }
.side-chat-error { color: var(--danger); overflow-wrap: anywhere; }
.side-chat-input { padding: 8px; }
.side-chat-input form { position: relative; padding: 12px; border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--surface); }
.side-chat-input > form :deep(.prompt-editor) { width: 100%; min-height: 65px; max-height: 180px; padding: 0; font-size: calc(14px * var(--ui-font-scale, 1)); }
.side-chat-actions { display: flex; justify-content: flex-end; gap: 4px; }
@media (max-width: 1000px) { .side-chat { position: fixed; inset: calc(var(--app-viewport-top, 0px) + 60px) 8px auto; height: calc(var(--app-viewport-height, 100dvh) - 68px); width: auto; min-width: 0; z-index: 25; margin: 0; } }
:global(:root[data-viewport-compact]) .side-chat-input { padding: 4px; min-height: 0; max-height: calc(100% - 60px); overflow-y: auto; }
:global(:root[data-viewport-compact]) .side-chat-input > form { padding: 8px; }
:global(:root[data-viewport-compact]) .side-chat-input > form :deep(.prompt-editor) { min-height: min(65px, max(calc(28px * var(--ui-font-scale, 1)), calc(var(--app-viewport-height) - 230px))); max-height: min(180px, max(calc(28px * var(--ui-font-scale, 1)), calc(var(--app-viewport-height) - 230px))); }
@media (max-width: 1000px), (pointer: coarse) { .side-chat-input > form :deep(.prompt-editor) { font-size: max(16px, calc(16px * var(--ui-font-scale, 1))); } }
</style>
