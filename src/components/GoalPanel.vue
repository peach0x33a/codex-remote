<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue'
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
const baseline = ref({ objective: '', budget: '' })
const editingExisting = ref(false), confirmingClear = ref(false), attempted = ref(false)
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
const budgetError = computed(() => {
  const value = budget.value.trim()
  if (!value) return ''
  return /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0
    ? '' : '请输入正整数 token 预算。'
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
watch(() => props.scopeKey, (scope, previous) => {
  // Creating a thread while saving changes "new" to its real ID; preserve that draft.
  if (scope === previous || props.saving) return
  open.value = false
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
async function show(preset = '') {
  if (!open.value) {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
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
defineExpose({ show })

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
    if (props.goal.objective === update.objective &&
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
  if (props.goal && !dirty.value) return
  const update: GoalUpdate = { objective: objective.value.trim(), status: props.goal?.status ?? 'active' }
  const value = budget.value.trim()
  // Omit a blank budget: null means "keep" in the server protocol, not "clear".
  if (value && Number(value) !== props.goal?.tokenBudget) update.tokenBudget = Number(value)
  void dispatch('save', update)
}
function toggleStatus() {
  if (!props.goal || confirmingClear.value) return
  void dispatch('status', { status: props.goal.status === 'active' ? 'paused' : 'active' })
}
function clear() {
  if (!props.goal || !canMutate.value) return
  if (!confirmingClear.value) { confirmingClear.value = true; return }
  void dispatch('clear')
}
</script>

<template>
  <MotionCollapse :open="!!goal && showSummary"><section v-if="goal" class="goal-panel" aria-label="当前目标" :aria-busy="reading || busy">
    <div class="goal-row">
      <PhFlag :size="16" class="goal-icon" aria-hidden="true" />
      <div class="goal-summary">
        <div class="goal-heading"><span class="goal-objective" :title="goal.objective">{{ goal.objective }}</span><span class="goal-status">{{ labels[goal.status] }}</span></div>
        <div class="goal-metrics"><span>已用 {{ formatCount(goal.tokensUsed) }} tokens</span><span v-if="remaining !== null">剩余 {{ formatCount(remaining) }}</span><span>{{ elapsed }}</span><span v-if="reading" role="status">刷新中…</span></div>
      </div>
      <button ref="editButton" type="button" class="icon-button goal-edit" aria-label="编辑目标" title="编辑目标" @click="show()"><PhPencilSimple :size="17" aria-hidden="true" /></button>
      <button type="button" class="icon-button goal-refresh" aria-label="刷新目标" title="刷新目标" :disabled="!canRefresh" @click="refresh"><PhArrowsClockwise :size="17" aria-hidden="true" /></button>
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
              <button type="button" class="text-button" :disabled="!canMutate" @click="toggleStatus"><PhPause v-if="goal.status === 'active'" :size="16" aria-hidden="true" /><PhPlay v-else :size="16" aria-hidden="true" />{{ pending?.kind === 'status' ? '正在更新…' : goal.status === 'active' ? '暂停目标' : '继续目标' }}</button>
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
          <button v-if="supported !== false && !removed" type="submit" class="button primary" :disabled="!canMutate || !!budgetError || confirmingClear || (!!goal && !dirty)">{{ pending?.kind === 'save' ? '正在保存…' : goal ? '保存修改' : '开始目标' }}</button>
        </footer>
      </form>
    </BaseDialog>
  </Teleport>
</template>

<style scoped>
.goal-panel { min-width: 0; padding: 4px 0; color: var(--ink-soft); }
.goal-row { display: flex; align-items: center; gap: 6px; min-width: 0; }
.goal-icon { color: var(--muted); margin-inline: 5px 3px; }
.goal-summary { flex: 1; min-width: 0; }
.goal-heading { display: flex; align-items: baseline; gap: 10px; min-width: 0; font-size: 13px; line-height: 20px; }
.goal-objective { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.goal-status { flex-shrink: 0; color: var(--muted); font-size: 12px; }
.goal-metrics { display: flex; flex-wrap: wrap; column-gap: 12px; color: var(--muted); font-size: 12px; line-height: 18px; font-variant-numeric: tabular-nums; }
.goal-metrics > span { overflow-wrap: anywhere; }
.goal-row-error, .goal-error { display: flex; align-items: baseline; gap: 10px; color: var(--danger); font-size: 13px; line-height: 1.6; }
.goal-row-error { padding: 4px 6px; }
.goal-row-error p, .goal-error p { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.goal-row-error button, .goal-error button { flex-shrink: 0; }
.goal-dialog { max-height: min(84dvh, 720px); background: var(--surface); }
.goal-dialog :deep(.dialog-inner) { display: flex; flex-direction: column; max-height: inherit; padding: 24px; }
.goal-dialog :deep(.dialog-header) { flex-shrink: 0; margin-bottom: 12px; }
.goal-dialog :deep(.dialog-header h2) { font-size: 18px; }
.goal-form { display: flex; flex-direction: column; min-height: 0; }
.goal-body { min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 2px 4px 8px; }
.goal-body:focus { outline: none; }
.goal-toolbar { display: flex; align-items: center; gap: 12px; color: var(--muted); font-size: 13px; margin-bottom: 12px; }
.goal-notice { margin: 8px 0 16px; color: var(--muted); font-size: 13px; line-height: 1.6; }
.goal-error { margin-bottom: 16px; }
.goal-details { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 20px; padding: 0 0 16px; margin: 0 0 16px; border-bottom: 1px solid var(--line-soft); font-size: 12px; line-height: 1.6; }
.goal-details > div { min-width: 0; }
.goal-details dt { color: var(--muted); }
.goal-details dd { margin: 0; color: var(--ink-soft); font-size: 13px; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.goal-dialog .field { margin-bottom: 16px; }
.goal-dialog .goal-input { display: block; width: 100%; min-width: 0; margin-top: 6px; padding: 10px 14px; border: 1px solid var(--line); background: var(--sidebar); color: var(--ink); font-size: 14px; font-weight: 400; line-height: 1.6; }
.goal-dialog textarea.goal-input { min-height: 100px; max-height: 240px; resize: vertical; border-radius: var(--radius-md); }
.goal-dialog input.goal-input { height: 44px; border-radius: var(--radius-round); }
.goal-dialog .goal-input:focus { border-color: var(--accent); background: var(--surface); }
.goal-dialog .goal-input:disabled { opacity: .65; cursor: not-allowed; }
.goal-dialog .goal-input[aria-invalid="true"] { border-color: var(--danger); }
.goal-dialog .field-hint { color: var(--muted); padding-inline: 0; }
.goal-validation { margin: -8px 0 16px; color: var(--danger); font-size: 13px; line-height: 1.6; }
.goal-controls, .goal-confirm > div { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px 16px; }
.goal-controls .text-button, .goal-confirm .text-button { min-height: 34px; padding: 4px 8px; border-radius: var(--radius-sm); }
.goal-controls .text-button:hover:not(:disabled), .goal-confirm .text-button:hover:not(:disabled) { background: var(--hover); }
.goal-controls .danger, .goal-confirm .danger { color: var(--danger); }
.goal-confirm { padding-top: 10px; border-top: 1px solid var(--line-soft); font-size: 13px; line-height: 1.6; }
.goal-confirm p { margin-bottom: 6px; }
.goal-actions { flex-shrink: 0; justify-content: flex-end; position: static; padding: 14px 0 0; margin: 4px 0 0; background: var(--surface); }
.goal-actions .secondary { background: var(--surface); }
.goal-actions .secondary:hover:not(:disabled) { background: var(--hover); }
@media (max-width: 600px) {
  .goal-dialog :deep(.dialog-inner) { padding: 20px 16px; }
  .goal-heading { flex-wrap: wrap; column-gap: 8px; row-gap: 0; }
  .goal-dialog .goal-input { font-size: 16px; }
}
@media (max-width: 760px), (hover: none), (pointer: coarse) {
  .goal-panel .icon-button, .goal-dialog :deep(.icon-button) { width: 44px; height: 44px; min-width: 44px; min-height: 44px; }
  .goal-panel .text-button, .goal-dialog .text-button, .goal-dialog .button { min-height: 44px; }
}
</style>
