<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { PhPaperclip, PhX } from '@phosphor-icons/vue'
import PromptEditor from './PromptEditor.vue'
import { hasPrompt, type PromptPart } from '../lib/prompt'
import type { AttachmentReader } from '../lib/file-attachments'
const props = defineProps<{ parts: PromptPart[]; saving: boolean; readAttachments: AttachmentReader; error?: string }>()
const emit = defineEmits<{ save: [parts: PromptPart[]]; cancel: [] }>()
const draft = ref<PromptPart[]>(props.parts.map(part => ({ ...part }))), localError = ref(''), reading = ref(false)
const editor = ref<InstanceType<typeof PromptEditor>>(), input = ref<HTMLInputElement>()
let uploadController: AbortController | undefined
onBeforeUnmount(() => uploadController?.abort())
async function attach(files: File[]) {
  if (reading.value || props.saving || !files.length) return
  const controller = new AbortController(), insertion = editor.value?.reserveInsertion()
  uploadController = controller; reading.value = true; localError.value = ''
  try { const parts = await props.readAttachments(files, draft.value, undefined, controller.signal); if (!controller.signal.aborted) parts.forEach((part, index) => editor.value?.insertAttachment(part, index === 0 ? insertion : undefined)) }
  catch (cause) { if (!controller.signal.aborted) localError.value = cause instanceof Error ? cause.message : '附件读取失败' }
  finally { reading.value = false; if (input.value) input.value.value = '' }
}
function save() { if (!props.saving && !reading.value && hasPrompt(draft.value)) emit('save', draft.value) }
</script>
<template>
  <form class="message-revision-editor" @submit.prevent="save"><PromptEditor ref="editor" v-model="draft" label="编辑消息内容" :disabled="saving" @files="attach" @keydown="($event.key === 'Enter' && ($event.ctrlKey || $event.metaKey) && !$event.isComposing) && ($event.preventDefault(), save())" /><p class="revision-impact">保存后会从这条消息重新生成回复，替换此处及后续对话。已执行的文件修改不会还原。</p><p v-if="error || localError" class="revision-error" role="alert">{{ error || localError }}</p><div class="revision-actions"><button type="button" class="icon-button" aria-label="添加编辑消息附件" :disabled="saving || reading" @click="input?.click()"><PhPaperclip :size="18" /></button><input ref="input" class="sr-only" type="file" tabindex="-1" multiple @change="attach([...(input?.files || [])])" /><span class="spacer" /><button type="button" class="button secondary" :disabled="saving" @click="emit('cancel')"><PhX :size="14" />取消</button><button type="submit" class="button primary" :disabled="saving || reading || !hasPrompt(draft)">{{ saving ? '正在更新…' : '保存并重新发送' }}</button></div></form>
</template>
<style scoped>
.message-revision-editor { width: min(100%, 860px); margin: 0 0 28px auto; border: 1px solid var(--line-strong); border-radius: var(--radius-lg); padding: 8px 10px; background: var(--surface, var(--canvas)); }
.revision-impact { font-size: calc(12px * var(--ui-font-scale, 1)); line-height: 1.7; color: var(--muted); padding: 6px 10px 10px; }
.revision-error { color: var(--danger); padding: 6px 10px; font-size: calc(13px * var(--ui-font-scale, 1)); }
.revision-actions { display: flex; align-items: center; gap: 8px; }.revision-actions .button { min-height: 34px; padding: 6px 12px; font-size: calc(13px * var(--ui-font-scale, 1)); }
</style>
