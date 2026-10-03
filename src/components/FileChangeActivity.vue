<script setup lang="ts">
import { computed, ref } from 'vue'
import { PhGitDiff, PhX } from '@phosphor-icons/vue'
import type { Item } from '../../shared/protocol'
import { fileChangeViews } from '../lib/file-change-view'
import { toolActivityState, toolActivityError } from '../lib/tool-activity'
import { vAnimatedDetails } from '../lib/details-motion'
import FileTypeIcon from './FileTypeIcon.vue'
import DiffCode from './DiffCode.vue'
import type { FileLinkTarget } from '../lib/file-links'
const props = defineProps<{ item: Item }>()
const emit = defineEmits<{ openFile: [target: FileLinkTarget] }>()
const expanded = ref(false), files = computed(() => fileChangeViews(props.item))
const state = computed(() => toolActivityState(props.item)), error = computed(() => toolActivityError(props.item))
const title = computed(() => (state.value.completed ? '已变更 ' : state.value.running ? '正在变更 ' : '变更 ') + files.value.length + ' 个文件')
const totals = computed(() => files.value.length && files.value.every(file => file.counts) ? files.value.reduce((sum, file) => ({ added: sum.added + file.counts!.added, removed: sum.removed + file.counts!.removed }), { added: 0, removed: 0 }) : null)
</script>
<template>
  <details v-animated-details="(open: boolean) => expanded = open" class="activity tool-activity file-change-activity" :open="expanded" @toggle="expanded = ($event.target as HTMLDetailsElement).open">
    <summary><PhGitDiff :size="16" /><span>{{ title }}</span><span v-if="totals" class="file-change-counts"><span class="added">+{{ totals.added }}</span><span class="removed">−{{ totals.removed }}</span></span><span v-if="state.failed" class="activity-state failed"><PhX :size="13" />失败</span></summary>
    <div v-if="expanded" class="file-change-cards">
      <section v-for="(file, index) in files" :key="file.path + '/' + index" class="file-change-card" :aria-label="file.path + ' 的文件变更'">
        <header><FileTypeIcon :path="file.path" :size="16" /><button type="button" class="file-change-name" :title="file.path" @click="emit('openFile', { path: file.movePath || file.path })">{{ file.name }}</button><span class="file-change-kind">{{ file.label }}</span><span v-if="file.counts" class="file-change-counts"><span class="added" :aria-label="'新增 ' + file.counts.added + ' 行'">+{{ file.counts.added }}</span><span class="removed" :aria-label="'删除 ' + file.counts.removed + ' 行'">−{{ file.counts.removed }}</span></span></header>
        <p class="file-change-path">{{ file.path }}<template v-if="file.movePath"> → {{ file.movePath }}</template></p>
        <DiffCode v-if="file.structured && file.diff" :diff="file.diff" :path="file.path" />
        <template v-else-if="file.raw"><p class="file-change-note">以下为原始变更内容，未识别为完整差异。</p><pre><code>{{ file.raw }}</code></pre></template>
        <p v-else class="file-change-note">{{ file.label }}文件，无文本差异。</p>
      </section>
      <pre v-if="!files.length"><code>{{ JSON.stringify(item, null, 2) }}</code></pre>
      <p v-if="error" class="inline-error" role="alert">{{ error }}</p>
    </div>
  </details>
</template>
<style scoped>
.file-change-cards { display: grid; gap: 12px; padding-top: 8px; }
.file-change-card { min-width: 0; overflow: hidden; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); }
.file-change-card header { display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 8px 12px; }
.file-change-name { flex: 1; min-width: 0; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink); font-size: calc(13px * var(--ui-font-scale, 1)); }
.file-change-name:hover { text-decoration: underline; }
.file-change-name:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.file-change-kind { flex-shrink: 0; color: var(--muted); font-size: calc(12px * var(--ui-font-scale, 1)); }
.file-change-counts { display: inline-flex; flex-shrink: 0; align-items: center; gap: 6px; font-variant-numeric: tabular-nums; font-size: calc(12px * var(--ui-font-scale, 1)); }
.added { color: var(--diff-added); }.removed { color: var(--diff-removed); }
.file-change-path, .file-change-note { margin: 0; padding: 0 12px 8px; color: var(--muted); font-size: calc(12px * var(--ui-font-scale, 1)); line-height: 1.6; overflow-wrap: anywhere; }
.file-change-card :deep(.diff-code) { border-top: 1px solid var(--line); max-height: min(50dvh, 520px); }
.file-change-card pre { margin: 0; border-radius: 0; max-height: min(50dvh, 520px); }
@media (pointer: coarse) { .file-change-card header { min-height: 44px; }.file-change-name { min-height: 28px; } }
</style>
