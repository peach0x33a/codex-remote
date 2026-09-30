<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { PhArrowUUpLeft, PhCaretDown, PhGitDiff } from '@phosphor-icons/vue'
import FileTypeIcon from './FileTypeIcon.vue'
import type { ChangedFile } from '../lib/thread-insights'

const props = withDefaults(defineProps<{ files: ChangedFile[]; disabled?: boolean; undoDisabled?: boolean; undoHint?: string; undone?: boolean; undoing?: boolean }>(), { disabled: false, undoDisabled: true })
const emit = defineEmits<{ view: [path?: string]; undo: [] }>()
const id = useId(), showAll = ref(false)
const visibleFiles = computed(() => showAll.value ? props.files : props.files.slice(0, 3))
const number = new Intl.NumberFormat('zh-CN')
const count = (value: number | undefined): value is number => value !== undefined && Number.isSafeInteger(value) && value >= 0
const totals = computed(() => {
  let added = 0, removed = 0
  for (const file of props.files) {
    if (!count(file.added) || !count(file.removed)) return null
    added += file.added
    removed += file.removed
  }
  return count(added) && count(removed) ? { added, removed } : null
})
const hasDiff = computed(() => props.files.some(file => !!file.diff))
function show(path?: string) { if (!props.disabled) emit('view', path) }
defineExpose({ show })
watch(() => props.files.map(file => file.path), paths => {
  if (paths.length <= 3) showAll.value = false
})
</script>

<template>
  <section v-if="files.length" class="file-change-summary" :aria-labelledby="`${id}-title`" tabindex="-1">
    <header class="changes-heading">
      <span class="changes-emblem" aria-hidden="true"><PhGitDiff :size="23" /></span>
      <div class="changes-title"><h3 :id="`${id}-title`">{{ undone ? '已撤销' : '已编辑' }} {{ files.length }} 个文件</h3><span v-if="totals" class="changes-counts changes-total"><span class="added" :aria-label="`共新增 ${totals.added} 行`">+{{ number.format(totals.added) }}</span><span class="removed" :aria-label="`共删除 ${totals.removed} 行`">−{{ number.format(totals.removed) }}</span></span></div>
      <div class="changes-actions"><button type="button" class="text-button" :disabled="disabled || undoDisabled || undoing" :title="undoHint" @click="emit('undo')">{{ undoing ? '处理中…' : undone ? '重新应用' : '撤销' }}<PhArrowUUpLeft :size="15" aria-hidden="true" /></button><button v-if="hasDiff" type="button" class="text-button changes-toggle" :disabled="disabled" @click="show()">查看变更</button></div>
    </header>
    <TransitionGroup :id="`${id}-files`" name="expand-list" tag="ul" class="changes-list">
      <li v-for="file in visibleFiles" :key="file.path" class="changes-file motion-list-row" :inert="!visibleFiles.some(visible => visible.path === file.path)"><div class="motion-list-inner">
        <button type="button" class="changes-row" :title="file.path" :disabled="disabled" :aria-label="`查看 ${file.path} 的变更`" @click="show(file.path)">
          <FileTypeIcon :path="file.path" :size="16" />
          <span class="changes-path">{{ file.path }}</span>
          <span v-if="count(file.added) || count(file.removed)" class="changes-counts"><span v-if="count(file.added)" class="added" :aria-label="`新增 ${file.added} 行`">+{{ number.format(file.added) }}</span><span v-if="count(file.removed)" class="removed" :aria-label="`删除 ${file.removed} 行`">−{{ number.format(file.removed) }}</span></span>
        </button>
      </div></li>
    </TransitionGroup>
    <button v-if="files.length > 3" type="button" class="text-button changes-more" :aria-expanded="showAll" :aria-controls="`${id}-files`" :disabled="disabled" @click="showAll = !showAll">{{ showAll ? '收起' : `查看更多（${files.length - 3}）` }}<PhCaretDown :size="13" :class="{ reversed: showAll }" aria-hidden="true" /></button>
  </section>
</template>

<style scoped>
.file-change-summary { min-width: 0; margin: 16px 0 16px 44px; padding: 10px 8px; border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--surface); color: var(--ink-soft); }
.file-change-summary:focus { outline: none; }
.changes-heading { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; padding: 0 8px; margin-bottom: 4px; }
.changes-title { display: flex; flex: 1; flex-direction: column; gap: 2px; min-width: 0; }
.changes-emblem { display: grid; place-items: center; width: 42px; height: 42px; flex-shrink: 0; border-radius: var(--radius-sm); background: var(--hover); color: var(--ink-soft); }
.changes-actions { display: flex; align-items: center; gap: 4px; margin-left: auto; }
.changes-toggle { border: 1px solid var(--line); }
.changes-heading h3 { margin: 0; font-size: 13px; font-weight: 500; line-height: 22px; }
.file-change-summary .text-button { min-height: 30px; padding: 4px 8px; border-radius: var(--radius-sm); color: var(--muted); font-size: 12px; }
.file-change-summary .text-button:hover:not(:disabled) { background: var(--hover); color: var(--ink-soft); }
.changes-list { list-style: none; padding: 0; margin: 0; }
.changes-file { min-width: 0; }
.changes-row { display: flex; align-items: center; gap: 8px; min-width: 0; width: 100%; min-height: 32px; padding: 6px 8px; border-radius: var(--radius-sm); text-align: left; color: var(--ink-soft); font-size: 12px; line-height: 20px; }
.changes-row:hover:not(:disabled) { background: var(--hover); }
.changes-row:active:not(:disabled) { background: var(--active); }
.changes-row > svg { color: var(--muted); }
.changes-path { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.changes-kind { flex-shrink: 0; max-width: 25%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: 11px; }
.changes-counts { display: flex; flex-shrink: 0; gap: 4px; font-size: 12px; font-variant-numeric: tabular-nums; }
.added { color: var(--diff-added); }
.removed { color: var(--diff-removed); }
.changes-diff { min-width: 0; padding: 4px 8px 12px; }
.changes-diff pre { max-height: min(42dvh, 420px); margin: 0; padding: 8px 0; border: 0; border-radius: 0; background: transparent; color: var(--ink-soft); font-size: 12px; line-height: 1.7; white-space: pre; tab-size: 2; overflow: auto; overscroll-behavior: contain; }
.changes-more { margin-top: 4px; }
.changes-toggle svg, .changes-more svg { transition: transform 180ms var(--ease); }
.reversed { transform: rotate(180deg); }
.file-change-summary button:focus-visible, .changes-diff pre:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
@media (max-width: 760px) { .file-change-summary { margin-left: 38px; } }
@media (max-width: 760px), (hover: none), (pointer: coarse) {
  .changes-row, .file-change-summary .text-button { min-height: 44px; }
  .changes-heading { padding-inline: 4px; }
  .changes-diff { padding-inline: 4px; }
}
</style>
