<script setup lang="ts">
import { computed, ref } from 'vue'
import { PhArrowCounterClockwise, PhPencilSimple, PhX, PhCode, PhCopy, PhFileText, PhGlobe, PhSparkle, PhTerminal, PhArrowsIn } from '@phosphor-icons/vue'
import InlineImage from './InlineImage.vue'
import { messageParts, reasoningText } from '../lib/prompt'
import type { Item } from '../../shared/protocol'
import { renderMarkdown } from '../lib/markdown'
import { fileLinkFromEvent, type FileLinkTarget } from '../lib/file-links'
import { parseCollabTool } from '../lib/collab-tool'
import { highlightCommand } from '../lib/command-highlight'
import { commandActivityKind, readFilePaths, toolActivityError, toolActivityState, toolActivityTitle } from '../lib/tool-activity'
import { vAnimatedDetails } from '../lib/details-motion'
import { formatWorkDuration, isWorkDurationCandidate } from '../lib/turn-duration'
const props = defineProps<{ item: Item; now?: number; workDurationSeconds?: number; actionsDisabled?: boolean; editDisabled?: boolean; actionHint?: string }>()
const emit = defineEmits<{ copy: [text: string]; edit: [id: string]; withdraw: [id: string]; openFile: [target: FileLinkTarget] }>()
function openFile(event: MouseEvent) { const target = fileLinkFromEvent(event); if (target) emit('openFile', target) }
const expanded = ref(false)
const workDurationLabel = computed(() => isWorkDurationCandidate(props.item) ? formatWorkDuration(props.workDurationSeconds) : undefined)
const parts = computed(() => messageParts(props.item.content))
const reasoning = computed(() => reasoningText(props.item).trim())
const reasoningElapsed = computed(() => {
  const start = props.item.startedAtMs
  const end = props.item.completedAtMs ?? (props.item.status === 'inProgress' ? props.now : undefined)
  if (typeof start !== 'number' || !Number.isFinite(start) || typeof end !== 'number' || !Number.isFinite(end) || end < start) return undefined
  return Math.floor((end - start) / 1000)
})
const reasoningLabel = computed(() => {
  const thinking = props.item.status === 'inProgress' && props.item.completedAtMs == null
  if (reasoningElapsed.value !== undefined) return `${thinking ? '思考中' : '已思考'} ${reasoningElapsed.value}秒`
  return thinking ? '思考中' : '思考过程'
})
const html = computed(() => renderMarkdown(props.item.text || ''))
const summaryHtml = computed(() => renderMarkdown(reasoning.value))
const collab = computed(() => parseCollabTool(props.item))
const commandHtml = computed(() => highlightCommand(props.item.command || ''))
const commandKind = computed(() => commandActivityKind(props.item))
const readPaths = computed(() => readFilePaths([props.item]))
const activityTitle = computed(() => toolActivityTitle(props.item))
const activityState = computed(() => toolActivityState(props.item))
const activityError = computed(() => toolActivityError(props.item))
</script>

<template>
  <article v-if="item.type === 'userMessage'" class="message message-user" aria-label="你的消息"><div class="user-bubble"><template v-for="(part, index) in parts" :key="index"><span v-if="part.type === 'text'" class="user-text">{{ part.text }}</span><span v-else-if="(part.type === 'skill' || part.type === 'mention')" class="inline-skill" :title="part.path"><PhSparkle :size="14" />{{ part.name }}</span><InlineImage v-else :src="part.url" :name="part.name" /></template></div><div class="user-message-actions"><button type="button" class="icon-button small" aria-label="编辑消息" :title="actionHint || '编辑消息'" :disabled="actionsDisabled || editDisabled" @click="emit('edit', item.id)"><PhPencilSimple :size="16" /></button><button type="button" class="icon-button small" aria-label="撤回消息" title="撤回消息" :disabled="actionsDisabled" @click="emit('withdraw', item.id)"><PhArrowCounterClockwise :size="16" /></button></div></article>
  <article v-else-if="item.type === 'agentMessage' || item.type === 'plan'" class="message message-agent" aria-label="Codex 回复">
    <div class="agent-avatar"><PhTerminal :size="18" weight="bold" /></div>
    <div class="agent-content"><div class="message-author">Codex <span v-if="item.type === 'plan'">计划</span><span v-else-if="item.phase === 'commentary'">进展</span></div><div class="markdown" @click="openFile" v-html="html" /><div v-if="item.text" class="agent-message-actions"><button type="button" class="icon-button copy-button" aria-label="复制回复" @click="emit('copy', item.text || '')"><PhCopy :size="16" /></button><span v-if="workDurationLabel" class="work-duration">{{ workDurationLabel }}</span></div></div>
  </article>
  <template v-else-if="item.type === 'reasoning'"><details v-if="reasoning && (item.status !== 'inProgress' || item.completedAtMs != null)" v-animated-details="(open: boolean) => expanded = open" class="activity reasoning" @toggle="expanded = ($event.target as HTMLDetailsElement).open"><summary><PhSparkle :size="16" /><span>{{ reasoningLabel }}</span></summary><div v-if="expanded" class="markdown" @click="openFile" v-html="summaryHtml" /></details></template>
  <div v-else-if="item.type === 'contextCompaction' && item.status !== 'inProgress'" class="activity compaction-activity"><PhArrowsIn :size="16" /><span>{{ item.status === 'failed' ? '上下文压缩失败' : '上下文已压缩' }}</span></div>
  <template v-else-if="item.type === 'contextCompaction'" />
  <details v-else v-animated-details="(open: boolean) => expanded = open" class="activity tool-activity" :open="expanded" @toggle="expanded = ($event.target as HTMLDetailsElement).open">
    <summary><PhFileText v-if="commandKind === 'read' || item.type === 'fileChange'" :size="16" /><PhTerminal v-else-if="item.type === 'commandExecution'" :size="16" /><PhGlobe v-else-if="item.type === 'webSearch'" :size="16" /><PhCode v-else :size="16" /><span class="activity-title" :class="{ 'activity-command-summary': item.type === 'commandExecution' && commandKind !== 'read' }" :title="activityTitle">{{ activityTitle }}</span><span v-if="activityState.failed" class="activity-state failed" :title="activityError || undefined"><PhX :size="13" aria-hidden="true" />失败</span></summary>
    <template v-if="expanded"><template v-if="item.type === 'commandExecution'"><div class="command-output"><div v-for="path in readPaths" :key="path" class="activity-path activity-read-path">{{ path }}</div><div v-if="item.cwd" class="activity-path">{{ item.cwd }}</div><pre v-if="item.command" class="command-code"><code v-html="commandHtml" /></pre><pre v-if="item.aggregatedOutput" class="command-result"><code>{{ item.aggregatedOutput }}</code></pre></div></template>
    <template v-else-if="item.type === 'fileChange'"><div v-for="change in item.changes" :key="change.path" class="file-change"><strong>{{ change.path }}</strong><pre v-if="change.diff"><code>{{ change.diff }}</code></pre></div></template>
    <p v-else-if="item.type === 'webSearch'">{{ item.query }}</p>
    <div v-else-if="collab" class="collab-details">
      <dl class="collab-meta">
        <template v-if="collab.sender"><dt>发起代理</dt><dd>{{ collab.sender }}</dd></template>
        <template v-if="collab.model"><dt>模型</dt><dd>{{ collab.model }}</dd></template>
        <template v-if="collab.effort"><dt>思考强度</dt><dd>{{ collab.effort }}</dd></template>
      </dl>
      <div v-if="collab.prompt" class="collab-section"><strong>{{ collab.promptLabel }}</strong><p class="collab-text">{{ collab.prompt }}</p></div>
      <div v-if="collab.agents.length" class="collab-section"><strong>代理（{{ collab.agents.length }}）</strong><ul class="collab-agents"><li v-for="agent in collab.agents" :key="agent.id || agent.path"><div class="collab-agent-heading"><span v-if="agent.path" class="activity-path">{{ agent.path }}</span><span v-if="agent.id" class="activity-path">{{ agent.id }}</span><span class="collab-agent-state" :class="{ failed: agent.failed }">{{ agent.status }}</span></div><p v-if="agent.message" class="collab-text"><span class="collab-message-label">{{ agent.messageLabel }}：</span>{{ agent.message }}</p></li></ul></div>
    </div>
    <pre v-else><code>{{ JSON.stringify(item.result || item.error || item, null, 2) }}</code></pre>
    <p v-if="activityError" class="activity-error" role="status">{{ activityError }}</p>
    </template>
  </details>
</template>

<style scoped>
.agent-message-actions { display: flex; align-items: center; gap: 8px; margin: 4px 0 0 -8px; }
.agent-message-actions > .copy-button { display: grid; flex-shrink: 0; margin: 0; color: var(--subtle); }
.work-duration { color: var(--muted); font-size: calc(12px * var(--ui-font-scale, 1)); font-variant-numeric: tabular-nums; }
.tool-activity > summary { max-width: 100%; }
.activity-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.activity-command-summary { color: var(--muted); }
.tool-activity .activity-state { flex-shrink: 0; }
.activity-error { color: var(--danger); white-space: pre-wrap; overflow-wrap: anywhere; }
.command-code { color: var(--ink-soft); }
.command-output { margin-top: 6px; max-width: 100%; padding-left: 14px; }
.command-output pre { margin: 0; max-width: none; padding: 6px 0; border: 0; border-radius: 0; background: transparent; }
.command-output .command-result { margin-top: 4px; padding-top: 10px; border-top: 1px solid var(--line-soft); color: var(--muted); }
.command-code :deep(.command-token-command) { color: var(--syntax-command); }
.command-code :deep(.command-token-flag) { color: var(--syntax-flag); }
.command-code :deep(.command-token-keyword) { color: var(--syntax-keyword); }
.command-code :deep(.command-token-string) { color: var(--syntax-string); }
.command-code :deep(.command-token-variable) { color: var(--syntax-variable); }
.command-code :deep(.command-token-operator) { color: var(--syntax-operator); }
.command-code :deep(.command-token-comment) { color: var(--syntax-comment); }
.command-code :deep(.command-token-number) { color: var(--syntax-number); }
.collab-details { padding: 0 12px; line-height: 1.7; overflow-wrap: anywhere; }
.collab-details p { margin: 6px 0; }
.collab-meta { display: grid; grid-template-columns: auto 1fr; gap: 3px 12px; margin: 8px 0; }
.collab-meta dt, .collab-message-label { color: var(--subtle); }
.collab-meta dd { margin: 0; min-width: 0; }
.collab-section { margin-top: 12px; }
.collab-section > strong { font-weight: 500; color: var(--ink); }
.collab-text { white-space: pre-wrap; max-height: 420px; overflow: auto; }
.collab-agents { list-style: none; padding: 0; margin: 6px 0 0; }
.collab-agents li { padding: 6px 0; }
.collab-agent-heading { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; }
.collab-agent-state { font-size: calc(12px * var(--ui-font-scale, 1)); }
.collab-agent-state.failed { color: var(--danger); }
.message-user { flex-direction: column; align-items: flex-end; }
.user-message-actions { display: flex; align-items: center; gap: 2px; padding-top: 3px; opacity: 0; transition: opacity .12s; }
.message-user:hover .user-message-actions, .message-user:focus-within .user-message-actions { opacity: 1; }
.user-message-actions .icon-button { color: var(--muted); }
@media (hover: none) { .user-message-actions { opacity: 1; } }
</style>
