<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { MessageContent } from '../../shared/protocol'
import { useMediaSource } from '../composables/useMediaSource'
import { PhImage } from '@phosphor-icons/vue'
import ImagePreview from './ImagePreview.vue'
const props = defineProps<{ src: string; name: string; source?: MessageContent }>()
const { source: resolved, loading, error, retry, failed } = useMediaSource(computed(() => ({ src: props.src || props.source?.path || '', fileId: props.source?.fileId, kind: 'image' as const })))
let suppressFocus = false
const trigger = ref<HTMLButtonElement>(), open = ref(false), pinned = ref(false), anchor = ref<DOMRect>()
watch(resolved, () => { open.value = false; pinned.value = false })
function show(pin = false) { if (!resolved.value) { retry(); return }; anchor.value = trigger.value?.getBoundingClientRect(); pinned.value = pin; open.value = true }
function close() { const restore = pinned.value; open.value = false; pinned.value = false; if (restore) { suppressFocus = true; trigger.value?.focus(); queueMicrotask(() => { suppressFocus = false }) } }
</script>
<template>
  <button ref="trigger" class="inline-image" type="button" :aria-label="'预览图片 ' + name" :title="resolved ? name : loading ? '正在加载图片…' : error" @pointerenter="($event.pointerType === 'mouse') && show()" @pointerleave="!pinned && (open = false)" @focus="!suppressFocus && show()" @blur="!pinned && (open = false)" @click="show(true)"><img v-if="resolved" :src="resolved" alt="" @error="failed" /><PhImage v-else :size="20" /><span>{{ name }}</span></button><span v-if="error && !resolved" class="inline-media-error" role="status">{{ error }}</span><ImagePreview :open="open" :src="resolved" :name="name" :anchor="anchor" :pinned="pinned" @close="close" />
</template>

<style scoped>
.inline-media-error { color: var(--muted); font-size: .8em; overflow-wrap: anywhere; }
</style>
