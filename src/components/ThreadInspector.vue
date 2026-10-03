<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { PhArrowUpRight, PhArrowsClockwise, PhCaretDown, PhCaretRight, PhFileText, PhPlus, PhRobot, PhX } from '@phosphor-icons/vue'
import { vAnimatedDetails } from '../lib/details-motion'
import FileTypeIcon from './FileTypeIcon.vue'
import MotionCollapse from './MotionCollapse.vue'
import SubAgentBadge from './SubAgentBadge.vue'
import type { ChangedFile, ThreadAgent, SubAgentIdentity } from '../lib/thread-insights'

const props = withDefaults(defineProps<{
  agents: ThreadAgent[]
  files: ChangedFile[]
  loading?: boolean
  error?: string
  disabled?: boolean
  identity?: SubAgentIdentity | null
}>(), { loading: false, error: '', disabled: false })
const emit = defineEmits<{
  inspect: [id: string]
  openThread: [id: string]
  inspectFile: [path: string]
  refresh: []
  close: []
  createOutput: [kind: string]
}>()
const outputMenu = ref<HTMLDetailsElement>()
const outputKinds = [{ id: 'document', label: '文档' }, { id: 'presentation', label: '演示文稿' }, { id: 'spreadsheet', label: '电子表格' }, { id: 'website', label: '站点' }]
function createOutput(kind: string) {
  if (props.disabled) return
  if (outputMenu.value) outputMenu.value.open = false
  emit('createOutput', kind)
}
function outputKey(event: KeyboardEvent) {
  if (event.key === 'Escape' && outputMenu.value?.open) { event.preventDefault(); event.stopPropagation(); outputMenu.value.open = false; outputMenu.value.querySelector('summary')?.focus(); return }
  const buttons = [...(outputMenu.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') || [])]
  if (!outputMenu.value?.open || !buttons.length) return
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
  const indices: Record<string, number> = { ArrowDown: (index + 1) % buttons.length, ArrowUp: (index - 1 + buttons.length) % buttons.length, Home: 0, End: buttons.length - 1 }
  if (event.key in indices) { event.preventDefault(); buttons[indices[event.key]]?.focus() }
}
const id = useId(), selected = ref(''), showAll = ref(false)
const visibleAgents = computed(() => showAll.value ? props.agents : props.agents.slice(0, 6))
const unavailable = computed(() => props.disabled || props.loading)
const labels: Record<string, string> = {
  pendingInit: '初始化中', running: '执行中', active: '执行中', idle: '空闲',
  interrupted: '已中断', completed: '已完成', errored: '执行出错',
  shutdown: '已关闭', notFound: '未找到代理', notLoaded: '未加载', systemError: '系统错误',
}
const statusLabel = (status: string) => Object.hasOwn(labels, status) ? labels[status] : status
const count = (value: number | undefined): value is number => value !== undefined && Number.isSafeInteger(value) && value >= 0
const number = new Intl.NumberFormat('zh-CN')
const detailId = (agentId: string) => `${id}-agent-${encodeURIComponent(agentId)}`
const iconColors = ['var(--syntax-command)', 'var(--syntax-flag)', 'var(--syntax-string)', 'var(--syntax-variable)']
function iconColor(agentId: string) {
  let hash = 0
  for (const character of agentId) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  return iconColors[hash % iconColors.length]
}
function inspect(agentId: string) {
  if (props.disabled) return
  if (selected.value === agentId) { selected.value = ''; return }
  selected.value = agentId
  emit('inspect', agentId)
}
function retry() {
  if (unavailable.value) return
  if (selected.value) emit('inspect', selected.value)
  else emit('refresh')
}
function toggleList() {
  showAll.value = !showAll.value
  if (!showAll.value && !props.agents.slice(0, 6).some(agent => agent.id === selected.value)) selected.value = ''
}
watch(() => props.agents.map(agent => agent.id), ids => {
  if (!ids.includes(selected.value)) selected.value = ''
  if (ids.length <= 6) showAll.value = false
})
watch(() => props.disabled ? [] : visibleAgents.value.map(agent => agent.id), (ids, previous = []) => {
  for (const agentId of ids) if (!previous.includes(agentId)) emit('inspect', agentId)
}, { immediate: true })
</script>

<template>
  <aside class="thread-inspector" :aria-labelledby="`${id}-title`">
    <header class="inspector-header">
      <h2 :id="`${id}-title`">会话详情</h2>
      <div class="inspector-header-actions">
        <button type="button" class="icon-button" aria-label="刷新会话详情" title="刷新" :disabled="unavailable" @click="emit('refresh')"><PhArrowsClockwise :size="17" aria-hidden="true" /></button>
        <button type="button" class="icon-button" aria-label="关闭会话详情" title="关闭" @click="emit('close')"><PhX :size="18" aria-hidden="true" /></button>
      </div>
    </header>
    <div class="inspector-body" :aria-busy="loading">
      <div v-if="error" class="inspector-error"><p role="alert">{{ error }}</p><button type="button" class="text-button" :disabled="unavailable" @click="retry">重试</button></div>
      <p v-if="loading" class="inspector-note" role="status">正在读取…</p>
      <section v-if="identity" class="inspector-section subagent-identity" aria-label="子代理会话信息">
        <SubAgentBadge :name="identity.name" :role="identity.role" />
        <dl v-if="identity.name || identity.role" class="inspector-metadata"><div v-if="identity.name"><dt>代理</dt><dd>{{ identity.name }}</dd></div><div v-if="identity.role"><dt>角色</dt><dd>{{ identity.role }}</dd></div></dl>
        <button v-if="identity.parentThreadId" type="button" class="text-button" :disabled="disabled" @click="emit('openThread', identity.parentThreadId)">返回父会话<PhArrowUpRight :size="15" aria-hidden="true" /></button>
      </section>

      <section class="inspector-section" aria-label="输出内容">
        <h3>输出内容</h3>
        <details v-animated-details ref="outputMenu" class="output-create" @keydown="outputKey">
          <summary class="inspector-row"><span>创建文件或站点</span><PhPlus :size="16" aria-hidden="true" /></summary>
          <div role="menu" aria-label="创建输出内容"><button v-for="kind in outputKinds" :key="kind.id" type="button" role="menuitem" class="inspector-row" :disabled="disabled" @click="createOutput(kind.id)">{{ kind.label }}</button></div>
        </details>
      </section>

      <section v-if="files.length" class="inspector-section" :aria-labelledby="`${id}-files`">
        <h3 :id="`${id}-files`">文件更改 <span>{{ files.length }}</span></h3>
        <ul class="inspector-list inspector-files">
          <li v-for="file in files" :key="file.path">
            <button type="button" class="inspector-row inspector-file" :title="file.path" :aria-label="`查看 ${file.path} 的变更`" :disabled="disabled" @click="emit('inspectFile', file.path)">
              <FileTypeIcon :path="file.path" :size="17" />
              <span class="inspector-path">{{ file.path }}</span>
              <span v-if="count(file.added) || count(file.removed)" class="inspector-counts"><span v-if="count(file.added)" class="added" :aria-label="`新增 ${file.added} 行`">+{{ number.format(file.added) }}</span><span v-if="count(file.removed)" class="removed" :aria-label="`删除 ${file.removed} 行`">−{{ number.format(file.removed) }}</span></span>
            </button>
          </li>
        </ul>
      </section>

      <section v-if="agents.length" class="inspector-section" :aria-labelledby="`${id}-agents`">
        <h3 :id="`${id}-agents`">子代理 <span>{{ agents.length }}</span></h3>
        <TransitionGroup :id="`${id}-agent-list`" name="expand-list" tag="ul" class="inspector-list">
          <li v-for="agent in visibleAgents" :key="agent.id" class="motion-list-row" :inert="!visibleAgents.some(visible => visible.id === agent.id)"><div class="motion-list-inner">
            <button type="button" class="inspector-row inspector-agent" :aria-expanded="selected === agent.id" :aria-controls="selected === agent.id ? detailId(agent.id) : undefined" :disabled="disabled" @click="inspect(agent.id)">
              <PhRobot :size="18" class="inspector-agent-icon" :style="{ '--agent-color': iconColor(agent.id) }" aria-hidden="true" />
              <span class="inspector-agent-name" :title="agent.name || agent.id">{{ agent.name || agent.id }}</span>
              <span v-if="agent.status" class="inspector-agent-state" :title="statusLabel(agent.status)">{{ statusLabel(agent.status) }}</span>
              <PhCaretRight :size="13" class="inspector-caret" :class="{ rotated: selected === agent.id }" aria-hidden="true" />
            </button>
            <MotionCollapse :open="selected === agent.id"><div :id="detailId(agent.id)" class="inspector-agent-detail" :aria-label="`${agent.name || agent.id} 详情`" role="region">
              <dl v-if="agent.role || agent.status" class="inspector-metadata"><div v-if="agent.role"><dt>角色</dt><dd>{{ agent.role }}</dd></div><div v-if="agent.status"><dt>状态</dt><dd>{{ statusLabel(agent.status) }}</dd></div></dl>
              <div v-if="agent.message" class="inspector-result"><h4>{{ agent.status === 'errored' ? '错误说明' : agent.status === 'completed' ? '结果' : '消息' }}</h4><p>{{ agent.message }}</p></div>
              <button type="button" class="text-button inspector-open" :disabled="disabled" @click="emit('openThread', agent.id)">打开对话<PhArrowUpRight :size="15" aria-hidden="true" /></button>
            </div></MotionCollapse>
          </div></li>
        </TransitionGroup>
        <button v-if="agents.length > 6" type="button" class="text-button inspector-more" :aria-expanded="showAll" :aria-controls="`${id}-agent-list`" @click="toggleList">{{ showAll ? '收起' : `查看更多（${agents.length - 6}）` }}<PhCaretDown :size="13" :class="{ reversed: showAll }" aria-hidden="true" /></button>
      </section>
    </div>
  </aside>
</template>

<style scoped>
.thread-inspector { display: flex; flex-direction: column; width: 100%; height: var(--inspector-height, 100%); min-width: 0; min-height: 0; color: var(--ink-soft); background: var(--sidebar); }
.inspector-header { display: flex; flex-shrink: 0; align-items: center; justify-content: space-between; gap: 8px; min-height: 52px; padding: 8px 12px 8px 18px; }
.inspector-header h2 { margin: 0; font-size: calc(14px * var(--ui-font-scale, 1)); line-height: calc(22px * var(--ui-font-scale, 1)); font-weight: 500; }
.inspector-header-actions { display: flex; align-items: center; gap: 2px; }
.inspector-header .icon-button { width: 30px; height: 30px; }
.inspector-body { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 0 10px 20px; }
.inspector-section + .inspector-section { margin-top: 22px; }
.output-create > summary { list-style: none; cursor: pointer; color: var(--muted); justify-content: space-between; }
.output-create > summary::-webkit-details-marker { display: none; }
.output-create > summary:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.output-create[open] > summary { color: var(--ink-soft); }
.output-create [role="menu"] { padding: 3px 0 3px 12px; }
.inspector-section h3 { display: flex; align-items: baseline; gap: 7px; margin: 0 0 6px; padding: 6px 8px; color: var(--muted); font-size: calc(12px * var(--ui-font-scale, 1)); line-height: calc(20px * var(--ui-font-scale, 1)); font-weight: 500; }
.inspector-section h3 > span { font-weight: 400; font-variant-numeric: tabular-nums; }
.inspector-list { list-style: none; margin: 0; padding: 0; }
.inspector-files { max-height: min(34dvh, 360px); overflow-y: auto; }
.inspector-row { display: flex; align-items: center; gap: 8px; width: 100%; min-width: 0; min-height: 34px; padding: 6px 8px; border-radius: var(--radius-sm); text-align: left; color: var(--ink-soft); font-size: calc(13px * var(--ui-font-scale, 1)); line-height: calc(20px * var(--ui-font-scale, 1)); transition: background-color 120ms ease, color 120ms ease; }
.inspector-row:hover:not(:disabled) { background: var(--hover); }
.inspector-row:active:not(:disabled) { background: var(--active); }
.inspector-row[aria-expanded="true"] { background: var(--hover); }
.inspector-row > svg { color: var(--muted); }
.inspector-path, .inspector-agent-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.inspector-agent-name { font-size: calc(14px * var(--ui-font-scale, 1)); }
.inspector-row .inspector-agent-icon { color: color-mix(in srgb, var(--agent-color) 78%, var(--muted)); }
.inspector-agent-state { max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: calc(12px * var(--ui-font-scale, 1)); }
.inspector-counts { display: flex; flex-shrink: 0; gap: 5px; font-size: calc(11px * var(--ui-font-scale, 1)); font-variant-numeric: tabular-nums; }
.added { color: var(--diff-added); }
.removed { color: var(--diff-removed); }
.inspector-agent-detail { padding: 8px 8px 12px 34px; font-size: calc(13px * var(--ui-font-scale, 1)); line-height: 1.7; }
.inspector-metadata { margin: 0; }
.inspector-metadata > div { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 10px; }
.inspector-metadata dt { color: var(--muted); }
.inspector-metadata dd { margin: 0; overflow-wrap: anywhere; }
.inspector-result { margin-top: 10px; }
.inspector-result h4 { margin: 0 0 4px; color: var(--muted); font-size: calc(12px * var(--ui-font-scale, 1)); font-weight: 400; }
.inspector-result p { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 300px; overflow-y: auto; }
.thread-inspector .text-button { min-height: 32px; padding: 4px 8px; border-radius: var(--radius-sm); font-size: calc(12px * var(--ui-font-scale, 1)); }
.thread-inspector .text-button:hover:not(:disabled) { background: var(--hover); }
.inspector-open { margin-top: 8px; margin-left: -8px; }
.inspector-more { margin: 4px 0 0 26px; }
.inspector-caret, .inspector-more svg { transition: transform 180ms var(--ease); }
.inspector-caret.rotated { transform: rotate(90deg); }
.reversed { transform: rotate(180deg); }
.inspector-error { display: flex; align-items: baseline; gap: 8px; padding: 4px 8px 12px; color: var(--danger); font-size: calc(13px * var(--ui-font-scale, 1)); line-height: 1.6; }
.inspector-error p { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.inspector-error button { flex-shrink: 0; }
.inspector-note { padding: 6px 8px 12px; color: var(--muted); font-size: calc(12px * var(--ui-font-scale, 1)); line-height: 1.7; }
.inspector-empty { padding-top: 20px; }
.thread-inspector button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
@media (max-width: 760px), (hover: none), (pointer: coarse) {
  .thread-inspector .icon-button { width: 44px; height: 44px; min-width: 44px; min-height: 44px; }
  .inspector-row, .thread-inspector .text-button { min-height: 44px; }
  .inspector-header { padding-top: 4px; padding-bottom: 4px; }
}
</style>
