<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { PhCheck, PhListNumbers, PhPause, PhPencilSimple, PhPlay, PhTrash, PhX } from '@phosphor-icons/vue'
import PromptEditor from './PromptEditor.vue'
import InlineFile from './InlineFile.vue'
import InlineImage from './InlineImage.vue'
import AudioContent from './AudioContent.vue'
import type { QueuedMessage } from '../composables/useCodex'
import { hasPrompt, type PromptPart } from '../lib/prompt'
import type { AttachmentReader } from '../lib/file-attachments'
const props = defineProps<{ messages: QueuedMessage[]; paused: boolean; disabled?: boolean; serverManaged?: boolean; working?: boolean; readAttachments: AttachmentReader; save: (id: string, parts: PromptPart[]) => Promise<boolean> }>()
const emit = defineEmits<{ remove: [id: string]; restore: [parts: PromptPart[]]; resume: []; pause: []; editing: [active: boolean]; openFile: [target: { path: string }] }>()
const editing = ref(''), draft = ref<PromptPart[]>([]), error = ref(''), reading = ref(false), saving = ref(false), editingJob = ref<QueuedMessage>()
const missing = computed(() => !!editing.value && !props.messages.some(job => job.id === editing.value))
const displayed = computed(() => missing.value && editingJob.value ? [...props.messages, editingJob.value] : props.messages)
const editor = ref<InstanceType<typeof PromptEditor>>()
let uploadController: AbortController | undefined
watch(editing, value => { uploadController?.abort(); emit('editing', !!value) }, { flush: 'sync' })
onBeforeUnmount(() => { uploadController?.abort(); if (editing.value && hasPrompt(draft.value)) emit('restore', draft.value.map(part => ({ ...part }))); emit('editing', false) })
function setEditor(instance: unknown) { editor.value = instance as InstanceType<typeof PromptEditor> | undefined }
function edit(job: QueuedMessage) { if (saving.value || props.disabled) return; editingJob.value = job; editing.value = job.id; draft.value = job.parts.map(part => ({ ...part })); error.value = '' }
async function save() {
  if (saving.value || reading.value || props.disabled || missing.value || !hasPrompt(draft.value)) return
  saving.value = true
  try { if (await props.save(editing.value, draft.value)) editing.value = ''; else error.value = '保存失败，修改内容已保留。' }
  catch { error.value = '保存失败，修改内容已保留。' }
  finally { saving.value = false }
}
function restore() { emit('restore', draft.value.map(part => ({ ...part }))); editing.value = '' }
async function attach(files: File[]) {
  if (reading.value || saving.value || props.disabled) return
  const id = editing.value, insertion = editor.value?.reserveInsertion(), controller = new AbortController()
  uploadController = controller; reading.value = true; error.value = ''
  try { const parts = await props.readAttachments(files, draft.value, undefined, controller.signal); if (id === editing.value && !controller.signal.aborted) parts.forEach((part, index) => editor.value?.insertAttachment(part, index === 0 ? insertion : undefined)) }
  catch (cause) { if (id === editing.value && !controller.signal.aborted) error.value = cause instanceof Error ? cause.message : String(cause) }
  finally { reading.value = false }
}
</script>
<template>
  <section v-if="messages.length || editing" class="queue-pane" aria-label="消息队列">
    <div class="queue-heading"><span><PhListNumbers :size="16" />待发送 {{ messages.length }}<small>{{ serverManaged ? '服务端队列' : paused ? '本页队列 · 已暂停' : '本页队列' }}</small></span><button v-if="!serverManaged || !working" class="icon-button small" type="button" :aria-label="serverManaged ? '开始下一条队列消息' : paused ? '继续队列' : '暂停队列'" :disabled="disabled" @click="serverManaged || paused ? emit('resume') : emit('pause')"><PhPlay v-if="serverManaged || paused" :size="16" /><PhPause v-else :size="16" /></button></div>
    <TransitionGroup name="queue-row" tag="ol" class="queue-list"><li v-for="job in displayed" :key="job.id" class="queue-item" :data-queue-id="job.id">
      <template v-if="editing === job.id"><div class="queue-editor"><PromptEditor :ref="setEditor" :disabled="saving || disabled" v-model="draft" @files="attach" @keydown="($event.key === 'Enter' && !$event.shiftKey && !$event.isComposing) && ($event.preventDefault(), save())" /><p v-if="missing || error" class="attachment-error">{{ missing ? '消息已发送或在其他端移除，修改草稿仍保留。' : error }}</p><div class="queue-edit-actions"><button type="button" class="text-button" :disabled="saving" @click="editing = ''"><PhX :size="14" />取消</button><button v-if="missing" type="button" class="text-button accent" @click="restore">放回输入框</button><button v-else type="button" class="text-button accent" :disabled="disabled || saving || reading || !hasPrompt(draft)" @click="save"><PhCheck :size="14" />保存修改</button></div></div></template>
      <template v-else><div class="queue-text"><span class="queue-parts" :class="{ 'has-attachments': job.parts.some(part => part.type === 'file' || part.type === 'image') }"><template v-for="(part, index) in job.parts" :key="index"><span v-if="part.type === 'text'">{{ part.text }}</span><InlineFile v-else-if="part.type === 'file'" :file="part" @open="emit('openFile', { path: $event })" /><AudioContent v-else-if="part.type === 'audio'" :src="part.url || part.source?.path || ''" :name="part.name" /><InlineImage v-else-if="part.type === 'image'" :src="part.url" :name="part.name" :source="part.source" /><span v-else class="inline-skill" :title="part.path">{{ part.type === 'skill' ? '$' : '@' }}{{ part.name }}</span></template></span><small v-if="job.state === 'sending'">正在发送…</small><small v-if="job.error" role="alert">{{ job.error }}</small></div><button type="button" class="icon-button small" aria-label="编辑排队消息" :title="job.editError" :disabled="disabled || saving || !!job.editError || job.state === 'sending'" @click="edit(job)"><PhPencilSimple :size="15" /></button><button type="button" class="icon-button small" aria-label="移除排队消息" :disabled="disabled || saving || job.state === 'sending'" @click="emit('remove', job.id)"><PhTrash :size="15" /></button></template>
    </li></TransitionGroup>
  </section>
</template>
