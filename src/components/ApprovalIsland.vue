<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { PhX, PhPencilSimple, PhArrowCounterClockwise, PhArrowBendUpRight, PhCaretLeft, PhCaretRight, PhShieldCheck, PhSparkle } from '@phosphor-icons/vue'
import ApprovalCard from './ApprovalCard.vue'
import InlineImage from './InlineImage.vue'
import AudioContent from './AudioContent.vue'
import InlineFile from './InlineFile.vue'
import PastedText from './PastedText.vue'
import type { PromptPart } from '../lib/prompt'
import { approvalTitle, nextApprovalSelection, type ApprovalDraft } from '../lib/approvals'
import type { Approval, RpcId } from '../../shared/protocol'
const props = defineProps<{ approvals: Approval[]; hasQueue?: boolean; hasQuestions?: boolean; disabled?: boolean; reasoning?: string; thinkingElapsed?: number; steers?: { id: string; accepted: boolean; ended?: boolean; cancelable?: boolean; parts: PromptPart[] }[]; completionOpen?: boolean; completionTitle?: string; completionTab?: string; completionTabs?: { id: string; label: string }[] }>()
const emit = defineEmits<{ withdrawSteer: [id: string]; restoreSteer: [id: string]; respond: [id: RpcId, result: unknown]; openFile: [target: { path: string }]; 'update:completionTab': [id: string]; completionHost: [host: HTMLElement | null]; completionActive: [active: boolean]; closeCompletion: [] }>()
const completionHost = ref<HTMLElement>(), completionTabsHost = ref<HTMLElement>(), page = ref('completion')
const content = ref<HTMLElement>()
const selected = ref<RpcId>(), drafts = reactive(new Map<RpcId, ApprovalDraft>())
const requestPage = (id: RpcId) => 'request:' + JSON.stringify(id)
const pages = computed(() => !props.completionOpen ? [] : [
  { id: 'completion', label: props.completionTitle || '列表' },
  ...props.approvals.map(item => ({ id: requestPage(item.id), label: approvalTitle(item) })),
  ...(props.hasQuestions ? [{ id: 'questions', label: '待回答的问题' }] : []),
  ...(props.hasQueue ? [{ id: 'queue', label: '消息队列' }] : []),
  ...(props.steers?.length ? [{ id: 'steers', label: '待插入的消息' }] : []),
  ...(props.reasoning?.trim() ? [{ id: 'reasoning', label: '思考进度' }] : []),
])
const pageIndex = computed(() => Math.max(0, pages.value.findIndex(item => item.id === page.value)))
watch(() => props.completionOpen, value => { if (value) page.value = 'completion' })
watch(() => pages.value.map(item => item.id), (ids, previous = []) => {
  if (ids.includes(page.value)) return
  // A resolved request advances within the requests, including wraparound.
  const request = props.approvals.find(item => item.id === selected.value)
  page.value = page.value.startsWith('request:') && request
    ? requestPage(request.id)
    : ids[Math.min(Math.max(0, previous.indexOf(page.value)), ids.length - 1)] || 'completion'
})
watch(page, id => {
  const request = props.approvals.find(item => requestPage(item.id) === id)
  if (request) selected.value = request.id
}, { flush: 'sync' })
watch(completionHost, host => emit('completionHost', host || null), { flush: 'post' })
watch(() => !!props.completionOpen && page.value === 'completion', active => emit('completionActive', active), { immediate: true })
function movePage(direction: number) {
  if (pages.value.length < 2) return
  page.value = pages.value[(pageIndex.value + direction + pages.value.length) % pages.value.length]!.id
  if (page.value === 'completion' && props.completionTabs?.length) emit('update:completionTab', props.completionTabs[direction > 0 ? 0 : props.completionTabs.length - 1]!.id)
}
function navigate(direction: number) {
  if (!props.completionOpen) return
  const tabs = props.completionTabs || [], index = tabs.findIndex(tab => tab.id === props.completionTab)
  if (page.value === 'completion' && index + direction >= 0 && index + direction < tabs.length) emit('update:completionTab', tabs[index + direction]!.id)
  else movePage(direction)
}
function islandKey(event: KeyboardEvent) {
  if (!props.completionOpen || !['ArrowLeft', 'ArrowRight'].includes(event.key) || (event.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return
  event.preventDefault(); event.stopPropagation(); navigate(event.key === 'ArrowLeft' ? -1 : 1)
}
watch(() => props.completionTab, async () => { await nextTick(); completionTabsHost.value?.querySelector?.<HTMLElement>('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }) })
defineExpose({ navigate, movePage, showCompletion: () => { page.value = 'completion' }, showQuestions: () => { page.value = 'questions' } })
watch(() => props.approvals.map(item => item.id), (ids, previous = []) => {
  selected.value = nextApprovalSelection(previous, ids, selected.value)
  for (const id of drafts.keys()) if (!ids.includes(id)) drafts.delete(id)
  for (const id of ids) if (!drafts.has(id)) drafts.set(id, { answers: {}, other: {} })
}, { immediate: true, flush: 'sync' })
const index = computed(() => Math.max(0, props.approvals.findIndex(item => item.id === selected.value)))
const current = computed(() => props.completionOpen
  ? props.approvals.find(item => requestPage(item.id) === page.value)
  : props.approvals[index.value])
watch(() => current.value?.id, async (_id, previous) => {
  if (previous === undefined || typeof document === 'undefined') return
  const activeElement = document.activeElement
  if (!content.value?.contains?.(activeElement)) return
  await nextTick()
  if (typeof document === 'undefined' || (document.activeElement !== activeElement && document.activeElement !== document.body)) return
  if (current.value) content.value?.focus()
  else document.getElementById('message-input')?.focus()
})
function move(direction: number) { selected.value = props.approvals[(index.value + direction + props.approvals.length) % props.approvals.length]?.id }
</script>
<template>
  <section class="composer-island" :class="{ 'has-requests': !!current, 'has-queue': hasQueue, 'has-completion': completionOpen }" aria-label="对话浮岛" @keydown="islandKey">
    <header v-if="completionOpen" class="island-page-header"><button type="button" class="icon-button small" aria-label="浮岛上一页" :disabled="pages.length < 2" @mousedown.prevent @click="movePage(-1)"><PhCaretLeft :size="17" /></button><span>{{ pages[pageIndex]?.label }}<small v-if="pages.length > 1"> {{ pageIndex + 1 }} / {{ pages.length }}</small></span><button type="button" class="icon-button small" aria-label="浮岛下一页" :disabled="pages.length < 2" @mousedown.prevent @click="movePage(1)"><PhCaretRight :size="17" /></button></header>
    <div v-if="completionOpen" v-show="page === 'completion'" ref="completionHost" class="island-completion-host" />
    <Transition name="island-reveal"><div v-if="reasoning?.trim() && (!current || completionOpen)" v-show="!completionOpen || page === 'reasoning'" class="island-thinking" aria-label="正在思考"><div class="island-thinking-inner"><div class="island-thinking-heading"><PhSparkle :size="16" aria-hidden="true" /><span>思考中<span v-if="thinkingElapsed !== undefined" class="island-thinking-time"> {{ thinkingElapsed }}秒</span></span></div><p class="island-thinking-preview" :title="reasoning">{{ reasoning }}</p></div></div></Transition>
    <TransitionGroup name="island-reveal" tag="div" class="island-steers" v-show="!completionOpen || page === 'steers'"><div v-for="steer in steers" :key="steer.id" class="island-steer" aria-label="插话"><div class="island-steer-inner"><div class="island-thinking-heading"><PhArrowBendUpRight :size="16" aria-hidden="true" /><span>{{ steer.ended ? '回合已结束 · 未确认插入' : steer.accepted ? '待插入' : '正在发送插话…' }}</span><button v-if="steer.ended" type="button" class="icon-button small steer-restore" aria-label="取回插话草稿" :disabled="!steer.cancelable" title="取回草稿" @click="emit('restoreSteer', steer.id)"><PhPencilSimple :size="15" /></button><button type="button" class="icon-button small steer-withdraw" :aria-label="steer.ended ? '移除未确认插话' : '撤回插话'" :disabled="!steer.cancelable" :title="steer.ended ? '移除此提示；不修改服务端会话' : steer.cancelable ? '撤回插话' : '当前服务端不支持单独撤回已接收的插话'" @click="emit('withdrawSteer', steer.id)"><PhX v-if="steer.ended" :size="15" /><PhArrowCounterClockwise v-else :size="15" /></button></div><div class="island-steer-text"><template v-for="(part, index) in steer.parts" :key="index"><PastedText v-if="part.type === 'text' && part.pasteId" :text="part.text" /><span v-else-if="part.type === 'text'">{{ part.text }}</span><span v-else-if="(part.type === 'skill' || part.type === 'mention')" class="inline-skill" :title="part.path"><PhSparkle :size="14" />{{ part.name }}</span><InlineFile v-else-if="part.type === 'file'" :file="part" @open="emit('openFile', { path: $event })" /><AudioContent v-else-if="part.type === 'audio'" :src="part.url || part.source?.path || ''" :name="part.name" /><InlineImage v-else :src="part.url" :name="part.name" :source="part.source" /></template></div></div></div></TransitionGroup>
    <Transition name="island-reveal"><div v-if="hasQueue" v-show="!completionOpen || page === 'queue'" class="island-queue"><div class="island-queue-inner"><slot name="queue" /></div></div></Transition>
    <div class="island-request-viewport" :class="{ shared: hasQuestions && !!current && !completionOpen }">
    <div v-show="!completionOpen || page === 'questions'"><slot name="questions" /></div>
    <div v-if="current" v-show="!completionOpen || page === requestPage(current.id)"><header v-if="!completionOpen" class="island-header"><h3><PhShieldCheck :size="18" />{{ approvalTitle(current) }}</h3><nav class="island-navigation" aria-label="切换待处理请求"><button type="button" class="icon-button small" aria-label="上一个请求" :disabled="approvals.length < 2" @click="move(-1)"><PhCaretLeft :size="17" /></button><span aria-live="polite">{{ index + 1 }} / {{ approvals.length }}</span><button type="button" class="icon-button small" aria-label="下一个请求" :disabled="approvals.length < 2" @click="move(1)"><PhCaretRight :size="17" /></button></nav></header><div :key="current.id" ref="content" class="island-content" tabindex="-1" role="group" :aria-label="approvalTitle(current)"><ApprovalCard :key="current.id" :approval="current" :disabled="!!disabled" :draft="drafts.get(current.id)" compact @respond="emit('respond', current.id, $event)" /></div></div>
    </div>
    <div v-show="!current && !completionOpen" class="island-context"><div class="island-project"><slot /></div><div class="island-workspace"><slot name="workspace" /></div><div class="island-goal"><slot name="goal" /></div></div>
    <div v-if="completionOpen && page === 'completion' && completionTabs?.length" ref="completionTabsHost" class="island-completion-tabs" role="tablist" aria-label="补全分类"><button v-for="tab in completionTabs" :key="tab.id" type="button" role="tab" :aria-selected="completionTab === tab.id" @mousedown.prevent @click="emit('update:completionTab', tab.id)">{{ tab.label }}</button></div>
  </section>
</template>
<style scoped>
.composer-island.has-completion { padding: 0 10px 18px; }
.island-page-header { display: flex; align-items: center; justify-content: space-between; min-height: 38px; gap: 12px; color: var(--muted); font-size: calc(13px * var(--ui-font-scale, 1)); }
.island-page-header small { margin-left: 8px; font-variant-numeric: tabular-nums; }
.island-completion-host { min-width: 0; min-height: 70px; }
.island-completion-tabs { display: flex; gap: 4px; overflow-x: auto; padding: 6px 0; border-top: 1px solid var(--line-soft); scrollbar-width: thin; }
.island-completion-tabs button { flex-shrink: 0; min-height: 32px; padding: 5px 10px; border-radius: var(--radius-sm); color: var(--muted); font-size: calc(12px * var(--ui-font-scale, 1)); }
.island-completion-tabs button[aria-selected="true"], .island-completion-tabs button:hover { background: var(--hover); color: var(--ink); }
.island-completion-tabs button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
@media (pointer: coarse) { .island-completion-tabs button { min-height: 44px; } }
.composer-island { position: relative; margin: 0 16px -16px; padding: 6px 10px 18px; min-height: 50px; border-radius: var(--radius-xl) var(--radius-xl) 0 0; background: var(--island, var(--sidebar)); border: 1px solid var(--line-soft); border-bottom: 0; }
.composer-island :deep(.composer-directory) { padding: 0; }
.island-context { display: flex; align-items: center; gap: 8px; min-width: 0; container: island-context / inline-size; }
.island-project { flex: 0 1 auto; min-width: 0; max-width: 45%; }
.island-project :deep(.working-directory-trigger) { max-width: 100%; min-width: 0; }
.island-workspace { flex: 0 1 auto; min-width: 0; max-width: 30%; }
.island-workspace:not(:has(:deep(.workspace-badge))) { display: none; }
.island-goal { flex: 1 1 0; min-width: 0; }
.island-context:not(:has(:deep(.goal-panel))) .island-project { max-width: 100%; }
.island-context:has(:deep(.is-status-preview)) { align-items: flex-start; flex-wrap: wrap; }
.island-context:has(:deep(.is-status-preview)) .island-goal { flex-basis: 100%; }
@container island-context (max-width: 760px) {
  .island-context:has(.goal-panel) .island-project { flex: 0 0 36px; max-width: 36px; }
  .island-context:has(.goal-panel) .island-workspace { flex: 0 0 24px; max-width: 24px; }
  .island-context:has(.goal-panel) :deep(.working-directory-trigger) { width: 100%; padding-inline: 0; justify-content: center; }
  .island-context:has(.goal-panel) :deep(.directory-trigger-content) { justify-content: center; width: 100%; min-height: 36px; }
  .island-context:has(.goal-panel) :deep(.workspace-badge) { display: flex; justify-content: center; width: 100%; padding: 0; }
  .island-context:has(.goal-panel) :deep(.directory-trigger-name),
  .island-context:has(.goal-panel) :deep(.workspace-badge-text) { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
}
@container island-context (max-width: 320px) {
  .island-context:has(.goal-panel) .island-project { flex-basis: 28px; max-width: 28px; }
  .island-context:has(.goal-panel) .island-workspace { flex-basis: 20px; max-width: 20px; }
}
@media (max-width: 600px) { .island-context { gap: 4px; } }
.composer-island.has-requests { padding: 0 0 20px; }
.composer-island.has-queue { padding-top: 0; }
.island-queue { display: grid; grid-template-rows: 1fr; }
.island-queue-inner { min-height: 0; overflow: hidden; }
.island-steer { display: grid; grid-template-rows: 1fr; }
.island-steer-inner { min-height: 0; overflow: hidden; padding: 8px 6px; border-bottom: 1px solid var(--line-soft); }
.has-requests .island-steers { padding: 0 10px; }
.steer-restore { margin-left: auto; }
.steer-withdraw:first-of-type { margin-left: auto; }
@media (pointer: coarse) { .steer-restore, .steer-withdraw { min-width: 44px; min-height: 44px; } }
.island-steer-text { margin-top: 4px; max-height: 100px; overflow-y: auto; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--ink-soft); font-size: calc(13px * var(--ui-font-scale, 1)); line-height: calc(24px * var(--ui-font-scale, 1)); }
.island-thinking { display: grid; grid-template-rows: 1fr; }
.island-thinking-inner { min-height: 0; overflow: hidden; padding: 8px 6px; }
.island-thinking-heading { display: flex; align-items: center; gap: 7px; color: var(--muted); font-size: calc(12px * var(--ui-font-scale, 1)); line-height: calc(20px * var(--ui-font-scale, 1)); }
.island-thinking-time { font-variant-numeric: tabular-nums; }
.island-thinking-preview { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; overflow-wrap: anywhere; margin: 4px 0 0; font-size: calc(13px * var(--ui-font-scale, 1)); line-height: calc(20px * var(--ui-font-scale, 1)); color: var(--ink-soft); }
.island-queue :deep(.queue-pane) { margin: 0; border: 0; border-bottom: 1px solid var(--line-soft); border-radius: 0; padding: 6px 6px 8px; background: transparent; }
.has-requests .island-queue { padding: 0 10px; }
.has-queue :deep(.composer-directory) { padding-top: 4px; }
.island-reveal-enter-active { transition: grid-template-rows 240ms var(--ease), opacity 180ms ease; }
.island-reveal-leave-active { transition: grid-template-rows 140ms ease, opacity 100ms ease; }
.island-reveal-enter-from, .island-reveal-leave-to { grid-template-rows: 0fr; opacity: 0; }
@media (prefers-reduced-motion: reduce) { .island-reveal-enter-active, .island-reveal-leave-active { transition: none; } }
@keyframes island-content-in { from { opacity: .45; clip-path: inset(8px 0 0); } to { opacity: 1; clip-path: inset(0); } }
.island-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 9px 16px 2px; }
.island-header h3 { display: flex; align-items: center; gap: 7px; margin: 0; font-size: calc(14px * var(--ui-font-scale, 1)); font-weight: 550; color: var(--ink); }
.island-header h3 svg { color: var(--accent); }
.island-navigation { display: flex; align-items: center; gap: 3px; flex-shrink: 0; color: var(--muted); font-size: calc(12px * var(--ui-font-scale, 1)); font-variant-numeric: tabular-nums; }
.island-navigation span { min-width: 34px; text-align: center; }
/* Coexisting native approvals and async questions share one bounded scroll area. */
.island-request-viewport.shared { max-height: min(calc(var(--app-viewport-height, 100dvh) * .42), 420px); overflow: auto; overscroll-behavior: contain; scrollbar-width: thin; }
.shared .island-content { max-height: none; overflow: visible; }
.shared :deep(.async-question-content form) { max-height: none; }
.shared :deep(.question-fields) { overflow: visible; }
.shared :deep(.question-submit) { position: sticky; bottom: 0; z-index: 1; padding-bottom: var(--space-2); background: var(--island, var(--sidebar)); }
@media (max-width: 760px) { .island-request-viewport.shared { max-height: calc(var(--app-viewport-height, 100dvh) * .36); } }
.island-content:focus { outline: none; }
.island-content { animation: island-content-in 180ms var(--ease); overflow: auto; max-height: min(calc(var(--app-viewport-height, 100dvh) * .42), 360px); overscroll-behavior: contain; }
.island-content :deep(.approval-card) { margin: 0; padding: 8px 16px 12px; border: 0; border-radius: 0; box-shadow: none; background: transparent; }
.island-content :deep(.approval-card > p) { margin-bottom: 8px; font-size: calc(13px * var(--ui-font-scale, 1)); }
.island-content :deep(pre) { max-height: 130px; font-size: var(--code-font-size, 13px); padding: 9px 12px; background: var(--surface, var(--canvas)); }
.island-content :deep(.approval-actions) { margin-top: 10px; }
.island-content :deep(.button) { min-height: 34px; font-size: calc(13px * var(--ui-font-scale, 1)); padding: 6px 14px; }
.island-content :deep(fieldset) { margin-top: 0; }
@media (max-width: 760px) { .composer-island { margin-left: 8px; margin-right: 8px; }.island-header { padding: 8px 10px 0; }.island-content :deep(.approval-card) { padding: 8px 10px 12px; }.island-content { max-height: calc(var(--app-viewport-height, 100dvh) * .36); }.island-header h3 { font-size: calc(13px * var(--ui-font-scale, 1)); } }
</style>
