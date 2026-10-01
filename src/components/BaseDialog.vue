<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import { PhX } from '@phosphor-icons/vue'
const props = withDefaults(defineProps<{ open: boolean; title: string; description?: string; wide?: boolean; dismissible?: boolean }>(), { dismissible: true })
const emit = defineEmits<{ close: [] }>()
const element = ref<HTMLDialogElement>()
const titleId = useId()
watch(() => props.open, async open => {
  await nextTick()
  if (open && !element.value?.open) element.value?.showModal()
  else if (!open && element.value?.open) element.value?.close()
}, { immediate: true })
onBeforeUnmount(() => element.value?.close())
function dismiss() { if (props.dismissible) emit('close') }
// Native modal dialogs let Tab escape to the browser chrome; wrap focus at both ends instead.
function wrapFocus(event: KeyboardEvent) {
  if (event.key !== 'Tab' || !element.value) return
  const focusable = [...element.value.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(node => !node.hasAttribute('disabled') && node.getClientRects().length > 0)
  const first = focusable[0], last = focusable.at(-1)
  if (!first || !last) return
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}
</script>

<template>
  <dialog ref="element" class="dialog" :class="{ 'dialog-wide': wide }" :aria-labelledby="titleId" @cancel.prevent="dismiss" @keydown="wrapFocus" @click="($event.target === element) && dismiss()">
    <div class="dialog-inner">
      <header class="dialog-header">
        <div><h2 :id="titleId">{{ title }}</h2><p v-if="description">{{ description }}</p></div>
        <button v-if="dismissible" class="icon-button" aria-label="关闭窗口" @click="dismiss"><PhX :size="20" /></button>
      </header>
      <slot />
    </div>
  </dialog>
</template>
