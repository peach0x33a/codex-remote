import { describe, expect, test } from 'bun:test'
import { nextTick } from 'vue'
import { attachDetailsMotion } from '../../src/lib/details-motion'

function fixture(options: { open?: boolean; animate?: boolean; reduced?: boolean } = {}) {
  let clock = 0, frame: (() => void) | undefined, mutation: (() => void) | undefined, resize: (() => void) | undefined
  let mounted = !!options.open, natural = 140, active: any
  const media = Object.assign(new EventTarget(), { matches: !!options.reduced })
  const style = {
    height: '', overflow: '',
    getPropertyValue(name: string) { return this[name as 'height' | 'overflow'] },
    getPropertyPriority(_name: string) { return '' },
    setProperty(name: string, value: string) { this[name as 'height' | 'overflow'] = value },
    removeProperty(name: string) { this[name as 'height' | 'overflow'] = '' },
  }
  const summary: any = { parentElement: null, getBoundingClientRect: () => ({ height: 24 }), closest: (selector: string) => selector === 'summary' ? summary : null }
  const doc = Object.assign(new EventTarget(), { hidden: false, defaultView: null as any })
  const win = {
    performance: { now: () => clock }, matchMedia: () => media,
    getComputedStyle: () => ({ boxSizing: 'border-box', marginTop: '0', marginBottom: '0' }),
    requestAnimationFrame(callback: () => void) { frame = callback; return 1 }, cancelAnimationFrame() { frame = undefined },
    ResizeObserver: class { constructor(callback: () => void) { resize = callback } observe() {} unobserve() {} disconnect() { resize = undefined } },
    MutationObserver: class { constructor(callback: () => void) { mutation = callback } observe() {} disconnect() { mutation = undefined } },
  }
  doc.defaultView = win
  const animations: any[] = [], notifications: boolean[] = []
  const el = Object.assign(new EventTarget(), {
    open: !!options.open, style, ownerDocument: doc, children: [summary], querySelector: () => summary,
    getBoundingClientRect: () => ({ height: active ? active.current : style.height && style.height !== 'auto' ? parseFloat(style.height) : el.open && mounted ? natural : 24 }),
    animate: options.animate === false ? undefined : (frames: { height: string }[], timing: { duration: number }) => {
      const animation = { frames, timing, current: parseFloat(frames[0]!.height), onfinish: null as any, oncancel: null as any,
        cancel() { if (active === animation) active = undefined; animation.oncancel?.() },
        finish() { animation.onfinish?.() },
      }
      animations.push(animation); active = animation; return animation
    },
  })
  summary.parentElement = el
  const dispose = attachDetailsMotion(el as unknown as HTMLDetailsElement, open => {
    notifications.push(open)
    // Model the actual lazy v-if: content is not available synchronously.
    void nextTick(() => { mounted = open })
  })
  return {
    el, doc, media, style, animations, notifications, dispose,
    get mounted() { return mounted },
    click(target = summary, detail = 1) {
      const event = new Event('click', { cancelable: true })
      Object.defineProperties(event, { target: { value: target }, button: { value: 0 }, detail: { value: detail } })
      el.dispatchEvent(event); return event
    },
    nativeToggle() { el.dispatchEvent(new Event('toggle')) },
    progress(height: number, elapsed = 80) { active.current = height; clock += elapsed },
    stream(height: number) { natural = height; mutation?.(); resize?.(); const callback = frame; frame = undefined; callback?.() },
    reduced() { media.matches = true; media.dispatchEvent(new Event('change')) },
    hidden() { doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange')) },
  }
}
const flush = async () => { await nextTick(); await nextTick() }

describe('native details animation lifecycle', () => {

  test('reverses from current rendered height and honors rapid repeated activation', async () => {
    const f = fixture(); f.click(); await flush(); const first = f.animations[0]
    f.progress(70); f.click(); await flush()
    expect(f.animations[1].frames[0].height).toBe('70px')
    expect(first.onfinish).toBeNull()
    f.progress(45); f.click(); await flush()
    expect(f.animations[2].frames[0].height).toBe('45px')
    f.animations[2].finish(); await flush(); expect(f.el.open).toBe(true)
    f.click(); f.click(); f.click(); await flush()
    f.animations.at(-1).finish(); await flush(); expect(f.el.open).toBe(false); f.dispose()
  })

  test('retargets streaming content without resetting the animation deadline', async () => {
    const f = fixture(); f.click(); await flush(); f.progress(60)
    f.stream(230); await flush()
    expect(f.animations[1].frames).toEqual([{ height: '60px' }, { height: '230px' }])
    expect(f.animations[1].timing.duration).toBe(140)
    f.animations[1].finish(); expect(f.style.height).toBe(''); f.dispose()
  })

  test.each([{ animate: false }, { reduced: true }])('falls back immediately with %j', async options => {
    const f = fixture(options); f.click(undefined, 0); await flush()
    expect(f.el.open).toBe(true); expect(f.mounted).toBe(true); expect(f.animations).toHaveLength(0)
    f.click(); await flush(); expect(f.el.open).toBe(false); expect(f.mounted).toBe(false); f.dispose()
  })

  test('unmount restores existing inline styles and invalidates pending work', async () => {
    const f = fixture(); f.style.height = '60px'; f.style.overflow = 'clip'
    f.click(); await flush(); f.dispose()
    expect(f.style.height).toBe('60px'); expect(f.style.overflow).toBe('clip')
    const calls = f.notifications.length; f.click(); f.stream(400); f.reduced(); await flush()
    expect(f.notifications).toHaveLength(calls)
    const pending = fixture(); pending.click(); pending.dispose(); await flush()
    expect(pending.animations).toHaveLength(0); expect(pending.style.height).toBe('')
  })

  test('does not hijack nested summaries or interactive summary descendants', () => {
    const f = fixture()
    expect(f.click({ closest: () => ({}) }).defaultPrevented).toBe(false)
    const summary = f.el.children[0]!
    expect(f.click({ closest: (selector: string) => selector === 'summary' ? summary : {} }).defaultPrevented).toBe(false)
    f.dispose()
  })

})
