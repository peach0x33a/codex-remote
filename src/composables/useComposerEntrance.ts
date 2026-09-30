import { onUnmounted, ref, watch, nextTick, type Ref } from 'vue'

/** Keep one live editor while its home and conversation layouts change. */
export function useComposerEntrance(welcome: Ref<boolean>, area: Ref<HTMLElement | undefined>) {
  const moving = ref(false)
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  let animation: Animation | undefined, sequence = 0
  function cancel() { sequence++; animation?.cancel(); animation = undefined; moving.value = false }
  watch(welcome, async (isHome, wasHome) => {
    const element = area.value
    if (!element || isHome === wasHome) return
    const from = element.getBoundingClientRect()
    const fromEditor = element.querySelector('.composer')?.getBoundingClientRect() || from
    cancel()
    const current = sequence
    await nextTick()
    if (current !== sequence || element !== area.value || reducedMotion.matches) return
    const to = element.getBoundingClientRect()
    const toEditor = element.querySelector('.composer')?.getBoundingClientRect() || to
    if (!from.width || !to.width || typeof element.animate !== 'function') return
    const x = from.left + from.width / 2 - to.left - to.width / 2
    const y = fromEditor.top - toEditor.top
    moving.value = true
    // Animate width instead of scaling: text, cursor and icons stay sharp.
    animation = element.animate([
      { width: from.width + 'px', maxWidth: 'none', transform: `translate3d(${x}px, ${y}px, 0)` },
      { width: to.width + 'px', maxWidth: 'none', transform: 'translate3d(0, 0, 0)' },
    ], { duration: isHome ? 280 : 420, easing: 'cubic-bezier(.22, 1, .36, 1)' })
    try { await animation.finished } catch { /* A newer layout or viewport change takes precedence. */ }
    if (current === sequence) { animation = undefined; moving.value = false }
  }, { flush: 'pre' })
  reducedMotion.addEventListener('change', cancel)
  window.addEventListener('resize', cancel)
  onUnmounted(() => { cancel(); reducedMotion.removeEventListener('change', cancel); window.removeEventListener('resize', cancel) })
  return { moving }
}
