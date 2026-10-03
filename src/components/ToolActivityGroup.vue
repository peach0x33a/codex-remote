<script setup lang="ts">
import { computed, ref } from 'vue'
import { PhX, PhCode, PhFileText, PhGlobe, PhImage, PhTerminal } from '@phosphor-icons/vue'
import type { Item } from '../../shared/protocol'
import { documentActivityTitle, readFilePaths, summarizeToolActivity } from '../lib/tool-activity'
import MessageItem from './MessageItem.vue'
import type { FileLinkTarget } from '../lib/file-links'
import { vAnimatedDetails } from '../lib/details-motion'

const props = defineProps<{ items: Item[]; now?: number; documentSummary?: boolean }>()
const emit = defineEmits<{ openFile: [target: FileLinkTarget] }>()
const expanded = ref(false)
const summary = computed(() => { const result = summarizeToolActivity(props.items); return props.documentSummary ? { ...result, title: documentActivityTitle(props.items), kind: 'read' as const } : result })
const flatReads = computed(() => !props.documentSummary && summary.value.kind === 'read')
const paths = computed(() => flatReads.value ? readFilePaths(props.items) : [])
</script>

<template>
  <details v-animated-details="(open: boolean) => expanded = open" class="activity tool-activity-group" :open="expanded" @toggle="expanded = ($event.target as HTMLDetailsElement).open">
    <summary>
      <PhFileText v-if="summary.kind === 'read' || items[0]?.type === 'fileChange'" :size="16" />
      <PhTerminal v-else-if="summary.kind" :size="16" />
      <PhGlobe v-else-if="items[0]?.type === 'webSearch'" :size="16" />
      <PhImage v-else-if="items[0]?.type === 'imageView'" :size="16" />
      <PhCode v-else :size="16" />
      <span class="activity-group-title">{{ summary.title }}</span>
      <span v-if="summary.failed" class="activity-state failed" :title="summary.failedCount + ' 项失败'"><PhX :size="13" aria-hidden="true" />失败</span>
    </summary>
    <div v-if="expanded" class="tool-activity-items">
      <ul v-if="flatReads" class="activity-read-list" aria-label="读取的文件"><li v-for="path in paths" :key="path">{{ path }}</li></ul>
      <MessageItem v-for="item in items" :key="item.id" :item="item" :now="now" :read-details-only="flatReads" @open-file="emit('openFile', $event)" />
    </div>
  </details>
</template>

<style scoped>
.tool-activity-group > summary { max-width: 100%; }
.activity-group-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.activity-state { flex-shrink: 0; }
.tool-activity-items { padding-left: 18px; }
.activity-read-list { display: grid; gap: var(--space-2); list-style: none; margin: var(--space-2) 0 var(--space-3); padding: 0; color: var(--muted); font-family: var(--code-font-family); font-size: calc(13px * var(--ui-font-scale, 1)); line-height: 1.5; overflow-wrap: anywhere; }
.tool-activity-items :deep(.activity) { margin: 2px 0 4px; }
@media (max-width: 640px) {
  .tool-activity-group > summary { flex-wrap: wrap; }
  .activity-group-title { flex: 1; }
  .activity-state { flex-shrink: 1; }
}
</style>
