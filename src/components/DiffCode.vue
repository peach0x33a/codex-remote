<script setup lang="ts">
import { computed } from 'vue'
import { diffLines, splitDiffLines } from '../lib/diff-view'
const props = withDefaults(defineProps<{ diff: string; path: string; split?: boolean; wrap?: boolean; query?: string }>(), { split: false, wrap: false, query: '' })
const lines = computed(() => diffLines(props.diff))
const pairs = computed(() => splitDiffLines(lines.value))
const matches = (text: string) => !!props.query && text.toLowerCase().includes(props.query.toLowerCase())
</script>
<template>
  <div class="diff-code" :class="{ 'diff-wrap': wrap, 'diff-split': split }" tabindex="0" role="region" :aria-label="`${path} 差异内容`">
    <div v-if="split" class="diff-code-lines"><div v-for="(pair, index) in pairs" :key="index" class="diff-pair">
      <code v-if="pair.meta" class="diff-line meta" :class="{ 'diff-match': matches(pair.meta.text) }">{{ pair.meta.text }}</code>
      <template v-else><div v-for="side in (['left', 'right'] as const)" :key="side" class="diff-line" :class="[pair[side]?.kind, { 'diff-match': matches(pair[side]?.text || '') }]"><span class="diff-number" aria-hidden="true">{{ side === 'left' ? pair.left?.old : pair.right?.next }}</span><code>{{ pair[side]?.text }}</code></div></template>
    </div></div>
    <div v-else class="diff-code-lines"><div v-for="(line, index) in lines" :key="index" class="diff-line" :class="[line.kind, { 'diff-match': matches(line.text) }]"><span class="diff-number" aria-hidden="true">{{ line.old }}</span><span class="diff-number" aria-hidden="true">{{ line.next }}</span><code>{{ line.text }}</code></div></div>
  </div>
</template>
<style scoped>
.diff-code { min-width: 0; overflow: auto; font: var(--code-font-size, 13px)/1.75 var(--code-font-family, ui-monospace, monospace); tab-size: 2; overscroll-behavior: contain; }
.diff-code-lines { min-width: 100%; width: max-content; }
.diff-line { display: flex; min-height: 21px; min-width: 0; padding-right: 16px; color: var(--ink-soft); border-left: 3px solid transparent; }
.diff-line code { white-space: pre; font: inherit; padding: 0 10px; }
.diff-number { width: 40px; flex: 0 0 40px; text-align: right; color: var(--muted); user-select: none; }
.diff-line.added { background: var(--diff-added-bg); border-left-color: var(--diff-added); }
.diff-line.removed { background: var(--diff-removed-bg); border-left-color: var(--diff-removed); }
.diff-line.meta { color: var(--muted); background: var(--hover); white-space: pre; }
.diff-pair { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
.diff-pair > .meta { grid-column: 1 / -1; padding-left: 12px; }
.diff-pair > .diff-line + .diff-line { border-left-width: 1px; border-left-color: var(--line); }
.diff-split .diff-code-lines { width: 100%; }
.diff-split .diff-line { overflow-x: auto; }
.diff-wrap .diff-code-lines { width: 100%; }
.diff-wrap .diff-line code { white-space: pre-wrap; overflow-wrap: anywhere; min-width: 0; }
.diff-line.diff-match { box-shadow: inset 0 0 0 1px var(--accent); }
.diff-code:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
</style>
