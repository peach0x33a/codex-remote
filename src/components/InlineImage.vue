<script setup lang="ts">
import { ref } from 'vue'
import { PhImage } from '@phosphor-icons/vue'
import ImagePreview from './ImagePreview.vue'
const props = defineProps<{ src: string; name: string }>()
let suppressFocus = false
const trigger = ref<HTMLButtonElement>(), open = ref(false), pinned = ref(false), anchor = ref<DOMRect>()
function show(pin = false) { if (!props.src) return; anchor.value = trigger.value?.getBoundingClientRect(); pinned.value = pin; open.value = true }
function close() { const restore = pinned.value; open.value = false; pinned.value = false; if (restore) { suppressFocus = true; trigger.value?.focus(); queueMicrotask(() => { suppressFocus = false }) } }
</script>
<template>
  <button ref="trigger" class="inline-image" type="button" :aria-label="'预览图片 ' + name" :title="src ? name : name + '（远端图片暂不可预览）'" @pointerenter="($event.pointerType === 'mouse') && show()" @pointerleave="!pinned && (open = false)" @focus="!suppressFocus && show()" @blur="!pinned && (open = false)" @click="show(true)"><img v-if="src" :src="src" alt="" /><PhImage v-else :size="20" /><span>{{ name }}</span></button><ImagePreview :open="open" :src="src" :name="name" :anchor="anchor" :pinned="pinned" @close="close" />
</template>
