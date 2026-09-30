<script setup lang="ts">
// Select-only combobox styled after ChatGPT desktop's model switcher and thinking menu.
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import { PhCaretDown, PhCheck } from '@phosphor-icons/vue'
export type PickerOption = { value: string; label: string; description?: string }
const props = withDefaults(defineProps<{ modelValue: string; options: PickerOption[]; label: string; heading?: string; disabled?: boolean; placement?: 'top' | 'bottom'; variant?: 'title' | 'pill' | 'ghost' }>(), { placement: 'bottom', variant: 'pill' })
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const open = ref(false), highlighted = ref(-1)
const root = ref<HTMLElement>(), trigger = ref<HTMLButtonElement>(), list = ref<HTMLElement>()
const listId = useId()
const selectedIndex = computed(() => props.options.findIndex(o => o.value === props.modelValue))
function show() { if (props.disabled || !props.options.length) return; open.value = true; highlighted.value = Math.max(0, selectedIndex.value) }
function hide(focus = true) { open.value = false; if (focus) trigger.value?.focus() }
function choose(index: number) { const option = props.options[index]; if (option) emit('update:modelValue', option.value); hide() }
function onKey(event: KeyboardEvent) {
  const count = props.options.length
  if (!open.value) { if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) { event.preventDefault(); show() } return }
  const moves: Record<string, number> = { ArrowDown: (highlighted.value + 1) % count, ArrowUp: (highlighted.value - 1 + count) % count, Home: 0, End: count - 1 }
  if (event.key in moves) { event.preventDefault(); highlighted.value = moves[event.key] }
  else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(highlighted.value) }
  else if (event.key === 'Escape') { event.preventDefault(); hide() }
  else if (event.key === 'Tab') hide(false)
}
function onOutside(event: PointerEvent) { if (!root.value?.contains(event.target as Node)) hide(false) }
watch(open, value => value ? document.addEventListener('pointerdown', onOutside) : document.removeEventListener('pointerdown', onOutside))
watch(highlighted, async index => { await nextTick(); list.value?.children[index]?.scrollIntoView({ block: 'nearest' }) })
watch(() => props.disabled, disabled => { if (disabled) open.value = false })
onBeforeUnmount(() => document.removeEventListener('pointerdown', onOutside))
</script>

<template>
  <div ref="root" class="picker" :class="['picker-' + variant, { open }]">
    <button ref="trigger" type="button" class="picker-trigger" role="combobox" :aria-label="label" aria-haspopup="listbox" :aria-expanded="open" :aria-controls="open ? listId : undefined" :aria-activedescendant="open && highlighted >= 0 ? listId + '-' + highlighted : undefined" :disabled="disabled" @click="open ? hide() : show()" @keydown="onKey"><slot /><PhCaretDown class="picker-caret" :size="variant === 'title' ? 15 : 13" weight="bold" /></button>
    <Transition name="picker-pop">
      <div v-if="open" class="picker-menu" :class="'picker-' + placement" @pointerdown.prevent>
        <div v-if="heading" class="picker-heading">{{ heading }}</div>
        <ul :id="listId" ref="list" role="listbox" :aria-label="label">
          <li v-for="(option, index) in options" :id="listId + '-' + index" :key="option.value" role="option" :aria-selected="option.value === modelValue" class="picker-option" :class="{ highlighted: index === highlighted }" @pointermove="highlighted = index" @click="choose(index)"><span class="picker-text"><span class="picker-label">{{ option.label }}</span><span v-if="option.description" class="picker-description">{{ option.description }}</span></span><PhCheck v-if="option.value === modelValue" class="picker-check" :size="16" weight="bold" /></li>
        </ul>
      </div>
    </Transition>
  </div>
</template>
