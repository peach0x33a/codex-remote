<script setup lang="ts">
import { computed } from 'vue'
import { useMediaSource } from '../composables/useMediaSource'
const props = defineProps<{ src: string; name?: string; cwd?: string }>()
const { source, loading, error, retry, failed } = useMediaSource(computed(() => ({ src: props.src, kind: 'audio' as const, cwd: props.cwd })))
</script>
<template>
  <span class="audio-content"><span v-if="name" class="audio-name">{{ name }}</span><audio v-if="source" :src="source" controls preload="metadata" :aria-label="name || '音频'" @error="failed" /><span v-else role="status">{{ loading ? '正在加载音频…' : error }} <button v-if="!loading" type="button" class="text-button" @click.prevent.stop="retry">重试</button></span></span>
</template>
<style scoped>
.audio-content { display: inline-flex; flex-direction: column; gap: var(--space-1); width: min(100%, 360px); vertical-align: middle; font-size: .875em; }
audio { display: block; width: 100%; max-width: 100%; }
.audio-name { color: var(--muted); overflow-wrap: anywhere; }
</style>
