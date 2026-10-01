<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { PhX } from '@phosphor-icons/vue'
const props = defineProps<{ open: boolean; src: string; name: string; anchor?: DOMRect; pinned?: boolean }>()
const emit = defineEmits<{ close: [] }>()
const panel = ref<HTMLElement>()
const position = ref({ left: '12px', top: '12px' })
const style = computed(() => props.pinned ? undefined : position.value)
function place() {
  const box = panel.value, anchor = props.anchor
  if (!box || !anchor || props.pinned) return
  const vw = window.visualViewport?.width || window.innerWidth, vh = window.visualViewport?.height || window.innerHeight
  position.value = { left: Math.max(12, Math.min(anchor.left, vw - box.offsetWidth - 12)) + 'px', top: Math.max(12, Math.min(anchor.top - box.offsetHeight - 10 >= 12 ? anchor.top - box.offsetHeight - 10 : anchor.bottom + 10, vh - box.offsetHeight - 12)) + 'px' }
}
function key(event: KeyboardEvent) { if (props.pinned && event.key === 'Tab') { event.preventDefault(); panel.value?.querySelector<HTMLButtonElement>('button')?.focus(); return }; if (event.key === 'Escape') { event.stopPropagation(); emit('close') } }
watch(() => [props.open, props.pinned], async ([value]) => { if (value) { await nextTick(); place(); if (props.pinned) panel.value?.focus(); document.addEventListener('keydown', key) } else document.removeEventListener('keydown', key) })
onBeforeUnmount(() => document.removeEventListener('keydown', key))
</script>
<template>
  <Teleport to="body"><Transition name="image-preview" @before-leave="($event as Element).setAttribute('inert', '')" @leave-cancelled="($event as Element).removeAttribute('inert')"><div v-if="open && src" class="image-preview-layer" :class="{ pinned }" @click.self="emit('close')"><div ref="panel" class="image-preview-panel" :style="style" :role="pinned ? 'dialog' : 'tooltip'" :aria-label="name" :aria-modal="pinned || undefined" tabindex="-1"><button v-if="pinned" class="icon-button image-preview-close" type="button" aria-label="关闭图片预览" @click="emit('close')"><PhX :size="20" /></button><img :src="src" :alt="name" @load="place" /><span>{{ name }}</span></div></div></Transition></Teleport>
</template>
<style scoped>
.image-preview-enter-active, .image-preview-leave-active { transition: opacity 160ms var(--ease); }
.image-preview-enter-active .image-preview-panel, .image-preview-leave-active .image-preview-panel { transition: transform 160ms var(--ease); transform-origin: bottom left; }
.image-preview-enter-from, .image-preview-leave-to { opacity: 0; }
.image-preview-enter-from .image-preview-panel, .image-preview-leave-to .image-preview-panel { transform: translateY(5px) scale(.97); }
.image-preview-layer.image-preview-leave-active { pointer-events: none; }
.pinned.image-preview-enter-active .image-preview-panel, .pinned.image-preview-leave-active .image-preview-panel { transform-origin: center; }
@media (prefers-reduced-motion: reduce) { .image-preview-enter-active, .image-preview-leave-active, .image-preview-enter-active .image-preview-panel, .image-preview-leave-active .image-preview-panel { transition: none; } }
</style>
