<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import { PhArrowsClockwise, PhFlag, PhPause, PhPencilSimple, PhPlay } from '@phosphor-icons/vue'
import MotionCollapse from './MotionCollapse.vue'
import BaseDialog from './BaseDialog.vue'
import type { ThreadGoal, ThreadGoalStatus as GoalStatus } from '../lib/thread-goal'

type GoalUpdate = { objective?: string; status?: GoalStatus; tokenBudget?: number }
const props = withDefaults(defineProps<{
  goal: ThreadGoal | null
  loading: boolean
  saving: boolean
  error: string
  supported: boolean | null
  disabled: boolean
  showSummary?: boolean
  scopeKey?: string
}>(), { showSummary: true })
const emit = defineEmits<{ refresh: []; save: [update: GoalUpdate]; clear: [] }>()

const labels: Record<GoalStatus, string> = {
  active: '进行中', paused: '已暂停', blocked: '受阻',
  usageLimited: '用量受限', budgetLimited: '预算已达上限', complete: '已完成',
}
const id = useId()
const open = ref(false), objective = ref(''), budget = ref('')
const statusVisible = ref(false)
let statusTimer: ReturnType<typeof setTimeout> | undefined
const baseline = ref({ objective: '', budget: '' })
const editingExisting = ref(false), confirmingClear = ref(false), attempted = ref(false), resumeAfterSave = ref(false)
const objectiveInput = ref<HTMLTextAreaElement>(), budgetInput = ref<HTMLInputElement>()
const dialogBody = ref<HTMLElement>(), editButton = ref<HTMLButtonElement>()
let opener: HTMLElement | null = null
type Pending = { kind: 'save' | 'status' | 'clear'; snapshot: string; update?: GoalUpdate }
const pending = ref<Pending | null>(null), requestingRefresh = ref(false)
const dirty = computed(() => objective.value !== baseline.value.objective || budget.value !== baseline.value.budget)
const busy = computed(() => props.saving || pending.value !== null)
const reading = computed(() => props.loading || requestingRefresh.value)
const canRefresh = computed(() => !props.disabled && !busy.value && !reading.value)
const canMutate = computed(() => !props.disabled && !busy.value && !reading.value && props.supported !== false)
const canChangeStatus = computed(() => canMutate.value && !confirmingClear.value
  && (props.scopeKey === undefined || props.goal?.threadId === props.scopeKey))
const resumable = computed(() => !!props.goal && ['paused', 'blocked', 'usageLimited', 'budgetLimited'].includes(props.goal.status))
const resumeNeedsBudget = computed(() => props.goal?.status === 'budgetLimited' && props.goal.tokenBudget !== null && props.goal.tokensUsed >= props.goal.tokenBudget)
const removed = computed(() => editingExisting.value && !props.goal && !reading.value)
const number = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 })
const formatCount = (value: number) => Number.isFinite(value) && value >= 0 ? number.format(value) : '—'
const remaining = computed(() => {
  const goal = props.goal
  return goal?.tokenBudget != null && Number.isFinite(goal.tokensUsed) && goal.tokensUsed >= 0
    ? Math.max(0, goal.tokenBudget - goal.tokensUsed) : null
})
const elapsed = computed(() => {
  if (!props.goal || !Number.isFinite(props.goal.timeUsedSeconds) || props.goal.timeUsedSeconds < 0) return '—'
  const seconds = Math.floor(props.goal.timeUsedSeconds)
  const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds % 3600 / 60)
  return hours ? `${number.format(hours)} 小时 ${minutes} 分 ${seconds % 60} 秒`
    : minutes ? `${minutes} 分 ${seconds % 60} 秒` : `${seconds} 秒`
})
const compactElapsed = computed(() => {
  if (elapsed.value === '—') return '—'
  const seconds = Math.floor(props.goal!.timeUsedSeconds)
  return `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds % 3600 / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
})
const budgetError = computed(() => {
  const value = budget.value.trim()
  if (value && (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) <= 0)) return '请输入正整数 token 预算。'
  if (resumeAfterSave.value && props.goal && (!value || Number(value) <= props.goal.tokensUsed)) return '预算已用尽，请设置高于已用 ' + formatCount(props.goal.tokensUsed) + ' tokens 的预算后恢复。'
  return ''
})
const objectiveError = computed(() => attempted.value && !objective.value.trim() ? '请输入目标。' : '')
const budgetHint = computed(() => props.goal?.tokenBudget != null
  ? `当前预算 ${formatCount(props.goal.tokenBudget)} tokens；留空保留当前预算，暂不支持取消。`
  : '可选，留空不设置预算。')

function synchronizeDraft() {
  objective.value = props.goal?.objective ?? ''
  budget.value = props.goal?.tokenBudget == null ? '' : String(props.goal.tokenBudget)
  baseline.value = { objective: objective.value, budget: budget.value }
  editingExisting.value = !!props.goal
  attempted.value = false
}
watch(() => [props.goal?.objective, props.goal?.tokenBudget], () => {
  // Counter/status refreshes and failed requests must never replace a dirty draft.
  if (!dirty.value && !busy.value) synchronizeDraft()
}, { immediate: true })
watch(() => props.goal, goal => { if (!goal) confirmingClear.value = false })
// Status belongs to the viewed scope, even while an earlier save is pending.
watch(() => props.scopeKey, hideStatus, { flush: 'sync' })
onBeforeUnmount(hideStatus)
watch(() => props.scopeKey, (scope, previous) => {
  // Creating a thread while saving changes "new" to its real ID; preserve that draft.
  if (scope === previous || props.saving) return
  open.value = false
  resumeAfterSave.value = false
  pending.value = null
  confirmingClear.value = false
  synchronizeDraft()
})

async function refresh() {
  if (!canRefresh.value) return
  requestingRefresh.value = true
  emit('refresh')
  await nextTick()
  requestingRefresh.value = false
}
function hideStatus() {
  if (statusTimer !== undefined) clearTimeout(statusTimer)
  statusTimer = undefined
  statusVisible.value = false
}
function showStatus() {
  hideStatus()
  statusVisible.value = true
  statusTimer = setTimeout(hideStatus, 8000)
  if (props.supported !== false) void refresh()
}
async function show(preset = '', resume = false) {
  resumeAfterSave.value = resume
  hideStatus()
  if (!open.value) {
    opener = typeof document !== 'undefined' && typeof HTMLElement !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (!dirty.value || editingExisting.value !== !!props.goal) synchronizeDraft()
    confirmingClear.value = false
    attempted.value = false
  }
  if (preset !== '' && !busy.value) objective.value = preset
  open.value = true
  if (props.supported !== false) void refresh()
  // BaseDialog opens its native modal after a tick; focus after that transition.
  await nextTick()
  await nextTick()
  if (open.value) (props.supported === false || busy.value ? dialogBody.value : objectiveInput.value)?.focus()
}
async function close() {
  if (busy.value) return
  open.value = false
  confirmingClear.value = false
  await nextTick()
  await nextTick()
  if (!open.value) (opener?.isConnected ? opener : editButton.value)?.focus()
}
defineExpose({ show, showStatus })

const snapshot = (goal: ThreadGoal | null) => JSON.stringify(goal)
function finishMutation() {
  const operation = pending.value
  pending.value = null
  if (!operation || props.error) return
  if (operation.kind === 'clear' && !props.goal) {
    synchronizeDraft()
    void close()
  } else if (operation.kind === 'save' && props.goal && snapshot(props.goal) !== operation.snapshot) {
    const update = operation.update!
    if ((update.objective === undefined || props.goal.objective === update.objective) &&
      (update.tokenBudget === undefined || props.goal.tokenBudget === update.tokenBudget)) {
      synchronizeDraft()
      void close()
    }
  }
}
watch(() => props.saving, (saving, previous) => {
  // An emit is not an acknowledgement. Only a completed request plus updated data can close the modal.
  if (previous && !saving) finishMutation()
}, { flush: 'post' })
async function dispatch(kind: Pending['kind'], update?: GoalUpdate) {
  if (!canMutate.value) return
  pending.value = { kind, snapshot: snapshot(props.goal), update }
  if (kind === 'clear') emit('clear')
  else emit('save', update!)
  await nextTick()
  // Guard same-tick double clicks without trapping the panel if no handler starts a request.
  if (!props.saving) pending.value = null
}
function save() {
  if (!canMutate.value || removed.value || confirmingClear.value) return
  attempted.value = true
  if (!objective.value.trim()) { objectiveInput.value?.focus(); return }
  if (budgetError.value) { budgetInput.value?.focus(); return }
  if (resumeAfterSave.value && !resumable.value) return
  if (props.goal && !dirty.value && !resumeAfterSave.value) return
  const update: GoalUpdate = { status: resumeAfterSave.value ? 'active' : props.goal?.status ?? 'active' }
  if (!resumeAfterSave.value || objective.value !== props.goal?.objective) update.objective = objective.value.trim()
  const value = budget.value.trim()
  // Omit a blank budget: null means "keep" in the server protocol, not "clear".
  if (value && Number(value) !== props.goal?.tokenBudget) update.tokenBudget = Number(value)
  void dispatch('save', update)
}
function resume() {
  if (!canChangeStatus.value || !resumable.value) return
  if (resumeNeedsBudget.value) { void show('', true).then(() => { if (open.value) budgetInput.value?.focus() }); return }
  void dispatch('status', { status: 'active' })
}
function pause() {
  if (!canChangeStatus.value || props.goal?.status !== 'active') return
  void dispatch('status', { status: 'paused' })
}
function clear() {
  if (!props.goal || !canMutate.value) return
  if (!confirmingClear.value) { confirmingClear.value = true; return }
  void dispatch('clear')
}
</script>

<template>
  <MotionCollapse :open="(!!goal && showSummary) || statusVisible"><section v-if="goal || statusVisible" class="goal-panel" :class="{ 'is-status-preview': statusVisible }" aria-label="当前目标" :aria-busy="reading || busy">
    <div v-if="goal" class="goal-row">
      <PhFlag :size="16" class="goal-icon" aria-hidden="true" />
      <button ref="editButton" type="button" class="goal-summary" aria-label="查看目标" :title="goal.objective" @click="show()">
        <span class="goal-heading"><span class="goal-objective">{{ goal.objective }}</span><span class="goal-status" :data-status="goal.status" :title="labels[goal.status]"><span class="goal-status-label">{{ labels[goal.status] }}</span></span><span v-if="elapsed !== '—'" class="goal-time" :title="'已用 ' + elapsed" :aria-label="'已用 ' + elapsed"><span class="goal-time-full">已用 {{ elapsed }}</span><span class="goal-time-compact" aria-hidden="true">{{ compactElapsed }}</span></span></span>
      </button>
      <button v-if="goal.status === 'active'" type="button" class="icon-button goal-status-toggle" aria-label="暂停目标" title="暂停目标" :disabled="!canChangeStatus" @click="pause"><PhPause :size="17" aria-hidden="true" /></button>
      <button v-else-if="resumable" type="button" class="icon-button goal-status-toggle" aria-label="恢复目标" :title="resumeNeedsBudget ? '调整预算后恢复目标' : '恢复目标'" :disabled="!canChangeStatus" @click="resume"><PhPlay :size="17" aria-hidden="true" /></button>
      <button type="button" class="icon-button goal-edit" aria-label="编辑目标" title="编辑目标" :disabled="!canMutate" @click="show()"><PhPencilSimple :size="17" aria-hidden="true" /></button>
      <button type="button" class="icon-button goal-refresh" aria-label="刷新目标" title="刷新目标" :disabled="!canRefresh" @click="refresh"><PhArrowsClockwise :size="17" aria-hidden="true" /></button>
    </div>
    <div v-if="statusVisible" class="goal-status-details" role="status" aria-live="polite" aria-atomic="true">
      <template v-if="goal">
        <dl class="goal-details">
          <div><dt>状态</dt><dd>{{ labels[goal.status] }}</dd></div>
          <div><dt>已用 tokens</dt><dd>{{ formatCount(goal.tokensUsed) }}</dd></div>
          <div><dt>Token 预算</dt><dd>{{ goal.tokenBudget === null ? '未设置' : formatCount(goal.tokenBudget) }}</dd></div>
          <div v-if="remaining !== null"><dt>剩余 tokens</dt><dd>{{ formatCount(remaining) }}</dd></div>
          <div><dt>已用时间</dt><dd>{{ elapsed }}</dd></div>
        </dl>
        <span v-if="reading">刷新中…</span>
      </template>
      <p v-else>{{ reading ? '正在读取目标…' : supported === false ? '当前服务不支持目标模式。' : '当前没有目标。' }}</p>
    </div>
    <div v-if="error && !open" class="goal-row-error"><p role="alert">{{ error }}</p><button type="button" class="text-button" :disabled="!canRefresh" @click="refresh">重试</button></div>
  </section></MotionCollapse>

  <Teleport to="body">
    <BaseDialog class="goal-dialog" :open="open" :title="goal ? '编辑目标' : '设置目标'" :dismissible="!busy" @close="close">
      <form class="goal-form" novalidate :aria-busy="busy" @submit.prevent="save">
        <div ref="dialogBody" class="goal-body" tabindex="-1">
          <div class="goal-toolbar">
            <span v-if="goal" class="goal-status" role="status">{{ labels[goal.status] }}</span>
            <span v-else-if="reading" role="status">正在读取目标…</span>
            <span v-else-if="supported !== false">开始后将自动执行目标。</span>
            <span class="spacer" />
            <button type="button" class="text-button" :disabled="!canRefresh" @click="refresh"><PhArrowsClockwise :size="16" aria-hidden="true" />{{ reading ? '刷新中…' : '刷新' }}</button>
          </div>
          <p v-if="supported === false" class="goal-notice" role="status">当前服务不支持目标模式。</p>
          <div v-if="error" class="goal-error"><p role="alert">{{ error }}</p><button type="button" class="text-button" :disabled="!canRefresh" @click="refresh">重新读取</button></div>
          <p v-if="removed" class="goal-notice" role="status">目标已被移除。关闭后可重新设置。</p>

          <div class="goal-fields">
            <dl v-if="goal" class="goal-details">
              <div><dt>已用 tokens</dt><dd>{{ formatCount(goal.tokensUsed) }}</dd></div>
              <div><dt>Token 预算</dt><dd>{{ goal.tokenBudget === null ? '未设置' : formatCount(goal.tokenBudget) }}</dd></div>
              <div v-if="remaining !== null"><dt>剩余 tokens</dt><dd>{{ formatCount(remaining) }}</dd></div>
              <div><dt>已用时间</dt><dd>{{ elapsed }}</dd></div>
            </dl>
            <label class="field" :for="`${id}-objective`">目标
              <textarea :id="`${id}-objective`" ref="objectiveInput" v-model="objective" class="goal-input" rows="4" autofocus required :disabled="busy || disabled" :readonly="supported === false" :aria-invalid="!!objectiveError" :aria-describedby="objectiveError ? `${id}-objective-error` : undefined" />
            </label>
            <p v-if="objectiveError" :id="`${id}-objective-error`" class="goal-validation" role="alert">{{ objectiveError }}</p>
            <label class="field" :for="`${id}-budget`">Token 预算
              <input :id="`${id}-budget`" ref="budgetInput" v-model="budget" class="goal-input" type="text" inputmode="numeric" autocomplete="off" :disabled="busy || disabled" :readonly="supported === false" :aria-invalid="!!budgetError" :aria-describedby="`${id}-budget-hint${budgetError ? ` ${id}-budget-error` : ''}`" />
              <span :id="`${id}-budget-hint`" class="field-hint">{{ budgetHint }}</span>
            </label>
            <p v-if="budgetError" :id="`${id}-budget-error`" class="goal-validation" role="alert">{{ budgetError }}</p>
            <div v-if="goal && !confirmingClear" class="goal-controls">
              <button v-if="goal.status === 'active' || resumable" type="button" class="text-button" :disabled="!canChangeStatus" @click="goal.status === 'active' ? pause() : resume()"><PhPause v-if="goal.status === 'active'" :size="16" aria-hidden="true" /><PhPlay v-else :size="16" aria-hidden="true" />{{ pending?.kind === 'status' ? '正在更新…' : goal.status === 'active' ? '暂停目标' : '恢复目标' }}</button>
              <button type="button" class="text-button danger" :disabled="!canMutate" @click="clear">移除目标</button>
            </div>
            <div v-if="goal && confirmingClear" class="goal-confirm" role="group" :aria-labelledby="`${id}-confirm`">
              <p :id="`${id}-confirm`">确认移除这个目标？</p>
              <div><button type="button" class="text-button" :disabled="busy" @click="confirmingClear = false">保留目标</button><button type="button" class="text-button danger" :disabled="!canMutate" @click="clear">{{ pending?.kind === 'clear' ? '正在移除…' : '确认移除' }}</button></div>
            </div>
          </div>
        </div>
        <footer class="dialog-actions goal-actions">
          <button type="button" class="button secondary" :disabled="busy" @click="close">关闭</button>
          <button v-if="supported !== false && !removed" type="submit" class="button primary" :disabled="!canMutate || !!budgetError || confirmingClear || (resumeAfterSave && !resumable) || (!!goal && !dirty && !resumeAfterSave)">{{ pending?.kind === 'save' ? '正在保存…' : resumeAfterSave ? '保存并恢复' : goal ? '保存修改' : '开始目标' }}</button>
        </footer>
      </form>
    </BaseDialog>
  </Teleport>
</template>

<style scoped>
.goal-panel { min-width: 0; padding: 4px 0; color: var(--ink-soft); container: goal-panel / inline-size; }
.goal-row { display: flex; align-items: center; gap: 6px; min-width: 0; }
.goal-icon { flex-shrink: 0; color: var(--muted); margin-inline: 5px 3px; }
.goal-row > .icon-button { flex-shrink: 0; }
.goal-summary { flex: 1; min-width: 0; padding: 0; text-align: left; border-radius: var(--radius-sm); }
.goal-summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.goal-heading { display: flex; align-items: baseline; gap: 10px; min-width: 0; font-size: calc(13px * var(--ui-font-scale, 1)); line-height: calc(20px * var(--ui-font-scale, 1)); }
.goal-objective { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.goal-status { flex-shrink: 0; color: var(--muted); font-size: calc(12px * var(--ui-font-scale, 1)); }
.goal-time { flex-shrink: 0; color: var(--muted); font-size: calc(12px * var(--ui-font-scale, 1)); font-variant-numeric: tabular-nums; }
.goal-time-compact { display: none; }
@container goal-panel (max-width: 520px) {
  .goal-row { gap: 0; }
  .goal-row > .icon-button { flex: 0 0 44px; width: 44px; height: 44px; min-width: 44px; min-height: 44px; }
  .goal-icon { display: none; }
  .goal-heading { display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 4px; row-gap: 0; align-items: center; }
  .goal-objective { grid-column: 1 / -1; }
  .goal-time { white-space: nowrap; }
  .goal-time-full { display: none; }
  .goal-time-compact { display: inline; }
}
@container goal-panel (max-width: 330px) {
  .goal-heading { column-gap: 3px; }
  .goal-objective { grid-column: 1; }
  .goal-heading > .goal-status { grid-column: 2; grid-row: 1; padding-inline: 2px; }
  .goal-heading > .goal-status::before { content: ''; display: block; width: 6px; height: 6px; border-radius: 50%; background: var(--muted); }
  .goal-heading > .goal-status[data-status="active"]::before { background: var(--accent); }
  .goal-heading > .goal-status > .goal-status-label { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .goal-time { grid-column: 1 / -1; grid-row: 2; }
}
.goal-row-error, .goal-error { display: flex; align-items: baseline; gap: 10px; color: var(--danger); font-size: calc(13px * var(--ui-font-scale, 1)); line-height: 1.6; }
.goal-row-error { padding: 4px 6px; }
.goal-row-error p, .goal-error p { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.goal-row-error button, .goal-error button { flex-shrink: 0; }
.goal-dialog { max-height: min(84dvh, 720px); background: var(--surface); }
.goal-dialog :deep(.dialog-inner) { display: flex; flex-direction: column; max-height: inherit; padding: 24px; }
.goal-dialog :deep(.dialog-header) { flex-shrink: 0; margin-bottom: 12px; }
.goal-dialog :deep(.dialog-header h2) { font-size: calc(18px * var(--ui-font-scale, 1)); }
.goal-form { display: flex; flex-direction: column; min-height: 0; }
.goal-body { min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 2px 4px 8px; }
.goal-body:focus { outline: none; }
.goal-toolbar { display: flex; align-items: center; gap: 12px; color: var(--muted); font-size: calc(13px * var(--ui-font-scale, 1)); margin-bottom: 12px; }
.goal-notice { margin: 8px 0 16px; color: var(--muted); font-size: calc(13px * var(--ui-font-scale, 1)); line-height: 1.6; }
.goal-error { margin-bottom: 16px; }
.goal-details { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 20px; padding: 0 0 16px; margin: 0 0 16px; border-bottom: 1px solid var(--line-soft); font-size: calc(12px * var(--ui-font-scale, 1)); line-height: 1.6; }
.goal-details > div { min-width: 0; }
.goal-details dt { color: var(--muted); }
.goal-details dd { margin: 0; color: var(--ink-soft); font-size: calc(13px * var(--ui-font-scale, 1)); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.is-status-preview .goal-heading { align-items: flex-start; flex-wrap: wrap; }
.is-status-preview .goal-objective { max-height: 120px; overflow-y: auto; white-space: pre-wrap; overflow-wrap: anywhere; }
.goal-status-details { padding: 6px; color: var(--muted); font-size: calc(12px * var(--ui-font-scale, 1)); line-height: 1.6; }
.goal-status-details .goal-details { padding: 0; margin: 0; border: 0; }
.goal-status-details p { margin: 0; }
.goal-dialog .field { margin-bottom: 16px; }
.goal-dialog .goal-input { display: block; width: 100%; min-width: 0; margin-top: 6px; padding: 10px 14px; border: 1px solid var(--line); background: var(--sidebar); color: var(--ink); font-size: calc(14px * var(--ui-font-scale, 1)); font-weight: 400; line-height: 1.6; }
.goal-dialog textarea.goal-input { min-height: 100px; max-height: 240px; resize: vertical; border-radius: var(--radius-md); }
.goal-dialog input.goal-input { height: 44px; border-radius: var(--radius-round); }
.goal-dialog .goal-input:focus { border-color: var(--accent); background: var(--surface); }
.goal-dialog .goal-input:disabled { opacity: .65; cursor: not-allowed; }
.goal-dialog .goal-input[aria-invalid="true"] { border-color: var(--danger); }
.goal-dialog .field-hint { color: var(--muted); padding-inline: 0; }
.goal-validation { margin: -8px 0 16px; color: var(--danger); font-size: calc(13px * var(--ui-font-scale, 1)); line-height: 1.6; }
.goal-controls, .goal-confirm > div { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px 16px; }
.goal-controls .text-button, .goal-confirm .text-button { min-height: 34px; padding: 4px 8px; border-radius: var(--radius-sm); }
.goal-controls .text-button:hover:not(:disabled), .goal-confirm .text-button:hover:not(:disabled) { background: var(--hover); }
.goal-controls .danger, .goal-confirm .danger { color: var(--danger); }
.goal-confirm { padding-top: 10px; border-top: 1px solid var(--line-soft); font-size: calc(13px * var(--ui-font-scale, 1)); line-height: 1.6; }
.goal-confirm p { margin-bottom: 6px; }
.goal-actions { flex-shrink: 0; justify-content: flex-end; position: static; padding: 14px 0 0; margin: 4px 0 0; background: var(--surface); }
.goal-actions .secondary { background: var(--surface); }
.goal-actions .secondary:hover:not(:disabled) { background: var(--hover); }
@media (max-width: 600px) {
  .goal-dialog :deep(.dialog-inner) { padding: 20px 16px; }
  .goal-heading { column-gap: 6px; }
  .goal-dialog .goal-input { font-size: calc(16px * var(--ui-font-scale, 1)); }
}
@media (max-width: 760px), (hover: none), (pointer: coarse) {
  .goal-panel .icon-button, .goal-dialog :deep(.icon-button) { width: 44px; height: 44px; min-width: 44px; min-height: 44px; }
  .goal-panel .text-button, .goal-dialog .text-button, .goal-dialog .button { min-height: 44px; }
  .goal-panel .goal-summary { min-height: 44px; }
}
</style>
