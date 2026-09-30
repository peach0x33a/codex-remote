<script setup lang="ts">
defineOptions({ inheritAttrs: false })
defineProps<{ open: boolean }>()
function leaving(element: Element) { element.setAttribute('inert', ''); element.setAttribute('aria-hidden', 'true') }
function entering(element: Element) { element.removeAttribute('inert'); element.removeAttribute('aria-hidden') }
</script>

<template>
  <Transition name="content-reveal" @before-leave="leaving" @before-enter="entering" @leave-cancelled="entering">
    <div v-if="open" v-bind="$attrs" class="motion-collapse" :inert="!open" :aria-hidden="!open || undefined">
      <div class="motion-collapse-inner"><slot /></div>
    </div>
  </Transition>
</template>

<style scoped>
.motion-collapse { display: grid; grid-template-rows: 1fr; min-width: 0; }
.motion-collapse-inner { min-height: 0; min-width: 0; overflow: hidden; }
.content-reveal-enter-active { transition: grid-template-rows 220ms var(--ease), opacity 160ms ease; }
.content-reveal-leave-active { transition: grid-template-rows 160ms var(--ease), opacity 110ms ease; pointer-events: none; }
.content-reveal-enter-from, .content-reveal-leave-to { grid-template-rows: 0fr; opacity: 0; }
@media (prefers-reduced-motion: reduce) { .content-reveal-enter-active, .content-reveal-leave-active { transition: none; } }
</style>
