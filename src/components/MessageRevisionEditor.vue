<script setup lang="ts">
import { ref } from 'vue'
import { PhPaperclip, PhX } from '@phosphor-icons/vue'
import PromptEditor from './PromptEditor.vue'
import { hasPrompt, readImages, type PromptPart } from '../lib/prompt'
const props = defineProps<{ parts: PromptPart[]; saving: boolean; error?: string }>()
const emit = defineEmits<{ save: [parts: PromptPart[]]; cancel: [] }>()
const draft = ref<PromptPart[]>(props.parts.map(part => ({ ...part }))), localError = ref(''), reading = ref(false)
const editor = ref<InstanceType<typeof PromptEditor>>(), input = ref<HTMLInputElement>()
async function attach(files: File[]) { if (reading.value || props.saving) return; reading.value = true; localError.value = ''; const insertion = editor.value?.reserveInsertion(); try { const images = await readImages(files, draft.value); images.forEach((image, index) => editor.value?.insertImage(image, index === 0 ? insertion : undefined)) } catch (error) { localError.value = error instanceof Error ? error.message : '图片读取失败' } finally { reading.value = false; if (input.value) input.value.value = '' } }
function save() { if (!props.saving && !reading.value && hasPrompt(draft.value)) emit('save', draft.value) }
</script>
<template>
  <form class="message-revision-editor" @submit.prevent="save"><PromptEditor ref="editor" v-model="draft" label="编辑消息内容" :disabled="saving" @files="attach" @keydown="($event.key === 'Enter' && ($event.ctrlKey || $event.metaKey) && !$event.isComposing) && ($event.preventDefault(), save())" /><p class="revision-impact">保存后会从这条消息重新生成回复，替换此处及后续对话。已执行的文件修改不会还原。</p><p v-if="error || localError" class="revision-error" role="alert">{{ error || localError }}</p><div class="revision-actions"><button type="button" class="icon-button" aria-label="添加编辑消息图片" :disabled="saving || reading" @click="input?.click()"><PhPaperclip :size="18" /></button><input ref="input" class="sr-only" type="file" tabindex="-1" accept="image/png,image/jpeg,image/webp,image/gif" multiple @change="attach([...(input?.files || [])])" /><span class="spacer" /><button type="button" class="button secondary" :disabled="saving" @click="emit('cancel')"><PhX :size="14" />取消</button><button type="submit" class="button primary" :disabled="saving || reading || !hasPrompt(draft)">{{ saving ? '正在更新…' : '保存并重新发送' }}</button></div></form>
</template>
<style scoped>
.message-revision-editor { width: min(100%, 860px); margin: 0 0 28px auto; border: 1px solid var(--line-strong); border-radius: var(--radius-lg); padding: 8px 10px; background: var(--surface, var(--canvas)); }
.revision-impact { font-size: 12px; line-height: 1.7; color: var(--muted); padding: 6px 10px 10px; }
.revision-error { color: var(--danger); padding: 6px 10px; font-size: 13px; }
.revision-actions { display: flex; align-items: center; gap: 8px; }.revision-actions .button { min-height: 34px; padding: 6px 12px; font-size: 13px; }
</style>
