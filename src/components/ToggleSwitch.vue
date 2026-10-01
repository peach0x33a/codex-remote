<script setup lang="ts">
const props = defineProps<{ modelValue: boolean; label: string; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
</script>
<template>
  <button type="button" class="toggle-switch" role="switch" :aria-label="label" :aria-checked="modelValue" :disabled="disabled" @click="!props.disabled && emit('update:modelValue', !modelValue)"><span class="switch-track" aria-hidden="true" /><span class="switch-thumb" aria-hidden="true" /></button>
</template>
<style scoped>
.toggle-switch { appearance: none; -webkit-appearance: none; display: block; position: relative; flex: 0 0 44px; width: 44px; height: 44px; padding: 0; border: 0; border-radius: var(--radius-sm); background: transparent; }
.switch-track { position: absolute; top: 11px; left: 3px; width: 38px; height: 22px; border-radius: var(--radius-round); background: var(--muted); transition: background-color 160ms var(--ease); pointer-events: none; }
.switch-thumb { position: absolute; top: 14px; left: 6px; width: 16px; height: 16px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px #0003; transform: translateX(0); transition: transform 160ms var(--ease); pointer-events: none; }
.toggle-switch[aria-checked="true"] .switch-track { background: var(--accent); }
.toggle-switch[aria-checked="true"] .switch-thumb { transform: translateX(16px); }
.toggle-switch:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { .switch-track, .switch-thumb { transition: none; } }
@media (forced-colors: active) { .switch-track { forced-color-adjust: none; background: Canvas; border: 1px solid ButtonText; } .switch-thumb { forced-color-adjust: none; background: ButtonText; box-shadow: none; } .toggle-switch[aria-checked="true"] .switch-track { background: Highlight; } .toggle-switch[aria-checked="true"] .switch-thumb { background: HighlightText; } }
</style>
