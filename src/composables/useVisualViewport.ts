import { onMounted, onUnmounted } from 'vue'

export const VIEWPORT_UPDATED = 'app-viewport-updated'

/** Fit the shell to the keyboard-visible area without overriding native pinch zoom. */
export function useVisualViewport(onResize?: () => void) {
  let dispose: (() => void) | undefined
  onMounted(() => {
    const root = document.documentElement, viewport = window.visualViewport
    const properties = ['--app-viewport-height', '--app-viewport-top', '--app-viewport-bottom', '--app-safe-bottom']
    const previous = properties.map(name => [name, root.style.getPropertyValue(name), root.style.getPropertyPriority(name)] as const)
    const wasCompact = root.hasAttribute('data-viewport-compact')
    let frame: number | undefined, last = ''
    function update() {
      frame = undefined
      // Pinching changes the visible viewport too, but must not reflow the app.
      if (viewport && Math.abs(viewport.scale - 1) > 0.01) return
      const height = viewport?.height ?? window.innerHeight
      if (!Number.isFinite(height) || height <= 0) return
      const top = Math.max(0, viewport?.offsetTop ?? 0)
      const bottom = Math.max(0, window.innerHeight - height - top)
      const geometry = [height, top, bottom].join('/')
      if (geometry !== last) {
        last = geometry
        root.style.setProperty(properties[0]!, height + 'px')
        root.style.setProperty(properties[1]!, top + 'px')
        root.style.setProperty(properties[2]!, bottom + 'px')
        root.style.setProperty(properties[3]!, bottom > 80 ? '0px' : 'env(safe-area-inset-bottom)')
        root.toggleAttribute('data-viewport-compact', height < 500)
        onResize?.()
        // Reposition teleported menus after applying the new shell geometry.
        window.dispatchEvent(new Event(VIEWPORT_UPDATED))
      }
      const focused = document.activeElement
      if (height >= 500 || !(focused instanceof HTMLElement) ||
        !(focused.isContentEditable || focused.matches('textarea:not([readonly]), input:not([readonly])'))) return
      const target = focused.closest<HTMLElement>('.composer, .side-chat-input form') || focused
      const box = target.getBoundingClientRect()
      if (box.top < top || box.bottom > top + height) target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' })
    }
    function schedule() { if (frame === undefined) frame = requestAnimationFrame(update) }
    window.addEventListener('resize', schedule)
    viewport?.addEventListener('resize', schedule)
    viewport?.addEventListener('scroll', schedule)
    document.addEventListener('focusin', schedule)
    update()
    dispose = () => {
      if (frame !== undefined) cancelAnimationFrame(frame)
      window.removeEventListener('resize', schedule)
      viewport?.removeEventListener('resize', schedule)
      viewport?.removeEventListener('scroll', schedule)
      document.removeEventListener('focusin', schedule)
      for (const [name, value, priority] of previous) {
        if (value) root.style.setProperty(name, value, priority)
        else root.style.removeProperty(name)
      }
      root.toggleAttribute('data-viewport-compact', wasCompact)
    }
  })
  onUnmounted(() => dispose?.())
}
