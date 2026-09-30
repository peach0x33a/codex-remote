<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
const props = withDefaults(defineProps<{ label: string; disabled?: boolean; hover?: boolean; width?: number; align?: 'start' | 'end'; placement?: 'top' | 'bottom'; triggerClass?: string; panelClass?: string; teleportTo?: string | HTMLElement }>(), { width: 320, align: 'start', placement: 'top', teleportTo: 'body' })
const emit = defineEmits<{ change: [open: boolean] }>()
const open = ref(false), trigger = ref<HTMLButtonElement>(), panel = ref<HTMLElement>()
const position = ref({ left: '0px', top: '0px', visibility: 'hidden' as 'hidden' | 'visible' })
const id = useId()
let observer: ResizeObserver | undefined
let hoverTimer: ReturnType<typeof setTimeout> | undefined
const pinned = ref(false)
function place() {
  if (!trigger.value || !panel.value) return
  const anchor = trigger.value.getBoundingClientRect(), box = panel.value.getBoundingClientRect()
  const viewport = window.visualViewport, leftEdge = viewport?.offsetLeft || 0, topEdge = viewport?.offsetTop || 0
  const width = viewport?.width || window.innerWidth, height = viewport?.height || window.innerHeight
  const left = Math.min(leftEdge + width - box.width - 12, Math.max(leftEdge + 12, props.align === 'end' ? anchor.right - box.width : anchor.left))
  const above = anchor.top - box.height - 8
  const below = anchor.bottom + 8
  const top = props.placement === 'bottom' && below + box.height <= topEdge + height - 12 ? below : above >= topEdge + 12 ? above : Math.min(below, topEdge + height - box.height - 12)
  position.value = { left: left + 'px', top: Math.max(topEdge + 12, top) + 'px', visibility: 'visible' }
}
async function focusInitial() { await nextTick(); place(); (panel.value?.querySelector<HTMLElement>('[data-initial-focus]:not(:disabled)') || panel.value?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]:not(:disabled)') || panel.value?.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled)'))?.focus() }
async function show(focus = true) {
  if (props.disabled) return
  clearTimeout(hoverTimer); pinned.value = focus
  if (open.value) { if (focus) await focusInitial(); return }
  document.dispatchEvent(new CustomEvent('composer-popover-open', { detail: id }))
  position.value.visibility = 'hidden'; open.value = true
  await nextTick(); place(); if (focus) await focusInitial()
  observer = new ResizeObserver(place); if (panel.value) observer.observe(panel.value)
}
function hide(focus = true) { clearTimeout(hoverTimer); pinned.value = false; open.value = false; observer?.disconnect(); if (focus) trigger.value?.focus() }
function enter() { if (props.hover) { clearTimeout(hoverTimer); if (!open.value) void show(false) } }
function leave() { if (props.hover && !pinned.value) hoverTimer = setTimeout(() => hide(false), 150) }
function click() { if (props.hover && open.value && !pinned.value) void show(); else if (open.value) hide(); else void show() }
function outside(event: Event) { const node = event.target as Node; if (!panel.value?.contains(node) && !trigger.value?.contains(node)) hide(false) }
function otherOpened(event: Event) { if ((event as CustomEvent).detail !== id) hide(false) }
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); hide(); return }
  if ((event.target as HTMLElement).matches('input, textarea')) return
  const choices = [...(panel.value?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]:not(:disabled), [role="menuitem"]:not(:disabled)') || [])]
  if (!choices.length) return
  const index = choices.indexOf(document.activeElement as HTMLButtonElement)
  const target: Record<string, number> = { ArrowDown: (index + 1) % choices.length, ArrowUp: (index - 1 + choices.length) % choices.length, Home: 0, End: choices.length - 1 }
  if (event.key in target) { event.preventDefault(); choices[target[event.key]]?.focus() }
}
function listen(add: boolean) {
  const method = add ? 'addEventListener' : 'removeEventListener'
  document[method]('pointerdown', outside); document[method]('focusin', outside); document[method]('composer-popover-open', otherOpened)
  window[method]('resize', place); window[method]('scroll', place, true)
  window.visualViewport?.[method]('resize', place); window.visualViewport?.[method]('scroll', place)
}
watch(open, value => { listen(value); emit('change', value) })
watch(() => props.disabled, value => { if (value && open.value) hide(false) })
onBeforeUnmount(() => { clearTimeout(hoverTimer); observer?.disconnect(); listen(false) })
defineExpose({ show, hide, focusInitial })
</script>
<template>
  <button ref="trigger" type="button" class="composer-control" :class="[triggerClass, { 'is-open': open }]" :aria-label="label" :title="label" aria-haspopup="dialog" :aria-expanded="open" :aria-controls="open ? id : undefined" :disabled="disabled" @pointerenter="enter" @pointerleave="leave" @click="click" @keydown.down.prevent="show()"><slot name="trigger" :open="open" /></button>
  <Teleport :to="teleportTo">
    <Transition name="composer-menu"><div v-if="open" :id="id" ref="panel" class="composer-popover" :class="panelClass" :inert="!open" role="dialog" :aria-label="label" :style="{ ...position, width: width + 'px' }" @pointerenter="enter" @pointerleave="leave" @keydown="keydown"><slot :close="hide" :focus-initial="focusInitial" /></div></Transition>
  </Teleport>
</template>
