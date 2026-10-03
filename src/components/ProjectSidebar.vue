<script setup lang="ts">
import { useStoredChoice, isStringList } from '../composables/useStoredChoice'
import { computed, ref, useId, watch } from 'vue'
import { PhArchive, PhCaretDown, PhFolder, PhListNumbers, PhPlus } from '@phosphor-icons/vue'
import type { Thread } from '../../shared/protocol'
import { subAgentIdentity } from '../lib/thread-insights'
import SubAgentBadge from './SubAgentBadge.vue'

const props = defineProps<{
  deviceId?: string
  threads: Thread[]
  activeId?: string
  busyThreadIds?: string[]
  approvalThreadIds?: string[]
  queueCounts: Record<string, number>
}>()
const emit = defineEmits<{
  select: [id: string]
  archive: [id: string]
  newChat: [cwd: string]
}>()

type Project = { cwd: string; name: string; threads: Thread[] }
const id = useId()
const previewCount = 5
const collapsedSaved = useStoredChoice(() => 'codex-remote.project-collapsed.' + (props.deviceId || 'default'), [] as string[], isStringList)
const expandedSaved = useStoredChoice(() => 'codex-remote.project-expanded.' + (props.deviceId || 'default'), [] as string[], isStringList)
const collapsed = computed(() => new Set(collapsedSaved.value)), expanded = computed(() => new Set(expandedSaved.value))
const busyIds = computed(() => new Set(props.busyThreadIds))
const approvalIds = computed(() => new Set(props.approvalThreadIds))
const activeCwd = computed(() => props.threads.find(thread => thread.id === props.activeId)?.cwd)
const projects = computed(() => {
  const groups = new Map<string, Project>()
  for (const thread of props.threads) {
    let project = groups.get(thread.cwd)
    if (!project) {
      const path = thread.cwd.replace(/[\/\\]+$/, '')
      project = { cwd: thread.cwd, name: path.split(/[\/\\]/).pop() || thread.cwd || '未设置工作目录', threads: [] }
      groups.set(thread.cwd, project)
    }
    project.threads.push(thread)
  }
  // Keep the parent's conversation order and group by full path, not basename.
  return [...groups.values()]
})

watch([() => props.activeId, activeCwd], () => {
  if (activeCwd.value !== undefined) collapsedSaved.value = collapsedSaved.value.filter(cwd => cwd !== activeCwd.value)
})

function toggle(kind: 'collapsed' | 'expanded', cwd: string) {
  const saved = kind === 'collapsed' ? collapsedSaved : expandedSaved
  saved.value = saved.value.includes(cwd) ? saved.value.filter(value => value !== cwd) : [...saved.value, cwd]
}
function visibleThreads(project: Project) {
  if (collapsed.value.has(project.cwd)) return project.threads.filter(thread => thread.id === props.activeId)
  if (expanded.value.has(project.cwd)) return project.threads
  // The active conversation stays visible even when it falls outside the first five.
  return project.threads.filter((thread, index) => index < previewCount || thread.id === props.activeId)
}
function title(thread: Thread) {
  return thread.name || thread.preview || '未命名对话'
}
function queueCount(thread: Thread) {
  return Math.max(0, props.queueCounts[thread.id] || 0)
}
function archiveDisabled(thread: Thread) {
  return busyIds.value.has(thread.id) || thread.status?.type === 'active' || thread.status?.type === 'running' || queueCount(thread) > 0
}
function archive(thread: Thread) {
  if (!archiveDisabled(thread)) emit('archive', thread.id)
}
</script>

<template>
  <div class="project-sidebar">
    <p v-if="!projects.length" class="project-empty">暂无对话</p>
    <section v-for="(project, index) in projects" :key="project.cwd" class="project-group" :aria-labelledby="`${id}-heading-${index}`">
      <div class="project-header">
        <button
          :id="`${id}-heading-${index}`"
          type="button"
          class="project-toggle"
          :title="project.cwd || project.name"
          :aria-label="`${collapsed.has(project.cwd) ? '展开' : '收起'}项目 ${project.name}`"
          :aria-expanded="!collapsed.has(project.cwd)"
          :aria-controls="`${id}-threads-${index}`"
          @click="toggle('collapsed', project.cwd)"
        >
          <span class="project-disclosure" aria-hidden="true"><PhFolder :size="16" class="project-folder" /><PhCaretDown :size="14" class="project-caret" :class="{ collapsed: collapsed.has(project.cwd) }" /></span>
          <span class="project-name">{{ project.name }}</span>
        </button>
        <button type="button" class="project-new" :aria-label="`在 ${project.name} 中开启新对话`" :title="`在 ${project.cwd || project.name} 中开启新对话`" @click="emit('newChat', project.cwd)">
          <PhPlus :size="16" aria-hidden="true" />
        </button>
      </div>
      <div :id="`${id}-threads-${index}`" class="project-threads" v-show="!collapsed.has(project.cwd) || activeCwd === project.cwd">
        <div v-for="thread in visibleThreads(project)" :key="thread.id" class="thread-row" :class="{ active: activeId === thread.id, 'can-archive': !archiveDisabled(thread) }">
          <button type="button" class="thread-select" :title="title(thread)" :aria-current="activeId === thread.id ? 'page' : undefined" @click="emit('select', thread.id)">
            <SubAgentBadge v-if="subAgentIdentity(thread)" compact :name="subAgentIdentity(thread)?.name" :role="subAgentIdentity(thread)?.role" />
            <span class="thread-title">{{ title(thread) }}</span>
            <span v-if="queueCount(thread)" class="queue-badge" :title="`${queueCount(thread)} 条消息排队中`" :aria-label="`${queueCount(thread)} 条消息排队中`"><PhListNumbers :size="12" aria-hidden="true" />{{ queueCount(thread) }}</span>
            <span v-if="approvalIds.has(thread.id)" class="approval-badge" title="等待权限批准">待确认</span>
            <span v-else-if="busyIds.has(thread.id) || thread.status?.type === 'active' || thread.status?.type === 'running'" class="thread-running" role="img" aria-label="正在工作" title="正在工作" />
          </button>
          <button type="button" class="archive-button" :aria-label="`归档 ${title(thread)}`" :title="archiveDisabled(thread) ? '运行中或有排队消息的对话暂不可归档' : '归档对话'" :disabled="archiveDisabled(thread)" @click="archive(thread)">
            <PhArchive :size="15" aria-hidden="true" />
          </button>
        </div>
        <button
          v-if="!collapsed.has(project.cwd) && project.threads.length > previewCount && (expanded.has(project.cwd) || project.threads.length > visibleThreads(project).length)"
          type="button"
          class="project-show-more"
          :aria-expanded="expanded.has(project.cwd)"
          :aria-controls="`${id}-threads-${index}`"
          @click="toggle('expanded', project.cwd)"
        >
          <PhCaretDown :size="12" :class="{ reversed: expanded.has(project.cwd) }" aria-hidden="true" />
          <span>{{ expanded.has(project.cwd) ? '收起' : '展开显示' }}</span>
          <span v-if="!expanded.has(project.cwd)" class="remaining-count">{{ project.threads.length - visibleThreads(project).length }}</span>
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.project-sidebar { min-width: 0; padding: 0 2px 12px; }
.project-group + .project-group { margin-top: 20px; }
.project-header { position: relative; display: flex; align-items: center; min-height: 32px; border-radius: var(--radius-sm); transition: background-color 140ms var(--ease); }
.project-header:hover, .project-header:focus-within { background: var(--nav-hover, var(--hover)); }
.project-toggle { display: flex; flex: 1; align-items: center; gap: 8px; min-width: 0; min-height: 32px; padding: 6px 34px 6px 8px; border-radius: inherit; color: var(--muted); text-align: left; font-size: calc(14px * var(--ui-font-scale, 1)); line-height: calc(20px * var(--ui-font-scale, 1)); font-weight: 500; }
.project-toggle:hover { color: var(--ink); }
.project-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.project-disclosure { position: relative; display: grid; place-items: center; flex: 0 0 16px; width: 16px; height: 18px; color: var(--muted); }
.project-folder, .project-caret { position: absolute; transition: opacity 140ms var(--ease), transform 140ms var(--ease); }
.project-caret { opacity: 0; }
.project-caret.collapsed { transform: rotate(-90deg); }
.project-header:hover .project-caret, .project-header:focus-within .project-caret { opacity: 1; }
.project-header:hover .project-folder, .project-header:focus-within .project-folder { opacity: 0; }
.project-new, .archive-button { position: absolute; right: 3px; top: 50%; display: grid; place-items: center; width: 26px; height: 26px; padding: 0; margin: 0; transform: translateY(-50%); border-radius: var(--radius-sm); color: var(--muted); opacity: 0; transition: opacity 140ms var(--ease), color 140ms var(--ease); }
.project-header:hover .project-new, .project-header:focus-within .project-new { opacity: 1; }
.project-new:hover, .archive-button:not(:disabled):hover { color: var(--ink); }
.project-threads { display: grid; gap: 1px; margin: 3px 0 0; padding: 0; border: 0; }
.thread-row { position: relative; display: flex; align-items: center; min-width: 0; min-height: 30px; border-radius: var(--radius-sm); transition: background-color 140ms var(--ease); }
.thread-row:hover { background: var(--nav-hover, var(--hover)); }
.thread-row.active, .thread-row.active:hover { background: var(--nav-selected, var(--active)); }
.thread-row > .thread-select { display: flex; flex: 1; align-items: center; gap: 8px; min-width: 0; min-height: 30px; padding: 5px 9px 5px 32px; text-align: left; color: var(--ink-soft); font-size: calc(14px * var(--ui-font-scale, 1)); line-height: calc(20px * var(--ui-font-scale, 1)); font-weight: 400; border-radius: inherit; }
.thread-row.active > .thread-select { color: var(--ink); }
.thread-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.thread-row.can-archive:hover > .thread-select, .thread-row.can-archive:focus-within > .thread-select { padding-right: 34px; }
.queue-badge { display: inline-flex; align-items: center; gap: 3px; flex-shrink: 0; padding: 0; color: var(--muted); background: transparent; border-radius: 0; font-size: calc(11px * var(--ui-font-scale, 1)); line-height: calc(18px * var(--ui-font-scale, 1)); font-variant-numeric: tabular-nums; }
.approval-badge { flex-shrink: 0; padding: 0; background: transparent; color: color-mix(in srgb, var(--warn) 80%, var(--ink)); font-size: calc(12px * var(--ui-font-scale, 1)); line-height: calc(18px * var(--ui-font-scale, 1)); font-weight: 500; }
.thread-running { flex-shrink: 0; width: 7px; height: 7px; border-radius: var(--radius-round); background: var(--accent); }
.thread-row.can-archive:hover .archive-button, .thread-row.can-archive:focus-within .archive-button { opacity: 1; }
.archive-button:disabled { opacity: 0; pointer-events: none; }
.project-show-more { display: flex; align-items: center; gap: 6px; min-height: 30px; padding: 5px 9px 5px 32px; border-radius: var(--radius-sm); color: var(--muted); font-size: calc(12px * var(--ui-font-scale, 1)); line-height: calc(20px * var(--ui-font-scale, 1)); text-align: left; }
.project-show-more:hover { background: var(--nav-hover, var(--hover)); color: var(--ink); }
.project-show-more > svg { display: none; }
.remaining-count { font-variant-numeric: tabular-nums; }
.project-empty { padding: 16px 8px; color: var(--muted); font-size: calc(13px * var(--ui-font-scale, 1)); }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
@media (hover: none), (pointer: coarse) {
  .project-toggle, .project-show-more, .thread-row > .thread-select { min-height: 44px; }
  .project-toggle, .thread-row.can-archive > .thread-select, .thread-row.can-archive:hover > .thread-select, .thread-row.can-archive:focus-within > .thread-select { padding-right: 46px; }
  .project-new, .archive-button { width: 40px; height: 40px; opacity: 1; }
  .archive-button:disabled { opacity: 0; }
  .project-caret { opacity: 1; }
  .project-folder { opacity: 0; }
}
@media (prefers-reduced-motion: reduce) { .project-header, .thread-row, .project-caret, .project-folder, .project-new, .archive-button { transition: none; } }
</style>
