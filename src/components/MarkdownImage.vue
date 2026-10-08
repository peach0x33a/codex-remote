<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import ImagePreview from './ImagePreview.vue'
import { useMediaSource } from '../composables/useMediaSource'
const props = defineProps<{ src: string; name: string; cwd?: string; fileId?: string }>()
const { source, loading, error, retry, failed } = useMediaSource(computed(() => ({ src: props.src, kind: 'image' as const, cwd: props.cwd, fileId: props.fileId })))
const open = ref(false), trigger = ref<HTMLButtonElement>()
watch(source, () => { open.value = false })
function close() { open.value = false; trigger.value?.focus({ preventScroll: true }) }
</script>
<template>
  <span class="markdown-image">
    <button v-if="source" ref="trigger" type="button" class="markdown-image-trigger" :aria-label="'放大图片 ' + name" @click.prevent.stop="open = true"><img :src="source" :alt="name" loading="lazy" decoding="async" referrerpolicy="no-referrer" @error="failed" /></button>
    <span v-else-if="loading" class="markdown-image-status" role="status">正在加载图片：{{ name }}…</span>
    <span v-else class="markdown-image-status"><span role="status">{{ name }}：{{ error }}</span> <button type="button" class="text-button" @click.prevent.stop="retry">重试</button></span>
    <ImagePreview :open="open" :src="source" :name="name" pinned @close="close" />
  </span>
</template>
<style scoped>
.markdown-image { display: inline-block; max-width: 100%; vertical-align: middle; }
.markdown-image-trigger { display: block; padding: 0; max-width: 100%; border-radius: var(--radius-md); overflow: hidden; cursor: zoom-in; }
.markdown-image-trigger img { display: block; max-width: 100%; max-height: 60dvh; width: auto; height: auto; object-fit: contain; }
.markdown-image-trigger:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
.markdown-image-status { color: var(--muted); font-size: .875em; overflow-wrap: anywhere; }
</style>
