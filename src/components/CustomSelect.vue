<script setup lang="ts" generic="T extends string">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import { PhCaretDown, PhCheck } from '@phosphor-icons/vue'
const props = defineProps<{ modelValue: T; options: { value: T; label: string; disabled?: boolean }[]; label: string; placeholder?: string; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: T] }>()
const id = useId(), root = ref<HTMLElement>(), trigger = ref<HTMLButtonElement>(), panel = ref<HTMLElement>()
const open = ref(false), above = ref(false)
const selectedLabel = computed(() => props.options.find(option => option.value === props.modelValue)?.label || props.placeholder || props.modelValue)
let prefix = '', prefixTimer: ReturnType<typeof setTimeout> | undefined
const choices = () => [...(panel.value?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)') || [])]
function close(restoreFocus = false) { open.value = false; prefix = ''; clearTimeout(prefixTimer); if (restoreFocus) trigger.value?.focus() }
async function show() {
  if (props.disabled) return
  document.dispatchEvent(new CustomEvent('composer-popover-open', { detail: id }))
  open.value = true
  await nextTick()
  const rect = trigger.value?.getBoundingClientRect()
  above.value = !!rect && window.innerHeight - rect.bottom < (panel.value?.offsetHeight || 160) + 12 && rect.top > 180
  ;(panel.value?.querySelector<HTMLButtonElement>('[aria-selected="true"]:not(:disabled)') || choices()[0])?.focus()
}
function select(value: T) { emit('update:modelValue', value); close(true) }
function outside(event: Event) { if (!root.value?.contains(event.target as Node)) close() }
function other(event: Event) { if ((event as CustomEvent).detail !== id) close() }
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return }
  const items = choices(), index = items.indexOf(document.activeElement as HTMLButtonElement)
  if (!items.length) return
  const target: Record<string, number> = { ArrowDown: (index + 1) % items.length, ArrowUp: (index - 1 + items.length) % items.length, Home: 0, End: items.length - 1 }
  if (event.key in target) { event.preventDefault(); items[target[event.key]]?.focus() }
  else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && !event.isComposing && event.key !== ' ') {
    prefix += event.key.toLocaleLowerCase(); clearTimeout(prefixTimer)
    items.find(item => item.textContent?.trim().toLocaleLowerCase().startsWith(prefix))?.focus()
    prefixTimer = setTimeout(() => { prefix = '' }, 600)
  }
}
function listen(add: boolean) {
  const method = add ? 'addEventListener' : 'removeEventListener'
  document[method]('pointerdown', outside); document[method]('focusin', outside); document[method]('composer-popover-open', other)
}
watch(open, listen, { flush: 'sync' })
watch(() => props.disabled, value => { if (value) close() })
onBeforeUnmount(() => { listen(false); clearTimeout(prefixTimer) })
</script>

<template>
  <div ref="root" class="custom-select">
    <button ref="trigger" type="button" class="custom-select-trigger" :aria-label="label" aria-haspopup="listbox" :aria-expanded="open" :aria-controls="open ? id : undefined" :disabled="disabled" @click="open ? close(true) : show()" @keydown.down.prevent="show" @keydown.up.prevent="show">
      <span>{{ selectedLabel }}</span><PhCaretDown :size="14" aria-hidden="true" />
    </button>
    <Transition name="select-menu">
      <div v-if="open" :id="id" ref="panel" class="custom-select-menu" :class="{ 'is-above': above }" role="listbox" :aria-label="label" @keydown="keydown">
        <button v-for="option in options" :key="option.value" type="button" role="option" :aria-selected="option.value === modelValue" :disabled="option.disabled" tabindex="-1" @click="select(option.value)"><span>{{ option.label }}</span><PhCheck v-if="option.value === modelValue" :size="16" aria-hidden="true" /></button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.custom-select { position: relative; }
.custom-select-trigger { display: inline-flex; align-items: center; justify-content: space-between; gap: 18px; min-height: 44px; min-width: 100px; padding: 0 12px; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); color: var(--ink); }
.custom-select-trigger:hover:not(:disabled), .custom-select-trigger[aria-expanded="true"] { background: var(--hover); }
.custom-select-trigger:focus-visible, .custom-select-menu button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.custom-select-menu { position: absolute; z-index: 10; top: calc(100% + 6px); right: 0; min-width: max(160px, 100%); max-width: calc(100vw - 48px); padding: 6px; border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--surface); color: var(--ink); box-shadow: 0 10px 32px #0002; transform-origin: top right; }
.custom-select-menu.is-above { top: auto; bottom: calc(100% + 6px); transform-origin: bottom right; }
.custom-select-menu button { display: flex; align-items: center; justify-content: space-between; gap: 16px; width: 100%; min-height: 40px; padding: 8px 12px; border-radius: var(--radius-sm); text-align: left; }
.custom-select-menu button:hover:not(:disabled), .custom-select-menu button:focus-visible { background: var(--hover); }
.custom-select-menu button[aria-selected="true"] { color: var(--accent); }
.select-menu-enter-active, .select-menu-leave-active { transition: opacity 140ms var(--ease), transform 140ms var(--ease); }
.select-menu-enter-from, .select-menu-leave-to { opacity: 0; transform: translateY(-3px); }
@media (prefers-reduced-motion: reduce) { .select-menu-enter-active, .select-menu-leave-active { transition: none; } }
</style>
