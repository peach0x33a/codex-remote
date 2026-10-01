import { afterEach, beforeEach, expect, test } from 'bun:test'
import { createRenderer, nextTick, type App } from 'vue'
import { useAppearance } from '../../src/composables/useAppearance'
import { readUiPreferences, UI_PREFERENCES_KEY } from '../../src/lib/ui-preferences'

type Host = { children: Host[]; parent?: Host }
const renderer = createRenderer<Host, Host>({
  createElement: () => ({ children: [] }), createText: () => ({ children: [] }), createComment: () => ({ children: [] }),
  insert: (node, parent) => { node.parent = parent; parent.children.push(node) }, remove: node => { if (node.parent) node.parent.children = node.parent.children.filter(child => child !== node) },
  setElementText: () => {}, setText: () => {}, patchProp: () => {}, parentNode: node => node.parent || null, nextSibling: () => null,
})
const originals = new Map<string, PropertyDescriptor | undefined>()
let app: App<Host> | undefined, state: ReturnType<typeof useAppearance>
let entries: Map<string, string>, media: EventTarget & { matches: boolean }
function install(name: string, value: unknown) { originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, writable: true, value }) }
function mount() { app = renderer.createApp({ setup() { state = useAppearance(); return () => null } }); app.mount({ children: [] }) }
function changeSystem(matches: boolean) { media.matches = matches; media.dispatchEvent(Object.assign(new Event('change'), { matches })) }
beforeEach(() => {
  entries = new Map()
  media = Object.assign(new EventTarget(), { matches: false })
  install('localStorage', { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => entries.set(key, value) })
  install('window', Object.assign(new EventTarget(), { matchMedia: () => media }))
  install('document', { documentElement: { dataset: {}, style: {} }, querySelector: () => null })
})
afterEach(() => {
  app?.unmount(); app = undefined
  for (const [name, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name) }
  originals.clear()
})

test.each(['animated', 'image', 'none'] as const)('keeps %s mode and image effects across theme changes, system events and remounts', async mode => {
  const effects = { opacity: 71, blur: 8, color: '#123456', colorOpacity: 24 }
  mount(); state.backgroundMode.value = mode; state.imageBackground.value = effects; state.autoConnect.value = false
  for (const theme of ['light', 'dark', 'system'] as const) {
    state.theme.value = theme
    for (const dark of [true, false]) {
      changeSystem(dark); await nextTick()
      expect(state.resolvedTheme.value).toBe(theme === 'system' ? (dark ? 'dark' : 'light') : theme)
      expect(state.backgroundMode.value).toBe(mode)
      expect(state.imageBackground.value).toEqual(effects)
    }
  }
  expect(readUiPreferences(localStorage)).toMatchObject({ backgroundMode: mode, imageBackground: effects, autoConnect: false })
  app!.unmount(); mount(); await nextTick()
  expect(state.backgroundMode.value).toBe(mode)
  expect(state.imageBackground.value).toEqual(effects)
  expect(state.autoConnect.value).toBe(false)
})

test('migrates the visible legacy background before the system appearance changes', async () => {
  media.matches = true
  const effects = { opacity: 51, blur: 12, color: '#987654', colorOpacity: 20 }
  entries.set(UI_PREFERENCES_KEY, JSON.stringify({ theme: 'system', backgrounds: { light: 'animated', dark: 'image' }, imageBackgrounds: { dark: effects } }))
  mount(); await nextTick()
  expect(state.backgroundMode.value).toBe('image')
  expect(state.imageBackground.value).toEqual(effects)
  changeSystem(false); await nextTick()
  app!.unmount(); mount(); await nextTick()
  expect(state.resolvedTheme.value).toBe('light')
  expect(state.backgroundMode.value).toBe('image')
  expect(state.imageBackground.value).toEqual(effects)
})

test('synchronizes general settings from another tab without coupling background to theme', async () => {
  mount(); state.backgroundMode.value = 'none'; state.autoConnect.value = false; await nextTick()
  entries.set(UI_PREFERENCES_KEY, JSON.stringify({ ...readUiPreferences(localStorage), theme: 'dark', autoConnect: true }))
  window.dispatchEvent(Object.assign(new Event('storage'), { key: UI_PREFERENCES_KEY })); await nextTick()
  expect(state.theme.value).toBe('dark')
  expect(state.backgroundMode.value).toBe('none')
  expect(state.autoConnect.value).toBe(true)
})
test('previews width and image effects without persisting, then restores the committed values', async () => {
  mount(); state.contentWidth.value = 840; state.imageBackground.value = { opacity: 35, blur: 3, color: '#123456', colorOpacity: 20 }; await nextTick()
  const before = entries.get(UI_PREFERENCES_KEY)
  state.setWidthPreview(1280); state.setImagePreview({ ...state.imageBackground.value, opacity: 80, blur: 12 }); await nextTick()
  expect(state.displayContentWidth.value).toBe(1280); expect(state.contentWidth.value).toBe(840)
  expect(state.displayImageBackground.value).toMatchObject({ opacity: 80, blur: 12 })
  expect(entries.get(UI_PREFERENCES_KEY)).toBe(before)
  state.setWidthPreview(null); state.setImagePreview(null); await nextTick()
  expect(state.displayContentWidth.value).toBe(840); expect(state.displayImageBackground.value).toMatchObject({ opacity: 35, blur: 3 })
  state.contentWidth.value = 1280; await nextTick(); expect(readUiPreferences(localStorage).contentWidth).toBe(1280)
})
