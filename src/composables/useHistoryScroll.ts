import { watch, type Ref } from 'vue'

/** Repeated or sustained attempts at the top load one page; momentum alone does not. */
export function useHistoryScroll(host: Ref<HTMLElement | undefined>, enabled: Ref<boolean>, load: () => Promise<void>) {
  let attempts = 0, lastAttempt = 0, lastWheel = 0, wheelDistance = 0, wheelCounted = false
  let countedAt = 0, previousDelta = 0, fallingWheels = 0, momentum = false
  let touch: { x: number; y: number; latestX: number; latestY: number; startedAtTop: boolean } | undefined
  const atTop = () => !!host.value && host.value.scrollTop <= 24
  function resetWheel() { wheelDistance = 0; wheelCounted = false; countedAt = 0; previousDelta = 0; fallingWheels = 0; momentum = false }
  function reset() { attempts = 0; lastAttempt = 0; lastWheel = 0; resetWheel(); touch = undefined }
  function allowed(target: EventTarget | null) {
    if (!enabled.value || !host.value || !(target instanceof Element)) return false
    // Scrolling code/output or an editable field is independent of the transcript.
    for (let node: Element | null = target; node && node !== host.value; node = node.parentElement) {
      if (node.matches('input, textarea, [contenteditable="true"]')) return false
      if (node.scrollHeight > node.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(node).overflowY)) return false
    }
    return host.value.contains(target)
  }
  function attempt(now: number) {
    if (now - lastAttempt > 1600) attempts = 0
    lastAttempt = now
    if (++attempts < 2) return
    reset()
    void load()
  }
  function wheel(event: WheelEvent) {
    if (event.deltaY === 0 && !event.ctrlKey) return
    if (event.ctrlKey || event.deltaY > 0 || Math.abs(event.deltaX) > Math.abs(event.deltaY) || !allowed(event.target) || !atTop()) { reset(); return }
    const now = performance.now()
    if (now - lastWheel > 180) resetWheel()
    lastWheel = now
    const delta = -event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? host.value!.clientHeight : 1)
    // A new finger stroke can arrive before the previous momentum tail stops.
    if (momentum && delta >= Math.max(8, previousDelta * 1.8)) resetWheel()
    else if (delta < previousDelta - .5) { if (++fallingWheels >= 3) momentum = true }
    else if (delta > previousDelta + .5) fallingWheels = 0
    previousDelta = delta; wheelDistance += delta
    if (!wheelCounted && wheelDistance >= 32) { wheelCounted = true; countedAt = now; wheelDistance = 0; attempt(now) }
    else if (wheelCounted && !momentum && delta >= 8 && wheelDistance >= 320 && now - countedAt >= 500) attempt(now)
  }
  function touchstart(event: TouchEvent) {
    if (event.touches.length !== 1 || !allowed(event.target)) { reset(); return }
    const point = event.touches[0]!
    touch = { x: point.clientX, y: point.clientY, latestX: point.clientX, latestY: point.clientY, startedAtTop: atTop() }
  }
  function touchmove(event: TouchEvent) {
    if (event.touches.length !== 1) { reset(); return }
    if (!touch) return
    const point = event.touches[0]!
    touch.latestX = point.clientX; touch.latestY = point.clientY
    if (touch.latestY < touch.y - 12) reset()
  }
  function touchend() {
    const gesture = touch; touch = undefined
    if (!gesture) return
    const distance = gesture.latestY - gesture.y
    // Finger moves down to read older messages. The gesture reaching the top
    // arms the boundary; only subsequent gestures at that boundary count.
    if (enabled.value && gesture.startedAtTop && atTop() && distance >= 32 && distance > Math.abs(gesture.latestX - gesture.x)) attempt(performance.now())
    else reset()
  }
  function scroll() { if (!atTop()) reset() }
  watch(enabled, value => { if (!value) reset() }, { flush: 'sync' })
  return { wheel, touchstart, touchmove, touchend, reset, scroll }
}
