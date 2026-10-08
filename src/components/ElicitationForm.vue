<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { elicitationContent, elicitationFields } from '../lib/elicitation'
import type { Approval } from '../../shared/protocol'
import type { ApprovalDraft } from '../lib/approvals'
const props = defineProps<{ approval: Approval; disabled?: boolean; draft?: ApprovalDraft }>()
const emit = defineEmits<{ respond: [result: unknown] }>()
const own = ref<Record<string, unknown>>(Object.create(null)), error = ref(''), id = useId()
const values = computed(() => props.draft ? props.draft.elicitation ||= Object.create(null) : own.value)
const model = computed(() => { try { return { fields: elicitationFields(props.approval.params.requestedSchema), error: '' } } catch (cause) { return { fields: [], error: cause instanceof Error ? cause.message : '表单结构无效。' } } })
const mode = computed(() => props.approval.params.mode || 'form')
const url = computed(() => { try { const url = new URL(String(props.approval.params.url || '')); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : '' } catch { return '' } })
watch(() => props.approval.id, () => { error.value = ''; for (const field of model.value.fields) if (!Object.hasOwn(values.value, field.key) && (field.default !== undefined || field.type === 'array')) values.value[field.key] = field.default ?? [] }, { immediate: true })
watch(values, () => { error.value = '' }, { deep: true })
function respond(action: 'accept' | 'decline' | 'cancel') {
  if (props.disabled) return
  if (action !== 'accept') { emit('respond', { action, content: null, _meta: null }); return }
  try {
    if (mode.value === 'url') { if (!url.value) return; emit('respond', { action, content: null, _meta: null }) }
    else if (!model.value.error && ['form', 'openai/form', 'openaiForm'].includes(String(mode.value))) emit('respond', { action, content: elicitationContent(model.value.fields, values.value), _meta: null })
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '请检查填写内容。' }
}
</script>
<template>
  <form class="elicitation-form" @submit.prevent="respond('accept')"><p v-if="approval.params.serverName" class="field-hint">{{ approval.params.serverName }}</p><p>{{ approval.params.message || approval.params.description || '工具需要你提供信息。' }}</p>
    <template v-if="mode === 'url'"><a v-if="url" :href="url" target="_blank" rel="noopener noreferrer" class="elicitation-url">打开授权页面：{{ url }}</a><p v-else role="alert">授权网址无效，无法打开。</p><p v-if="url" class="field-hint">在新页面完成后，返回这里点击“已完成”。</p></template>
    <p v-else-if="!['form', 'openai/form', 'openaiForm'].includes(String(mode))" role="alert">此请求需要设备验证，当前浏览器无法完成。可以拒绝或取消。</p>
    <p v-else-if="model.error" role="alert">{{ model.error }}</p>
    <div v-else class="elicitation-fields"><label v-for="field in model.fields" :key="field.key" :for="id + field.key"><span>{{ field.title }}{{ field.required ? ' *' : '' }}</span><small v-if="field.description">{{ field.description }}</small>
      <select v-if="field.type === 'boolean'" :id="id + field.key" v-model="values[field.key]" :disabled="disabled"><option value="">请选择</option><option :value="true">是</option><option :value="false">否</option></select>
      <select v-else-if="field.options" :id="id + field.key" v-model="values[field.key]" :multiple="field.type === 'array'" :disabled="disabled"><option v-if="field.type !== 'array'" value="">请选择</option><option v-for="option in field.options" :key="option.value" :value="option.value">{{ option.label }}</option></select>
      <input v-else :id="id + field.key" v-model="values[field.key]" :type="field.type === 'number' || field.type === 'integer' ? 'number' : field.format === 'email' ? 'email' : field.format === 'date' ? 'date' : 'text'" :step="field.type === 'integer' ? 1 : 'any'" :min="field.minimum" :max="field.maximum" :minlength="field.minLength" :maxlength="field.maxLength ?? 16384" :disabled="disabled" autocomplete="off" />
    </label></div><p v-if="error" class="elicitation-error" role="alert">{{ error }}</p><div class="approval-actions"><button type="button" class="button secondary" :disabled="disabled" @click="respond('cancel')">取消</button><button type="button" class="button secondary" :disabled="disabled" @click="respond('decline')">拒绝</button><button type="submit" class="button primary" :disabled="disabled || (mode === 'url' ? !url : !!model.error || !['form', 'openai/form', 'openaiForm'].includes(String(mode)))">{{ mode === 'url' ? '已完成' : '提交' }}</button></div>
  </form>
</template>
<style scoped>
.elicitation-fields { display: grid; gap: var(--space-3); }
.elicitation-fields label { display: grid; gap: var(--space-1); min-width: 0; }
small { color: var(--muted); }
input, select { width: 100%; min-height: 44px; padding: 8px 12px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--canvas); color: var(--ink); font: inherit; }
select[multiple] { min-height: 96px; }
.elicitation-url { overflow-wrap: anywhere; }
.elicitation-error { color: var(--danger); }
.approval-actions { position: sticky; bottom: 0; z-index: 1; padding-top: var(--space-2); background: var(--island, var(--sidebar)); }
</style>
