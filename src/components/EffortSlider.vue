<script setup lang="ts">
import { computed, ref } from 'vue'
export type EffortOption = { value: string; label: string; description?: string }
const props = defineProps<{ modelValue: string; options: EffortOption[]; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: string]; done: [] }>()
const dragging = ref(false), dragPosition = ref<number | null>(null)
const last = computed(() => Math.max(0, props.options.length - 1))
const index = computed(() => Math.max(0, props.options.findIndex(o => o.value === props.modelValue)))
const position = computed(() => dragPosition.value ?? index.value)
const maxed = computed(() => last.value > 0 && index.value === last.value)
const stars = Array.from({ length: 18 }, (_, i) => ({ x: 6 + (i * 37 % 86), y: 20 + (i * 23 % 58), size: 1.4 + i % 3 * .4, delay: i * .13 }))
function select(value: number) { const option = props.options[Math.max(0, Math.min(last.value, Math.round(value)))]; if (option && option.value !== props.modelValue) emit('update:modelValue', option.value) }
function change(event: Event) {
  const value = Number((event.target as HTMLInputElement).value)
  if (dragging.value) dragPosition.value = value
  select(value)
}
function start(event: PointerEvent) {
  if (props.disabled || !last.value) return
  dragging.value = true; dragPosition.value = index.value
  ;(event.currentTarget as HTMLInputElement).setPointerCapture(event.pointerId)
}
function finish() { dragging.value = false; dragPosition.value = null }
function keydown(event: KeyboardEvent) {
  const targets: Record<string, number> = { ArrowLeft: index.value - 1, ArrowDown: index.value - 1, ArrowRight: index.value + 1, ArrowUp: index.value + 1, Home: 0, End: last.value, PageDown: index.value - 1, PageUp: index.value + 1 }
  if (event.key in targets) { event.preventDefault(); finish(); select(targets[event.key]!) }
}
</script>
<template>
  <div class="effort" :class="{ maxed }">
    <div class="effort-track" :class="{ dragging }" :style="{ '--p': last ? position / last : 0 }">
      <div class="effort-fill" />
      <div class="effort-stars" aria-hidden="true"><i v-for="(s, k) in stars" :key="k" :style="{ left: s.x + '%', top: s.y + '%', '--s': s.size + 'px', '--d': s.delay + 's', '--t': '2.8s' }" /></div>
      <span v-for="i in Math.max(0, last - 1)" :key="i" class="effort-stop" :class="{ reached: i <= index }" :style="{ '--at': i / last }" aria-hidden="true" />
      <span class="effort-thumb-rail" aria-hidden="true"><span class="effort-thumb" /></span>
      <input class="effort-input" data-initial-focus type="range" min="0" :max="last" step="0.001" :value="position" :aria-valuenow="index" :disabled="disabled || !last" aria-label="思考强度" :aria-valuetext="options[index]?.label" @input="change" @pointerdown="start" @pointerup="finish" @pointercancel="finish" @lostpointercapture="finish" @blur="finish" @keydown="keydown" @keydown.enter.prevent="$emit('done')" />
    </div>
    <div class="effort-scale" aria-hidden="true"><span>{{ options[0]?.label }}</span><span>{{ options[last]?.label }}</span></div>
  </div>
</template>
