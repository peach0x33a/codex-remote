<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { PhCaretLeft, PhCaretRight, PhChatCircleText, PhX } from '@phosphor-icons/vue'
import ApprovalCard from './ApprovalCard.vue'
import { asyncQuestionApproval, type AsyncAnswerResult, type AsyncQuestion } from '../lib/async-questions'
import type { ApprovalDraft } from '../lib/approvals'

const props = defineProps<{ questions: AsyncQuestion[]; disabled?: boolean; submit: (id: string, answer: string) => Promise<AsyncAnswerResult> }>()
const emit = defineEmits<{ focusComposer: [] }>()
const expanded = ref(false), selected = ref(''), submitting = ref(''), content = ref<HTMLElement>()
const drafts = reactive(new Map<string, ApprovalDraft>()), errors = reactive(new Map<string, string>())
const index = computed(() => Math.max(0, props.questions.findIndex(question => question.id === selected.value)))
const current = computed(() => props.questions[index.value])
const approval = computed(() => current.value && asyncQuestionApproval(current.value))
watch(() => props.questions.map(question => question.id), (ids, previous = []) => {
  if (!ids.includes(selected.value)) selected.value = ids[Math.min(Math.max(0, previous.indexOf(selected.value)), ids.length - 1)] || ''
  for (const id of drafts.keys()) if (!ids.includes(id)) { drafts.delete(id); errors.delete(id) }
  for (const question of props.questions) if (!drafts.has(question.id)) drafts.set(question.id, { answers: { answer: question.options[0] || '' }, other: {} })
  if (!ids.length) expanded.value = false
}, { immediate: true, flush: 'sync' })
async function focusAnswer() {
  await nextTick()
  const target = content.value?.querySelector<HTMLElement>('input:checked, input:not([type="radio"]), input, textarea')
  target?.focus()
  target?.scrollIntoView({ block: 'nearest' })
}
async function open() { if (!current.value) return false; expanded.value = true; await focusAnswer(); return true }
function close() { expanded.value = false; emit('focusComposer') }
async function move(direction: number) { selected.value = props.questions[(index.value + direction + props.questions.length) % props.questions.length]!.id; await focusAnswer() }
async function respond(result: unknown) {
  const question = current.value
  if (!question || props.disabled || submitting.value) return
  const answer = (result as { answers?: { answer?: { answers?: string[] } } }).answers?.answer?.answers?.[0]
  if (typeof answer !== 'string' || !answer.trim()) return
  submitting.value = question.id; errors.delete(question.id)
  try {
    const response = await props.submit(question.id, answer)
    if (!response.ok) { errors.set(question.id, response.error || '回答未发送，请重试。'); return }
    submitting.value = ''
    await nextTick()
    if (current.value) await focusAnswer()
    else emit('focusComposer')
  } catch (cause) { errors.set(question.id, cause instanceof Error ? cause.message : '回答未发送，请重试。') }
  finally { submitting.value = '' }
}
function keydown(event: KeyboardEvent) {
  if (event.isComposing || !event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || event.key !== 'ArrowRight') return
  event.preventDefault(); event.stopPropagation(); close()
}
defineExpose({ open })
</script>

<template>
  <!-- Extend the composer island with a compact, optional question entry and the existing answer form. -->
  <section v-if="questions.length" class="async-question-pane" aria-label="Codex 待回答的问题" @keydown="keydown">
    <button v-if="!expanded" type="button" class="async-question-trigger" :disabled="disabled" aria-expanded="false" aria-keyshortcuts="Shift+ArrowLeft" @click="open"><PhChatCircleText :size="18" aria-hidden="true" /><span>{{ questions.length }} 个问题待回答</span><span class="async-question-action">回答问题<kbd>Shift + ←</kbd></span></button>
    <template v-else>
      <header class="async-question-header"><h3><PhChatCircleText :size="18" aria-hidden="true" />回答 Codex 的问题</h3><nav aria-label="切换待回答的问题"><button type="button" class="icon-button small" aria-label="上一个问题" :disabled="questions.length < 2 || !!submitting" @click="move(-1)"><PhCaretLeft :size="17" /></button><span aria-live="polite">{{ index + 1 }} / {{ questions.length }}</span><button type="button" class="icon-button small" aria-label="下一个问题" :disabled="questions.length < 2 || !!submitting" @click="move(1)"><PhCaretRight :size="17" /></button><button type="button" class="icon-button small" aria-label="稍后回答，返回输入框" title="稍后回答 · Shift + →" @click="close"><PhX :size="17" /></button></nav></header>
      <div ref="content" class="async-question-content"><ApprovalCard v-if="approval && current" :key="current.id" :approval="approval" :draft="drafts.get(current.id)" :disabled="!!disabled || !!submitting" compact @respond="respond" /><p v-if="current && errors.get(current.id)" class="async-question-error" role="alert">{{ errors.get(current.id) }}</p><p v-if="submitting" class="async-question-progress" role="status">正在提交回答…</p></div>
    </template>
  </section>
</template>

<style scoped>
.async-question-pane { border-bottom: 1px solid var(--line-soft); }
.async-question-trigger { display: flex; align-items: center; gap: var(--space-2); width: 100%; min-height: 44px; padding: var(--space-2) var(--space-1); text-align: left; color: var(--ink); font-size: calc(13px * var(--ui-font-scale, 1)); border-radius: var(--radius-sm); }
.async-question-trigger:hover { background: var(--hover); }
.async-question-trigger:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.async-question-trigger > svg, .async-question-header h3 > svg { flex-shrink: 0; color: var(--accent); }
.async-question-action { display: flex; align-items: center; gap: var(--space-2); margin-left: auto; color: var(--accent); }
.async-question-action kbd { color: var(--muted); font: inherit; font-size: calc(12px * var(--ui-font-scale, 1)); }
.async-question-header { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); padding: var(--space-2) var(--space-1); }
.async-question-header h3 { display: flex; align-items: center; gap: var(--space-2); margin: 0; color: var(--ink); font-size: calc(14px * var(--ui-font-scale, 1)); font-weight: 550; }
.async-question-header nav { display: flex; align-items: center; gap: var(--space-1); flex-shrink: 0; color: var(--muted); font-size: calc(12px * var(--ui-font-scale, 1)); font-variant-numeric: tabular-nums; }
.async-question-content :deep(form) { display: flex; flex-direction: column; max-height: min(calc(var(--app-viewport-height, 100dvh) * .42), 360px); }
.async-question-content :deep(.question-fields) { min-height: 0; overflow: auto; overscroll-behavior: contain; scrollbar-width: thin; }
.async-question-content :deep(.question-submit) { flex-shrink: 0; padding-top: var(--space-2); }
.async-question-content :deep(.approval-card) { margin: 0; padding: var(--space-2) var(--space-1) var(--space-3); border: 0; border-radius: 0; box-shadow: none; background: transparent; }
.async-question-content :deep(legend) { white-space: pre-wrap; overflow-wrap: anywhere; }
.async-question-content :deep(.answer-option) { min-height: 44px; overflow-wrap: anywhere; }
.async-question-content :deep(.answer-option small:empty) { display: none; }
.async-question-content :deep(.button) { min-height: 44px; }
.async-question-error, .async-question-progress { margin: 0; padding: 0 var(--space-1) var(--space-3); font-size: calc(13px * var(--ui-font-scale, 1)); }
.async-question-error { color: var(--danger); }
.async-question-progress { color: var(--muted); }
@media (max-width: 760px) { .async-question-action kbd { display: none; }.async-question-header h3 { font-size: calc(13px * var(--ui-font-scale, 1)); }.async-question-content :deep(form) { max-height: calc(var(--app-viewport-height, 100dvh) * .36); }.async-question-header .icon-button { min-width: 44px; min-height: 44px; } }
</style>
