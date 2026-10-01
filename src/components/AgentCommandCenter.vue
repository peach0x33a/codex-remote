<script setup lang="ts">
import { useStoredChoice, oneOf } from '../composables/useStoredChoice'
import { computed, ref, watch } from 'vue'
import { PhArrowUpRight, PhArrowsClockwise, PhFolder, PhMagnifyingGlass } from '@phosphor-icons/vue'
import BaseDialog from './BaseDialog.vue'
import CustomSelect from './CustomSelect.vue'
import { useAgentCenter, type AgentCenterRequest } from '../composables/useAgentCenter'
import { AGENT_FILTERS, AGENT_STATE_LABELS, agentState, agentTitle, agentTokenTotals, filterAgentRows, groupAgentRows, type AgentFilter, type AgentGrouping } from '../lib/agent-center'

const props = defineProps<{ open: boolean; connected: boolean; deviceKey: string; request: AgentCenterRequest }>()
const emit = defineEmits<{ close: []; select: [threadId: string] }>()
const request: AgentCenterRequest = (method, params, options) => props.request(method, params, options)
const center = useAgentCenter({ request, isConnected: () => props.connected, isVisible: () => props.open, deviceKey: () => props.deviceKey })
const { rows, selectedId, details, loading, detailLoading, error, detailError, notice, updatedAt } = center
const groupingOptions: { value: AgentGrouping; label: string }[] = [{ value: 'project', label: '项目' }, { value: 'status', label: '状态' }, { value: 'model', label: '模型' }]
const query = ref('')
const status = useStoredChoice<AgentFilter>(() => 'codex-remote.tasks-filter.' + props.deviceKey, 'all', oneOf(AGENT_FILTERS.map(filter => filter.value)))
const grouping = useStoredChoice<AgentGrouping>(() => 'codex-remote.tasks-grouping.' + props.deviceKey, 'project', oneOf(['project', 'status', 'model']))
const visibleRows = computed(() => filterAgentRows(rows.value, query.value, status.value))
const groups = computed(() => groupAgentRows(visibleRows.value, grouping.value))
const selected = computed(() => rows.value.find(row => row.thread.id === selectedId.value))
const thread = computed(() => details.value?.thread || selected.value?.thread)
const tokens = computed(() => agentTokenTotals(details.value?.usage))
const hasTokens = computed(() => Object.values(tokens.value).some(value => value !== undefined))
const missingMessage = computed(() => detailLoading.value ? '读取中…' : details.value?.notice ? '暂不可用' : '暂无记录')
const lastUpdated = computed(() => updatedAt.value === null ? '' : new Date(updatedAt.value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
const count = (value: AgentFilter) => value === 'all' ? rows.value.length : rows.value.filter(row => row.state === value).length
const dateLabel = (seconds?: number) => typeof seconds === 'number' && Number.isFinite(seconds) ? new Date(seconds * 1000).toLocaleString('zh-CN') : '—'
const projectLabel = (path: string) => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path
watch(visibleRows, visible => {
  if (!visible.some(row => row.thread.id === selectedId.value)) center.select(visible[0]?.thread.id || '')
})
</script>

<template>
  <BaseDialog class="agent-center-dialog" :open="open" title="任务中心" wide @close="emit('close')">
    <div class="agent-center">
      <div class="agent-center-toolbar">
        <label class="agent-center-search"><PhMagnifyingGlass :size="18" aria-hidden="true" /><input v-model="query" type="search" aria-label="搜索任务、目录或模型" placeholder="搜索任务、目录或模型" /></label>
        <div class="agent-center-grouping"><span>分组</span><CustomSelect v-model="grouping" :options="groupingOptions" label="任务分组方式" /></div>
        <button type="button" class="text-button agent-center-refresh" :disabled="!connected || loading" @click="center.refresh()"><PhArrowsClockwise :size="17" :class="{ spinning: loading }" aria-hidden="true" />{{ loading ? '刷新中' : '刷新' }}</button>
      </div>
      <div class="agent-center-filters" role="group" aria-label="筛选任务状态">
        <button v-for="filter in AGENT_FILTERS" :key="filter.value" type="button" :aria-pressed="status === filter.value" @click="status = filter.value">{{ filter.label }}<span>{{ count(filter.value) }}</span></button>
      </div>
      <p v-if="error" class="agent-center-error" role="alert">{{ error }}<span v-if="rows.length"> 当前保留上次读取的列表。</span></p>
      <p v-if="notice" class="agent-center-note" role="status">{{ notice }}</p>
      <div v-if="!connected" class="agent-center-empty"><h3>设备未连接</h3></div>
      <div v-else-if="!rows.length" class="agent-center-empty" :aria-busy="loading"><h3>{{ loading ? '正在读取任务…' : error ? '任务读取失败' : '暂无任务' }}</h3></div>
      <div v-else class="agent-center-body">
        <nav class="agent-center-list" aria-label="任务列表" :aria-busy="loading">
          <p v-if="!visibleRows.length" class="agent-center-note">没有匹配的任务</p>
          <section v-for="group in groups" :key="group.key" class="agent-center-group">
            <h3 :title="group.label"><PhFolder v-if="grouping === 'project'" :size="16" aria-hidden="true" /><span class="agent-center-group-label">{{ grouping === 'project' && group.key ? projectLabel(group.label) : group.label }}</span><span class="agent-center-group-count">{{ group.rows.length }}</span></h3>
            <button v-for="row in group.rows" :key="row.thread.id" type="button" class="agent-center-row" :title="agentTitle(row.thread)" :aria-pressed="selectedId === row.thread.id" @click="center.select(row.thread.id)">
              <strong>{{ agentTitle(row.thread) }}</strong>
              <span class="agent-center-row-meta"><span v-if="row.thread.model" class="agent-center-row-model" :title="row.thread.model">{{ row.thread.model }}</span><span v-if="row.members.length > 1" class="agent-center-child-count" :aria-label="(row.members.length - 1) + ' 个子任务'" :title="(row.members.length - 1) + ' 个子任务'">+{{ row.members.length - 1 }}</span><span class="agent-center-state" :data-state="row.state">{{ AGENT_STATE_LABELS[row.state] }}</span></span>
            </button>
          </section>
        </nav>
        <section class="agent-center-details" aria-label="任务详情" :aria-busy="detailLoading">
          <template v-if="thread && selected">
            <div class="agent-center-detail-heading"><div><h3>{{ agentTitle(thread) }}</h3><p v-if="selected.members.length > 1">任务组 <span class="agent-center-state" :data-state="selected.state">{{ AGENT_STATE_LABELS[selected.state] }}</span></p></div><button type="button" class="text-button" :disabled="!connected" @click="emit('select', thread.id)">打开会话<PhArrowUpRight :size="16" aria-hidden="true" /></button></div>
            <p v-if="detailLoading" class="agent-center-note" role="status">正在读取详情…</p>
            <p v-if="detailError" class="agent-center-error" role="alert">{{ detailError }}</p>
            <p v-if="details?.notice" class="agent-center-note">{{ details.notice }}</p>
            <button v-if="detailError || details?.notice" type="button" class="text-button" :disabled="detailLoading" @click="center.refreshDetails()">重试详情</button>
            <dl class="agent-center-metadata">
              <div><dt>会话状态</dt><dd><span class="agent-center-state" :data-state="agentState(thread.status)">{{ AGENT_STATE_LABELS[agentState(thread.status)] }}</span><template v-if="thread.status?.type === 'systemError'"> · 系统错误</template></dd></div>
              <div v-if="thread.status?.activeFlags?.includes('waitingOnApproval')"><dt>等待事项</dt><dd>审批</dd></div>
              <div v-if="thread.status?.activeFlags?.includes('waitingOnUserInput')"><dt>等待事项</dt><dd>用户回复</dd></div>
              <div><dt>工作目录</dt><dd>{{ thread.cwd || '—' }}</dd></div>
              <div><dt>模型</dt><dd>{{ thread.model || '—' }}<template v-if="thread.reasoningEffort"> · {{ thread.reasoningEffort }}</template></dd></div>
              <div v-if="thread.gitInfo?.branch"><dt>分支</dt><dd>{{ thread.gitInfo.branch }}</dd></div>
              <div><dt>更新时间</dt><dd>{{ dateLabel(thread.updatedAt) }}</dd></div>
              <div><dt>会话 ID</dt><dd class="agent-center-id">{{ thread.id }}</dd></div>
            </dl>
            <section v-if="selected.members.length > 1" class="agent-center-section"><h4>子任务</h4><ul class="agent-center-children"><li v-for="child in selected.members.slice(1)" :key="child.id"><span>{{ child.agentNickname || agentTitle(child) }}</span><span class="agent-center-state" :data-state="agentState(child.status)">{{ AGENT_STATE_LABELS[agentState(child.status)] }}</span></li></ul></section>
            <section class="agent-center-section"><h4>Token 用量</h4><p v-if="!hasTokens" class="agent-center-note">{{ detailLoading ? '读取中…' : '—' }}</p><dl v-else class="agent-center-token-counts"><div v-if="tokens.input !== undefined"><dt>输入</dt><dd>{{ tokens.input.toLocaleString() }}</dd></div><div v-if="tokens.output !== undefined"><dt>输出</dt><dd>{{ tokens.output.toLocaleString() }}</dd></div><div v-if="tokens.total !== undefined"><dt>总计</dt><dd>{{ tokens.total.toLocaleString() }}</dd></div></dl></section>
            <section class="agent-center-section"><h4>最近用户消息</h4><p class="agent-center-message">{{ details?.messages.user ?? missingMessage }}</p></section>
            <section class="agent-center-section"><h4>最近助手消息</h4><p class="agent-center-message">{{ details?.messages.agent ?? missingMessage }}</p></section>
          </template>
          <p v-else class="agent-center-note">选择任务查看详情</p>
        </section>
      </div>
      <footer class="agent-center-footer"><span>{{ visibleRows.length }}<template v-if="visibleRows.length !== rows.length"> / {{ rows.length }}</template> 个任务</span><span v-if="lastUpdated">更新于 {{ lastUpdated }}</span></footer>
    </div>
  </BaseDialog>
</template>

<style scoped>
.agent-center-dialog { width: min(1100px, calc(100vw - 32px)); max-width: calc(100vw - 32px); }
.agent-center-dialog :deep(.dialog-inner) { padding: var(--dialog-padding); }
.agent-center-dialog :deep(.dialog-header) { margin-bottom: 12px; }
.agent-center-dialog :deep(.dialog-header h2) { font-size: calc(18px * var(--ui-font-scale, 1)); line-height: calc(24px * var(--ui-font-scale, 1)); font-weight: 600; }
.agent-center { --nav-hover: color-mix(in srgb, var(--ink) 4%, transparent); --nav-selected: color-mix(in srgb, var(--ink) 8%, transparent); color: var(--ink); min-width: 0; }
.agent-center-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.agent-center-search { display: flex; align-items: center; flex: 1 1 240px; gap: 8px; min-width: 0; padding: 0 10px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface); color: var(--muted); }
.agent-center-search:focus-within { outline: 2px solid var(--accent); outline-offset: 1px; }
.agent-center-search input { width: 100%; min-width: 0; height: 34px; padding: 0; border: 0; border-radius: 0; outline: none; background: transparent; color: var(--ink); font-size: calc(14px * var(--ui-font-scale, 1)); }
.agent-center-search input::placeholder { color: var(--muted); }
.agent-center-grouping { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: calc(12px * var(--ui-font-scale, 1)); }
.agent-center-grouping :deep(.custom-select-trigger) { min-width: 88px; min-height: 36px; padding: 0 var(--space-3); border-radius: var(--radius-round); font-size: calc(13px * var(--ui-font-scale, 1)); line-height: calc(20px * var(--ui-font-scale, 1)); color: var(--ink-soft); }
.agent-center-grouping :deep(.custom-select-trigger:hover:not(:disabled)), .agent-center-grouping :deep(.custom-select-trigger[aria-expanded="true"]) { background: var(--nav-hover); }
.agent-center-grouping :deep(.custom-select-menu) { min-width: max(140px, 100%); }
.agent-center-grouping :deep(.custom-select-menu button) { font-size: calc(13px * var(--ui-font-scale, 1)); line-height: calc(20px * var(--ui-font-scale, 1)); }
.agent-center-grouping :deep(.custom-select-menu button:hover:not(:disabled)), .agent-center-grouping :deep(.custom-select-menu button:focus-visible) { background: var(--nav-hover); }
.agent-center-grouping :deep(.custom-select-menu button[aria-selected="true"]) { color: var(--ink); background: var(--nav-selected); }
.agent-center .text-button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 34px; padding: 6px 8px; border-radius: var(--radius-sm); color: var(--muted); font-size: calc(13px * var(--ui-font-scale, 1)); white-space: nowrap; }
.agent-center .text-button:hover:not(:disabled) { color: var(--ink); background: var(--nav-hover); }
.agent-center-filters { display: flex; gap: 4px; overflow-x: auto; padding: 10px 0; }
.agent-center-filters button { display: inline-flex; align-items: center; gap: 6px; min-height: 30px; padding: 4px 8px; border-radius: var(--radius-sm); white-space: nowrap; color: var(--muted); font-size: calc(12px * var(--ui-font-scale, 1)); line-height: calc(20px * var(--ui-font-scale, 1)); }
.agent-center-filters button:hover, .agent-center-row:hover { background: var(--nav-hover); }
.agent-center-filters button[aria-pressed="true"], .agent-center-row[aria-pressed="true"] { background: var(--nav-selected); color: var(--ink); }
.agent-center-filters button > span { color: var(--muted); }
.agent-center-filters span, .agent-center-token-counts dd { font-variant-numeric: tabular-nums; }
.agent-center-body { display: grid; grid-template-columns: minmax(260px, .95fr) minmax(0, 1.05fr); min-height: 320px; border-top: 1px solid var(--line-soft); }
.agent-center-list { min-width: 0; max-height: 58dvh; overflow-y: auto; overscroll-behavior: contain; padding: 12px 12px 16px 0; }
.agent-center-group + .agent-center-group { margin-top: 16px; }
.agent-center-group h3 { display: flex; align-items: center; gap: 8px; min-height: 32px; margin: 0 0 3px; padding: 6px 8px; color: var(--muted); font-size: calc(14px * var(--ui-font-scale, 1)); line-height: calc(20px * var(--ui-font-scale, 1)); font-weight: 500; }
.agent-center-group h3 > svg { flex-shrink: 0; }
.agent-center-group-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.agent-center-group-count { flex-shrink: 0; font-size: calc(12px * var(--ui-font-scale, 1)); font-weight: 400; font-variant-numeric: tabular-nums; }
.agent-center-row { display: flex; align-items: center; gap: 8px; width: 100%; min-width: 0; min-height: 30px; margin-top: 1px; padding: 5px 8px 5px 32px; border-radius: var(--radius-sm); text-align: left; color: var(--ink-soft); transition: background-color 140ms var(--ease); }
.agent-center-row strong { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: calc(14px * var(--ui-font-scale, 1)); font-weight: 400; line-height: calc(20px * var(--ui-font-scale, 1)); }
.agent-center-row-meta { display: flex; align-items: center; flex-shrink: 0; gap: 8px; max-width: 60%; color: var(--muted); font-size: calc(12px * var(--ui-font-scale, 1)); line-height: calc(20px * var(--ui-font-scale, 1)); white-space: nowrap; }
.agent-center-row-model { min-width: 0; max-width: 88px; overflow: hidden; text-overflow: ellipsis; }
.agent-center-child-count { flex-shrink: 0; font-variant-numeric: tabular-nums; }
.agent-center-state { display: inline-flex; align-items: center; gap: 5px; flex-shrink: 0; color: var(--muted); font-size: calc(12px * var(--ui-font-scale, 1)); line-height: calc(20px * var(--ui-font-scale, 1)); white-space: nowrap; }
.agent-center-state::before { content: ''; width: 6px; height: 6px; box-sizing: border-box; flex-shrink: 0; border-radius: var(--radius-round); background: var(--caption); }
.agent-center-state[data-state="working"]::before { background: var(--accent); }
.agent-center-state[data-state="needsYou"]::before { background: var(--warn); }
.agent-center-state[data-state="inactive"]::before { background: transparent; border: 1px solid var(--caption); }
.agent-center-state[data-state="unknown"]::before { background: transparent; border: 1px dashed var(--muted); }
.agent-center-details { min-width: 0; max-height: 58dvh; overflow-y: auto; overscroll-behavior: contain; padding: 14px 0 16px 20px; border-left: 1px solid var(--line-soft); }
.agent-center-detail-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.agent-center-detail-heading > div { min-width: 0; }
.agent-center-detail-heading h3 { margin: 0; padding-top: 6px; font-size: calc(14px * var(--ui-font-scale, 1)); line-height: calc(20px * var(--ui-font-scale, 1)); font-weight: 500; overflow-wrap: anywhere; }
.agent-center-detail-heading p { display: flex; align-items: center; gap: 8px; margin: 4px 0 0; font-size: calc(12px * var(--ui-font-scale, 1)); color: var(--muted); }
.agent-center-metadata { margin: 0; font-size: calc(13px * var(--ui-font-scale, 1)); line-height: calc(20px * var(--ui-font-scale, 1)); }
.agent-center-metadata > div { display: grid; grid-template-columns: 72px minmax(0, 1fr); gap: 8px; margin-top: 6px; }
.agent-center-metadata dt, .agent-center-token-counts dt { color: var(--muted); }
.agent-center-metadata dd { margin: 0; overflow-wrap: anywhere; }
.agent-center-id { font-family: var(--code-font-family, ui-monospace, monospace); font-size: calc(12px * var(--ui-font-scale, 1)); }
.agent-center-section { margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--line-soft); }
.agent-center-section h4 { margin: 0 0 6px; font-size: calc(14px * var(--ui-font-scale, 1)); line-height: calc(20px * var(--ui-font-scale, 1)); font-weight: 500; }
.agent-center-message { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.7; font-size: calc(13px * var(--ui-font-scale, 1)); }
.agent-center-token-counts { display: flex; flex-wrap: wrap; gap: 8px 20px; margin: 0; font-size: calc(13px * var(--ui-font-scale, 1)); line-height: calc(20px * var(--ui-font-scale, 1)); }
.agent-center-token-counts dd { margin: 0; }
.agent-center-children { list-style: none; padding: 0; margin: 0; font-size: calc(13px * var(--ui-font-scale, 1)); }
.agent-center-children li { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 4px 0; overflow-wrap: anywhere; }
.agent-center-children li > span:first-child { min-width: 0; }
.agent-center-note { margin: 4px 0; color: var(--muted); font-size: calc(12px * var(--ui-font-scale, 1)); line-height: calc(20px * var(--ui-font-scale, 1)); }
.agent-center-error { margin: 0 0 8px; color: var(--danger); overflow-wrap: anywhere; font-size: calc(13px * var(--ui-font-scale, 1)); line-height: calc(20px * var(--ui-font-scale, 1)); }
.agent-center-empty { padding: 36px 8px; color: var(--muted); }
.agent-center-empty h3 { margin: 0; font-size: calc(14px * var(--ui-font-scale, 1)); font-weight: 400; }
.agent-center-footer { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px; padding-top: 10px; border-top: 1px solid var(--line-soft); color: var(--muted); font-size: calc(12px * var(--ui-font-scale, 1)); line-height: calc(20px * var(--ui-font-scale, 1)); }
.agent-center button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
@media (max-width: 700px) {
  .agent-center-dialog { width: calc(100vw - 24px); max-width: calc(100vw - 24px); }
  .agent-center-search { flex-basis: 100%; }
  .agent-center-search input { font-size: calc(16px * var(--ui-font-scale, 1)); }
  .agent-center-refresh { margin-left: auto; }
  .agent-center-body { grid-template-columns: minmax(0, 1fr); min-height: 0; }
  .agent-center-list { max-height: 28dvh; padding-right: 0; }
  .agent-center-row-model { max-width: 20vw; }
  .agent-center-details { max-height: none; border-left: 0; border-top: 1px solid var(--line-soft); padding: 14px 0; }
  .agent-center-detail-heading { flex-wrap: wrap; }
}
@media (hover: none), (pointer: coarse) {
  .agent-center-search input { height: 44px; }
  .agent-center-row, .agent-center-filters button, .agent-center .text-button, .agent-center-grouping :deep(.custom-select-trigger), .agent-center-grouping :deep(.custom-select-menu button) { min-height: 44px; min-width: 44px; }
  .agent-center-dialog :deep(.dialog-header .icon-button) { width: 44px; height: 44px; min-width: 44px; min-height: 44px; }
}
@media (prefers-reduced-motion: reduce) { .agent-center-row { transition: none; } .agent-center .spinning { animation: none; } }
</style>
