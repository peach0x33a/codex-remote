<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { PhCaretLeft, PhCaretRight, PhShieldCheck } from '@phosphor-icons/vue'
import ApprovalCard from './ApprovalCard.vue'
import { approvalTitle, nextApprovalSelection, type ApprovalDraft } from '../lib/approvals'
import type { Approval, RpcId } from '../../shared/protocol'
const props = defineProps<{ approvals: Approval[]; hasQueue?: boolean; disabled?: boolean }>()
const emit = defineEmits<{ respond: [id: RpcId, result: unknown] }>()
const content = ref<HTMLElement>()
const selected = ref<RpcId>(), drafts = reactive(new Map<RpcId, ApprovalDraft>())
watch(() => props.approvals.map(item => item.id), (ids, previous = []) => {
  selected.value = nextApprovalSelection(previous, ids, selected.value)
  for (const id of drafts.keys()) if (!ids.includes(id)) drafts.delete(id)
  for (const id of ids) if (!drafts.has(id)) drafts.set(id, { answers: {}, other: {} })
}, { immediate: true, flush: 'sync' })
const index = computed(() => Math.max(0, props.approvals.findIndex(item => item.id === selected.value)))
const current = computed(() => props.approvals[index.value])
watch(() => current.value?.id, async (id, previous) => {
  const restore = previous !== undefined && content.value?.contains(document.activeElement)
  if (!restore) return
  await nextTick()
  if (id !== undefined) content.value?.focus()
  else document.getElementById('message-input')?.focus()
})
function move(direction: number) { selected.value = props.approvals[(index.value + direction + props.approvals.length) % props.approvals.length]?.id }
</script>
<template>
  <section class="composer-island" :class="{ 'has-requests': !!current, 'has-queue': hasQueue }" aria-label="对话浮岛">
    <slot name="goal" />
    <Transition name="island-reveal"><div v-if="hasQueue" class="island-queue"><div class="island-queue-inner"><slot name="queue" /></div></div></Transition>
    <template v-if="current"><header class="island-header"><h3><PhShieldCheck :size="18" />{{ approvalTitle(current) }}</h3><nav class="island-navigation" aria-label="切换待处理请求"><button type="button" class="icon-button small" aria-label="上一个请求" :disabled="approvals.length < 2" @click="move(-1)"><PhCaretLeft :size="17" /></button><span aria-live="polite">{{ index + 1 }} / {{ approvals.length }}</span><button type="button" class="icon-button small" aria-label="下一个请求" :disabled="approvals.length < 2" @click="move(1)"><PhCaretRight :size="17" /></button></nav></header><div :key="current.id" ref="content" class="island-content" tabindex="-1" role="group" :aria-label="approvalTitle(current)"><ApprovalCard :key="current.id" :approval="current" :disabled="!!disabled" :draft="drafts.get(current.id)" compact @respond="emit('respond', current.id, $event)" /></div></template>
    <slot v-else />
  </section>
</template>
<style scoped>
.composer-island { position: relative; margin: 0 16px -16px; padding: 6px 10px 18px; min-height: 50px; border-radius: var(--radius-xl) var(--radius-xl) 0 0; background: var(--island, var(--sidebar)); border: 1px solid var(--line-soft); border-bottom: 0; }
.composer-island :deep(.composer-directory) { padding: 0; }
.composer-island.has-requests { padding: 0 0 20px; }
.composer-island.has-queue { padding-top: 0; }
.island-queue { display: grid; grid-template-rows: 1fr; }
.island-queue-inner { min-height: 0; overflow: hidden; }
.island-queue :deep(.queue-pane) { margin: 0; border: 0; border-bottom: 1px solid var(--line-soft); border-radius: 0; padding: 6px 6px 8px; background: transparent; }
.has-requests .island-queue { padding: 0 10px; }
.has-queue :deep(.composer-directory) { padding-top: 4px; }
.island-reveal-enter-active { transition: grid-template-rows 240ms var(--ease), opacity 180ms ease; }
.island-reveal-leave-active { transition: grid-template-rows 140ms ease, opacity 100ms ease; }
.island-reveal-enter-from, .island-reveal-leave-to { grid-template-rows: 0fr; opacity: 0; }
@keyframes island-content-in { from { opacity: .45; clip-path: inset(8px 0 0); } to { opacity: 1; clip-path: inset(0); } }
.island-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 9px 16px 2px; }
.island-header h3 { display: flex; align-items: center; gap: 7px; margin: 0; font-size: 14px; font-weight: 550; color: var(--ink); }
.island-header h3 svg { color: var(--accent); }
.island-navigation { display: flex; align-items: center; gap: 3px; flex-shrink: 0; color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
.island-navigation span { min-width: 34px; text-align: center; }
.island-content:focus { outline: none; }
.island-content { animation: island-content-in 180ms var(--ease); overflow: auto; max-height: min(42dvh, 360px); overscroll-behavior: contain; }
.island-content :deep(.approval-card) { margin: 0; padding: 8px 16px 12px; border: 0; border-radius: 0; box-shadow: none; background: transparent; }
.island-content :deep(.approval-card > p) { margin-bottom: 8px; font-size: 13px; }
.island-content :deep(pre) { max-height: 130px; font-size: 12px; padding: 9px 12px; background: var(--surface, var(--canvas)); }
.island-content :deep(.approval-actions) { margin-top: 10px; }
.island-content :deep(.button) { min-height: 34px; font-size: 13px; padding: 6px 14px; }
.island-content :deep(fieldset) { margin-top: 0; }
@media (max-width: 760px) { .composer-island { margin-left: 8px; margin-right: 8px; }.island-header { padding: 8px 10px 0; }.island-content :deep(.approval-card) { padding: 8px 10px 12px; }.island-content { max-height: 36dvh; }.island-header h3 { font-size: 13px; } }
</style>
