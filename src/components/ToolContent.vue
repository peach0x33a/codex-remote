<script setup lang="ts">
import type { Item } from '../../shared/protocol'
import { toolContent } from '../lib/tool-content'
import { codeBlockFromEvent } from '../lib/markdown-code'
import { fileLinkFromEvent } from '../lib/file-links'
import { parseFileLink } from '../lib/file-links'
import MarkdownContent from './MarkdownContent.vue'
import MarkdownImage from './MarkdownImage.vue'
import AudioContent from './AudioContent.vue'
defineProps<{ item: Item }>()
const emit = defineEmits<{ openFile: [target: { path: string }]; copy: [text: string] }>()
function onMarkdownClick(event: MouseEvent) { const code = codeBlockFromEvent(event); if (code !== null) { emit('copy', code); return }; const target = fileLinkFromEvent(event); if (target) emit('openFile', target) }
const safeWeb = (url: string) => /^https?:\/\//i.test(url)
</script>
<template>
  <div class="tool-content"><template v-for="(part, index) in toolContent(item)" :key="index"><MarkdownContent v-if="part.type === 'text'" :text="part.text" @click="onMarkdownClick" /><MarkdownImage v-else-if="part.type === 'image'" :src="part.src" :name="part.name" :file-id="part.fileId" /><AudioContent v-else-if="part.type === 'audio'" :src="part.src" :name="part.name" /><template v-else-if="part.type === 'link'"><a v-if="safeWeb(part.url)" :href="part.url" target="_blank" rel="noopener noreferrer">{{ part.name }}</a><button v-else-if="parseFileLink(part.url)" type="button" class="text-button" @click="emit('openFile', parseFileLink(part.url)!)">{{ part.name }}</button><span v-else>{{ part.name }}：{{ part.url }}</span></template><pre v-else><code>{{ JSON.stringify(part.value, null, 2) }}</code></pre></template><details><summary>原始工具结果</summary><pre><code>{{ JSON.stringify(item.result ?? item.output ?? item.contentItems ?? item, null, 2) }}</code></pre></details></div>
</template>
<style scoped>
.tool-content { display: grid; gap: var(--space-3); min-width: 0; padding-left: 14px; }
summary { color: var(--muted); font-size: .875em; }
</style>
