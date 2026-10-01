<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from 'vue'
import { normalizeSliderValue } from '../lib/slider'
const props = withDefaults(defineProps<{ modelValue: number; min: number; max: number; step?: number; label: string; unit?: string; disabled?: boolean }>(), { step: 1, unit: '' })
const emit = defineEmits<{ 'update:modelValue': [value: number]; preview: [value: number | null] }>()
const id = useId(), dragging = ref(false), hover = ref<number>(), keyboardFocus = ref(false), editing = ref(false), draft = ref('')
const pointerMoved = ref(false)
let pointerStartX = 0
const fixed = computed(() => props.max <= props.min)
const current = computed(() => normalizeSliderValue(props.modelValue, props.min, props.max, props.step) ?? props.min)
const preview = computed(() => dragging.value ? current.value : hover.value ?? current.value)
const percent = (value: number) => fixed.value ? 0 : Math.max(0, Math.min(100, (value - props.min) / (props.max - props.min) * 100))
watch(current, value => { if (!editing.value) draft.value = String(value) }, { immediate: true })
function clearPreview() { if (hover.value !== undefined) { hover.value = undefined; emit('preview', null) } }
function set(value: number | string) { const next = normalizeSliderValue(value, props.min, props.max, props.step); clearPreview(); if (next !== undefined && !props.disabled && next !== current.value) emit('update:modelValue', next) }
function input(event: Event) { set((event.target as HTMLInputElement).value) }
function point(event: PointerEvent) {
  if (dragging.value) { if (Math.abs(event.clientX - pointerStartX) > 2) pointerMoved.value = true; return }
  if (event.pointerType === 'touch' || props.disabled || fixed.value || editing.value) return
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left - 9) / Math.max(1, rect.width - 18)))
  const value = normalizeSliderValue(props.min + ratio * (props.max - props.min), props.min, props.max, props.step)
  if (value !== undefined && hover.value !== value) { hover.value = value; emit('preview', value) }
}
function start(event: PointerEvent) {
  if (props.disabled || fixed.value) return
  clearPreview(); dragging.value = true; pointerMoved.value = false; pointerStartX = event.clientX; keyboardFocus.value = false
  const target = event.currentTarget as HTMLInputElement
  target.focus({ preventScroll: true }); target.setPointerCapture(event.pointerId)
}
function finish() { dragging.value = false; pointerMoved.value = false; clearPreview() }
function commit() {
  if (props.disabled || !editing.value) return
  const next = normalizeSliderValue(draft.value, props.min, props.max, props.step)
  if (next !== undefined) set(next)
  editing.value = false; draft.value = String(next ?? current.value)
}
function cancel() { editing.value = false; draft.value = String(current.value) }
function edit(event: FocusEvent) { clearPreview(); editing.value = true; (event.target as HTMLInputElement).select() }
watch(() => [props.disabled, props.min, props.max, props.step], finish)
onBeforeUnmount(clearPreview)
</script>
<template>
  <div class="value-slider" :class="{ 'is-disabled': disabled, 'is-pressed': dragging, 'is-dragging': dragging && pointerMoved }">
    <label :for="id">{{ label }}</label>
    <div class="value-slider-row">
      <div class="value-slider-rail" :style="{ '--progress': percent(current) / 100, '--preview': percent(preview) + '%', '--preview-progress': percent(preview) / 100 }" @pointerenter="point" @pointermove="point" @pointerleave="clearPreview">
        <span class="value-slider-track" aria-hidden="true"><span class="value-slider-fill" /></span>
        <span class="value-slider-thumb" aria-hidden="true" />
        <span v-if="!disabled && (hover !== undefined || keyboardFocus || dragging)" class="value-slider-tooltip" aria-hidden="true">{{ preview }}{{ unit }}</span>
        <span v-if="hover !== undefined && !dragging && !disabled" class="value-slider-preview-marker" aria-hidden="true" />
        <input :id="id" class="value-slider-input" type="range" :min="min" :max="max" :step="step" :value="current" :aria-label="label" :aria-valuenow="current" :aria-valuetext="current + unit" :disabled="disabled || fixed" @input="input" @pointerdown="start" @pointerup="finish" @pointercancel="finish" @lostpointercapture="finish" @focus="keyboardFocus = ($event.target as HTMLInputElement).matches(':focus-visible')" @blur="keyboardFocus = false; finish()" />
      </div>
      <div class="value-slider-field"><input :value="draft" type="text" inputmode="decimal" :aria-label="label + '数值'" :disabled="disabled || fixed" @input="draft = ($event.target as HTMLInputElement).value" @focus="edit" @blur="commit" @keydown.enter.stop.prevent="commit" @keydown.esc.stop.prevent="cancel" /><span v-if="unit" aria-hidden="true">{{ unit }}</span></div>
    </div>
  </div>
</template>
<style scoped>
.value-slider { min-width: 0; }
.value-slider > label { display: block; margin-bottom: 10px; color: var(--muted); font-size: calc(12px * var(--ui-font-scale, 1)); }
.value-slider-row { display: flex; align-items: center; gap: 12px; min-height: 44px; }
.value-slider-rail { position: relative; flex: 1; min-width: 0; }
.value-slider-track { position: absolute; top: 50%; left: 9px; right: 9px; height: 6px; transform: translateY(-50%); border-radius: var(--radius-round); background: var(--track); overflow: hidden; pointer-events: none; }
.value-slider-fill { display: block; width: 100%; height: 100%; background: var(--accent); border-radius: inherit; transform: scaleX(var(--progress)); transform-origin: left; transition: transform 180ms var(--ease); }
.value-slider-thumb { position: absolute; top: 50%; left: calc(9px + (100% - 18px) * var(--progress)); box-sizing: border-box; width: 18px; height: 18px; border: 2px solid var(--accent); border-radius: var(--radius-round); background: var(--surface); box-shadow: 0 2px 4px #0002; transform: translate(-50%, -50%) scale(1); pointer-events: none; transition: left 180ms var(--ease), transform 140ms var(--ease), box-shadow 140ms var(--ease); }
.value-slider:not(.is-disabled) .value-slider-rail:hover .value-slider-thumb, .value-slider-rail:has(.value-slider-input:focus-visible) .value-slider-thumb { transform: translate(-50%, -50%) scale(1.1); box-shadow: 0 3px 7px #0003; }
.value-slider.is-pressed:not(.is-disabled) .value-slider-rail .value-slider-thumb { transform: translate(-50%, -50%) scale(.9); }
.value-slider.is-dragging .value-slider-thumb { transition: transform 140ms var(--ease), box-shadow 140ms var(--ease); }
.value-slider.is-dragging .value-slider-fill { transition: none; }
.value-slider-input { display: block; appearance: none; width: 100%; height: 36px; padding: 0; margin: 0; background: transparent; border: 0; border-radius: var(--radius-sm); cursor: pointer; touch-action: none; }
.value-slider-input::-webkit-slider-runnable-track { height: 6px; border-radius: var(--radius-round); background: transparent; }
.value-slider-input::-moz-range-track { height: 6px; border-radius: var(--radius-round); background: transparent; }
.value-slider-input::-moz-range-progress { background: transparent; }
.value-slider-input::-webkit-slider-thumb { appearance: none; box-sizing: border-box; width: 18px; height: 18px; margin-top: -6px; border: 0; background: transparent; }
.value-slider-input::-moz-range-thumb { box-sizing: border-box; width: 18px; height: 18px; border: 0; background: transparent; }
.value-slider-input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.value-slider-preview-marker { position: absolute; z-index: 1; top: 50%; left: calc(9px + (100% - 18px) * var(--preview-progress)); width: 12px; height: 12px; transform: translate(-50%, -50%); border: 2px solid var(--ink-soft); border-radius: var(--radius-round); background: var(--surface); opacity: .65; pointer-events: none; }
.value-slider-tooltip { position: absolute; z-index: 2; bottom: calc(100% - 2px); left: clamp(24px, var(--preview), calc(100% - 24px)); transform: translateX(-50%); padding: 3px 7px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface); color: var(--ink); box-shadow: 0 3px 10px #0002; font-size: calc(12px * var(--ui-font-scale, 1)); line-height: calc(18px * var(--ui-font-scale, 1)); font-variant-numeric: tabular-nums; white-space: nowrap; pointer-events: none; }
.value-slider-field { display: flex; align-items: center; flex: 0 0 88px; min-width: 0; height: 34px; border: 1px solid transparent; border-radius: var(--radius-sm); background: transparent; transition: background-color 120ms var(--ease), border-color 120ms var(--ease); }
.value-slider:not(.is-disabled):hover .value-slider-field, .value-slider:focus-within .value-slider-field, .value-slider.is-dragging .value-slider-field { border-color: var(--line); background: var(--surface); }
.value-slider-field:focus-within { border-color: var(--accent); outline: 2px solid var(--accent-soft); }
.value-slider-field input { width: 100%; min-width: 0; height: 32px; padding: 4px 7px; border: 0; background: transparent; color: var(--ink-soft); font-size: calc(13px * var(--ui-font-scale, 1)); text-align: right; font-variant-numeric: tabular-nums; }
.value-slider-field input:focus-visible { outline: none; }
.value-slider-field > span { padding-right: 7px; color: var(--muted); font-size: calc(12px * var(--ui-font-scale, 1)); }
.value-slider-tooltip { animation: slider-tooltip-in 120ms var(--ease); transition: left 90ms linear; }
.value-slider-preview-marker { animation: slider-marker-in 120ms var(--ease); transition: left 90ms linear; }
.value-slider.is-pressed .value-slider-tooltip { transition: none; }
@keyframes slider-tooltip-in { from { opacity: 0; transform: translate(-50%, 3px); } to { opacity: 1; transform: translate(-50%, 0); } }
@keyframes slider-marker-in { from { opacity: 0; transform: translate(-50%, -50%) scale(.65); } to { opacity: .65; transform: translate(-50%, -50%) scale(1); } }
.is-disabled { opacity: .55; }
@media (pointer: coarse) { .value-slider-input { height: 44px; } .value-slider-field { height: 44px; } .value-slider-field input { height: 42px; } }
@media (prefers-reduced-motion: reduce) { .value-slider .value-slider-fill, .value-slider .value-slider-thumb, .value-slider.is-dragging .value-slider-thumb, .value-slider .value-slider-tooltip, .value-slider .value-slider-preview-marker, .value-slider-field { transition: none; animation: none; } }
</style>
