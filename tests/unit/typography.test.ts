import { afterEach, beforeEach, expect, test } from 'bun:test'
import { createRenderer, nextTick, type App } from 'vue'
import { useTypography } from '../../src/composables/useTypography'
import { CODE_FONT_FALLBACK, DEFAULT_TYPOGRAPHY, fontStack, normalizeTypography, TYPOGRAPHY_KEY } from '../../src/lib/typography'
type Node = { children: Node[]; parent?: Node }
const renderer = createRenderer<Node, Node>({ createElement: () => ({ children: [] }), createText: () => ({ children: [] }), createComment: () => ({ children: [] }), insert: (node, parent) => { node.parent = parent; parent.children.push(node) }, remove: () => {}, setText: () => {}, setElementText: () => {}, patchProp: () => {}, parentNode: node => node.parent || null, nextSibling: () => null })
let app: App<Node> | undefined, state: ReturnType<typeof useTypography>, entries: Map<string, string>, css: Map<string, string>
const originals = new Map<string, PropertyDescriptor | undefined>()
function global(name: string, value: unknown) { originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, writable: true, value }) }
function mount() { app = renderer.createApp({ setup() { state = useTypography(); return () => null } }); app.mount({ children: [] }) }
beforeEach(() => {
  entries = new Map(); css = new Map()
  global('window', new EventTarget()); global('document', { documentElement: { style: { setProperty: (key: string, value: string) => css.set(key, value) } } })
  global('localStorage', { getItem: (key: string) => entries.get(key) || null, setItem: (key: string, value: string) => { entries.set(key, value) } })
})
afterEach(() => { app?.unmount(); for (const [name, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name) } originals.clear() })

test('custom font names are quoted as a single name and have the right fallback', () => {
  expect(fontStack('JetBrains Mono', 'code')).toBe('"JetBrains Mono", ' + CODE_FONT_FALLBACK)
  expect(fontStack('serif', 'ui')).toStartWith('serif, ')
  expect(normalizeTypography({ uiFont: 'bad\nname' }).uiFont).toBe('')
  expect(fontStack('font; color: red', 'ui')).toStartWith('"font; color: red", ')
})

test('hover previews change only the requested output, never storage, and restore on leaving', async () => {
  mount(); state.update({ uiSize: 16, codeSize: 14 }); await nextTick(); const saved = entries.get(TYPOGRAPHY_KEY)
  state.previewSize('uiSize', 20); await nextTick(); expect(css.get('--ui-font-scale')).toBe(String(20 / 14)); expect(css.get('--code-font-size')).toBe('14px')
  expect(entries.get(TYPOGRAPHY_KEY)).toBe(saved); state.clearPreview(); await nextTick(); expect(css.get('--ui-font-scale')).toBe(String(16 / 14))
  state.previewSize('codeSize', 24); await nextTick(); expect(css.get('--code-font-size')).toBe('24px'); expect(entries.get(TYPOGRAPHY_KEY)).toBe(saved)
  state.previewSize('codeSize', null); await nextTick(); expect(css.get('--code-font-size')).toBe('14px')
})
test('typography persists across remounts and synchronizes from other tabs', async () => {
  mount(); state.update({ uiFont: 'serif', uiSize: 17, codeFont: 'Fira Code', codeSize: 19 }); await nextTick()
  app!.unmount(); mount(); expect(state.preferences.value).toMatchObject({ uiFont: 'serif', uiSize: 17, codeFont: 'Fira Code', codeSize: 19 })
  entries.set(TYPOGRAPHY_KEY, JSON.stringify({ ...DEFAULT_TYPOGRAPHY, codeSize: 21 })); window.dispatchEvent(Object.assign(new Event('storage'), { key: TYPOGRAPHY_KEY })); await nextTick()
  expect(css.get('--code-font-size')).toBe('21px'); expect(css.get('--ui-font-scale')).toBe('1')
})
