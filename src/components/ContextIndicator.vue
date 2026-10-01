<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import { PhCopy } from '@phosphor-icons/vue'
import ComposerPopover from './ComposerPopover.vue'
import { formatTokenCount as short } from '../lib/format-tokens'
import type { ThreadTokenUsage } from '../../shared/protocol'
const props = defineProps<{ usage?: ThreadTokenUsage; sessionId?: string }>()
const emit = defineEmits<{ copy: [text: string] }>()
const sessionFieldId = useId()
const popover = ref<InstanceType<typeof ComposerPopover>>()
function copySessionId() { if (props.sessionId) emit('copy', props.sessionId) }
defineExpose({ show: () => popover.value?.show() })
const used = computed(() => props.usage?.last.totalTokens)
const maximum = computed(() => props.usage?.modelContextWindow || undefined)
const ratio = computed(() => used.value !== undefined && maximum.value ? used.value / maximum.value : undefined)
const color = computed(() => ratio.value === undefined ? 'var(--subtle)' : ratio.value >= 1 ? 'var(--danger)' : ratio.value >= .85 ? 'var(--warn)' : 'var(--accent)')
const percentage = computed(() => ratio.value === undefined ? '暂无数据' : (ratio.value * 100).toFixed(1) + '%')
const format = (value?: number) => value === undefined ? '—' : new Intl.NumberFormat('zh-CN').format(value)
const rows = computed(() => props.usage ? [
  { name: '输入', value: props.usage.last.inputTokens },
  { name: '缓存命中', value: props.usage.last.cachedInputTokens, detail: '已包含在输入中' },
  ...(props.usage.last.cacheWriteInputTokens ? [{ name: '缓存写入', value: props.usage.last.cacheWriteInputTokens, detail: '已包含在输入中' }] : []),
  { name: '输出', value: props.usage.last.outputTokens },
  { name: '推理输出', value: props.usage.last.reasoningOutputTokens, detail: '已包含在输出中' },
] : [])
</script>
<template>
  <ComposerPopover ref="popover" label="上下文用量" trigger-class="context-trigger" align="end" :width="320" hover>
    <template #trigger><svg class="context-ring" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="var(--line-strong)" stroke-width="3" /><circle v-if="ratio !== undefined" cx="12" cy="12" r="8.5" fill="none" :stroke="color" stroke-width="3" stroke-linecap="round" stroke-dasharray="53.407" :stroke-dashoffset="53.407 * (1 - Math.min(1, Math.max(0, ratio)))" transform="rotate(-90 12 12)" /></svg><span class="sr-only">{{ percentage }}</span></template>
    <div class="context-panel"><div class="context-heading"><strong>上下文容量</strong><span :title="format(used) + ' / ' + format(maximum) + ' tokens'">{{ short(used) }} / {{ short(maximum) }}<template v-if="ratio !== undefined">（{{ percentage }}）</template></span></div><div class="context-meter" :role="ratio !== undefined ? 'progressbar' : undefined" :aria-valuenow="ratio !== undefined ? Math.min(100, ratio * 100) : undefined" aria-valuemin="0" aria-valuemax="100" aria-label="上下文使用比例"><span :style="{ width: (Math.min(1, ratio || 0) * 100) + '%', background: color }" /></div><template v-if="usage"><dl class="context-details"><div v-for="row in rows" :key="row.name"><dt>{{ row.name }}<small v-if="row.detail">{{ row.detail }}</small></dt><dd :title="format(row.value)">{{ short(row.value) }}</dd></div></dl><div class="context-total"><span>会话累计 token</span><span :title="format(usage.total.totalTokens)">{{ short(usage.total.totalTokens) }}</span></div><p class="context-note">容量按最近一次请求估算。服务端未提供系统工具、技能等占比。</p></template><p v-else class="context-note">服务端尚未发送用量，生成过程中会自动更新。</p>
      <div class="context-session">
        <div class="context-session-heading"><label :for="sessionFieldId">Session ID</label><button type="button" class="text-button context-session-copy" :disabled="!sessionId" aria-label="复制 Session ID" title="复制 Session ID" @click="copySessionId"><PhCopy :size="16" /><span>复制</span></button></div>
        <textarea v-if="sessionId" :id="sessionFieldId" :value="sessionId" class="context-session-id" aria-label="Session ID" readonly rows="2" spellcheck="false" />
        <p v-else class="context-session-empty">会话创建后显示。</p>
      </div>
    </div>
  </ComposerPopover>
</template>

<style scoped>
.context-session { margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--line-soft); }
.context-session-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; font-size: calc(12px * var(--ui-font-scale, 1)); color: var(--muted); }
.context-session-copy { display: inline-flex; align-items: center; gap: 5px; padding: 4px 6px; }
.context-session-id { display: block; width: 100%; min-width: 0; resize: none; padding: 7px 9px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--canvas); color: var(--ink); font-family: var(--code-font-family); font-size: calc(12px * var(--ui-font-scale, 1)); line-height: 1.5; overflow-wrap: anywhere; user-select: text; cursor: text; }
.context-session-empty { margin: 0; color: var(--subtle); font-size: calc(12px * var(--ui-font-scale, 1)); }
</style>
