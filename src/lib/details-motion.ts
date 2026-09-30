import { nextTick, type ObjectDirective } from 'vue'

type Notify = (open: boolean) => void
const cleanups = new WeakMap<object, () => void>()

/** One animated element; native summary clicks include keyboard activation. */
export function attachDetailsMotion(el: HTMLDetailsElement, notify: Notify = () => {}) {
  // Vue's in-memory renderer deliberately has neither DOM nor animation APIs.
  if (typeof el.addEventListener !== 'function' || typeof el.querySelector !== 'function' || !el.style || !el.ownerDocument?.defaultView) return () => {}
  const doc = el.ownerDocument, win = doc.defaultView!
  const candidate = el.querySelector('summary')
  if (!candidate) return () => {}
  const summary: HTMLElement = candidate
  const media = win.matchMedia?.('(prefers-reduced-motion: reduce)')
  let desired = el.open, busy = false, disposed = false, revision = 0, frame = 0, deadline = 0
  let animation: Animation | undefined
  let saved: { height: string; heightPriority: string; overflow: string; overflowPriority: string } | undefined
  const now = () => win.performance.now()
  function save() {
    saved ??= { height: el.style.getPropertyValue('height'), heightPriority: el.style.getPropertyPriority('height'), overflow: el.style.getPropertyValue('overflow'), overflowPriority: el.style.getPropertyPriority('overflow') }
  }
  function restore() {
    if (!saved) return
    for (const name of ['height', 'overflow'] as const) {
      if (saved[name]) el.style.setProperty(name, saved[name], saved[name === 'height' ? 'heightPriority' : 'overflowPriority'])
      else el.style.removeProperty(name)
    }
    saved = undefined
  }
  function cancel() {
    if (!animation) return
    animation.onfinish = animation.oncancel = null
    animation.cancel(); animation = undefined
  }
  function finish() {
    revision++; busy = false
    if (frame) win.cancelAnimationFrame(frame)
    frame = 0; cancel(); el.open = desired; notify(desired); restore()
  }
  function insets() {
    const style = win.getComputedStyle(el)
    const extra = ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth'].reduce((sum, key) => sum + (parseFloat(style[key as keyof CSSStyleDeclaration] as string) || 0), 0)
    return { extra, contentBox: style.boxSizing !== 'border-box' }
  }
  function height(pixels: number) { const { extra, contentBox } = insets(); return Math.max(0, pixels - (contentBox ? extra : 0)) + 'px' }
  async function transition(open: boolean, retarget = false) {
    if (disposed) return
    desired = open
    if (media?.matches || doc.hidden || typeof el.animate !== 'function') { finish(); return }
    const current = el.getBoundingClientRect().height, ticket = ++revision
    save(); el.style.height = height(current); el.style.overflow = 'hidden'; cancel(); busy = true
    if (!retarget) deadline = now() + (open ? 220 : 160)
    if (!el.open) {
      el.open = true
      // The native toggle event arrives later. Notify Vue synchronously so its
      // lazy v-if children exist by nextTick, before measuring the open height.
      notify(true)
    }
    await nextTick()
    if (disposed || ticket !== revision) return
    el.style.height = 'auto'
    const summaryStyle = win.getComputedStyle(summary)
    const target = open ? el.getBoundingClientRect().height : summary.getBoundingClientRect().height + insets().extra +
      (parseFloat(summaryStyle.marginTop) || 0) + (parseFloat(summaryStyle.marginBottom) || 0)
    el.style.height = height(current)
    const duration = Math.max(0, deadline - now())
    if (duration === 0 || Math.abs(target - current) < .5) { finish(); return }
    try {
      animation = el.animate([{ height: height(current) }, { height: height(target) }], { duration, easing: 'cubic-bezier(.16, 1, .3, 1)', fill: 'forwards' })
      animation.onfinish = animation.oncancel = () => { if (!disposed && ticket === revision) finish() }
    } catch { finish() }
  }
  function click(event: MouseEvent) {
    const target = event.target as Element | null
    if (event.defaultPrevented || event.button > 0 || typeof target?.closest !== 'function' || target.closest('summary') !== summary) return
    if (target !== summary && target.closest('a, button, input, select, textarea, [contenteditable="true"]')) return
    event.preventDefault(); void transition(!(busy ? desired : el.open))
  }
  function toggle(event: Event) {
    if (event.target !== el || disposed) return
    // A queued native opening event may arrive during a closing animation.
    // Its current open=true is intentional until that animation finishes.
    if (busy && el.open) return
    desired = el.open
    if (busy) finish()
    else notify(desired)
  }
  function preferences() { if (busy && (media?.matches || doc.hidden)) finish() }
  function retarget() {
    if (!busy || !animation || frame) return
    frame = win.requestAnimationFrame(() => { frame = 0; if (busy) void transition(desired, true) })
  }
  const Resize = (win as Window & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver
  const Mutation = (win as Window & { MutationObserver?: typeof MutationObserver }).MutationObserver
  const resize = Resize ? new Resize(retarget) : undefined
  const observed = new Set<Element>()
  function observeChildren() {
    for (const child of observed) if (child.parentElement !== el) { resize?.unobserve(child); observed.delete(child) }
    for (const child of el.children) if (!observed.has(child)) { resize?.observe(child); observed.add(child) }
  }
  const mutation = Mutation ? new Mutation(() => { observeChildren(); retarget() }) : undefined
  observeChildren(); mutation?.observe(el, { subtree: true, childList: true, characterData: true })
  el.addEventListener('click', click); el.addEventListener('toggle', toggle)
  doc.addEventListener('visibilitychange', preferences); media?.addEventListener?.('change', preferences)
  return () => {
    disposed = true; revision++; busy = false; cancel(); restore()
    if (frame) win.cancelAnimationFrame(frame)
    resize?.disconnect(); mutation?.disconnect(); observed.clear()
    el.removeEventListener('click', click); el.removeEventListener('toggle', toggle)
    doc.removeEventListener('visibilitychange', preferences); media?.removeEventListener?.('change', preferences)
  }
}

export const vAnimatedDetails: ObjectDirective<HTMLDetailsElement, Notify> = {
  mounted(el, binding) { cleanups.set(el, attachDetailsMotion(el, open => binding.value?.(open))) },
  beforeUnmount(el) { cleanups.get(el)?.(); cleanups.delete(el) },
}
