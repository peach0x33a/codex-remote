import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createRenderer, nextTick, ref, type App, type Ref } from 'vue'
import { isBoolean, isStringList, oneOf, useStoredChoice } from '../../src/composables/useStoredChoice'

type Host = { children: Host[]; parent?: Host }
const renderer = createRenderer<Host, Host>({
  createElement: () => ({ children: [] }), createText: () => ({ children: [] }), createComment: () => ({ children: [] }),
  insert: (node, parent) => { node.parent = parent; parent.children.push(node) },
  remove: node => { if (node.parent) node.parent.children = node.parent.children.filter(child => child !== node) },
  setText: () => {}, setElementText: () => {}, patchProp: () => {},
  parentNode: node => node.parent || null, nextSibling: () => null,
})
const apps = new Set<App<Host>>()
const originals = new Map<string, PropertyDescriptor | undefined>()
let entries: Map<string, string>, writes: [string, string][], events: EventTarget
function global(name: string, descriptor: PropertyDescriptor) {
  if (!originals.has(name)) originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
  Object.defineProperty(globalThis, name, { configurable: true, ...descriptor })
}
function mount<T>(key: string | (() => string), fallback: T, valid: (value: unknown) => value is T) {
  let choice!: Ref<T>
  const app = renderer.createApp({ setup() { choice = useStoredChoice(key, fallback, valid); return () => null } })
  apps.add(app); app.mount({ children: [] })
  return { choice, unmount() { app.unmount(); apps.delete(app) } }
}
function storageEvent(key: string | null) {
  events.dispatchEvent(Object.assign(new Event('storage'), { key, newValue: key === null ? null : entries.get(key) ?? null }))
}
const validTab = oneOf(['all', 'files', 'agents'] as const)
beforeEach(() => {
  entries = new Map(); writes = []; events = new EventTarget()
  global('window', { writable: true, value: events })
  global('localStorage', { writable: true, value: {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { writes.push([key, value]); entries.set(key, value) },
  } })
})
afterEach(() => {
  for (const app of apps) app.unmount()
  apps.clear()
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else Reflect.deleteProperty(globalThis, name)
  }
  originals.clear()
})

describe('persisted choices', () => {
  test('restores a saved selection without writing and persists edits across remounts', async () => {
    entries.set('tab', JSON.stringify('agents'))
    const first = mount('tab', 'all', validTab)
    expect(first.choice.value).toBe('agents')
    expect(writes).toEqual([])
    first.choice.value = 'files'
    await nextTick()
    expect(writes).toEqual([['tab', JSON.stringify('files')]])
    first.unmount()
    const second = mount('tab', 'all', validTab)
    expect(second.choice.value).toBe('files')
    expect(writes).toHaveLength(1)
    second.choice.value = 'all'
    expect(entries.get('tab')).toBe(JSON.stringify('all'))
  })

  test('accepts saved false and empty lists rather than replacing them with defaults', () => {
    entries.set('collapsed', 'false'); entries.set('pins', '[]')
    const collapsed = mount('collapsed', true, isBoolean).choice
    const pins = mount('pins', ['default-thread'], isStringList).choice
    expect(collapsed.value).toBe(false)
    expect(pins.value).toEqual([])
    expect(writes).toEqual([])
    collapsed.value = true; collapsed.value = false
    expect(writes).toEqual([['collapsed', 'true'], ['collapsed', 'false']])
  })

  test.each(['', '{broken', 'null', '[]', '{}', '12', 'true', '"retired"'])('uses the default for malformed or unsupported storage %j without overwriting it', raw => {
    entries.set('tab', raw)
    expect(mount('tab', 'files', validTab).choice.value).toBe('files')
    expect(entries.get('tab')).toBe(raw)
    expect(writes).toEqual([])
  })

  test('clones missing list defaults per instance and persists deep changes', () => {
    const fallback = ['root']
    const first = mount('pins-a', fallback, isStringList).choice
    const second = mount('pins-b', fallback, isStringList).choice
    expect(first.value).toEqual(['root'])
    expect(first.value).not.toBe(second.value)
    expect(writes).toEqual([])
    first.value.push('child')
    expect(entries.get('pins-a')).toBe(JSON.stringify(['root', 'child']))
    expect(second.value).toEqual(['root'])
    expect(fallback).toEqual(['root'])
    first.value.splice(0, 1)
    expect(writes).toEqual([['pins-a', JSON.stringify(['root', 'child'])], ['pins-a', JSON.stringify(['child'])]])
  })

  test('does not save selections rejected by the supplied validator', () => {
    const choice = mount('tab', 'all', validTab).choice as Ref<string>
    choice.value = 'files'
    choice.value = 'unsupported'
    expect(entries.get('tab')).toBe(JSON.stringify('files'))
    expect(writes).toHaveLength(1)
    choice.value = 'agents'
    expect(entries.get('tab')).toBe(JSON.stringify('agents'))
  })

  test('isolates reactive device keys without copying the previous device selection', () => {
    entries.set('tab:desktop', JSON.stringify('files'))
    entries.set('tab:laptop', JSON.stringify('agents'))
    const device = ref('desktop')
    const choice = mount(() => 'tab:' + device.value, 'all', validTab).choice
    expect<string>(choice.value).toBe('files')
    choice.value = 'all'
    device.value = 'laptop'
    expect<string>(choice.value).toBe('agents')
    expect(writes).toEqual([['tab:desktop', JSON.stringify('all')]])
    choice.value = 'files'
    device.value = 'new-device'
    expect<string>(choice.value).toBe('all')
    expect(entries.has('tab:new-device')).toBe(false)
    expect(writes).toHaveLength(2)
    choice.value = 'agents'
    device.value = 'desktop'; expect<string>(choice.value).toBe('all')
    device.value = 'laptop'; expect<string>(choice.value).toBe('files')
    device.value = 'new-device'; expect<string>(choice.value).toBe('agents')
    expect(writes).toEqual([
      ['tab:desktop', JSON.stringify('all')], ['tab:laptop', JSON.stringify('files')], ['tab:new-device', JSON.stringify('agents')],
    ])
  })
})

describe('storage events and component lifetime', () => {
  test('applies a remote selection without echoing a write, then still saves local changes', async () => {
    const choice = mount('tab', 'all', validTab).choice
    choice.value = 'files'
    entries.set('tab', JSON.stringify('agents')); storageEvent('tab')
    expect<string>(choice.value).toBe('agents')
    await nextTick()
    expect(writes).toEqual([['tab', JSON.stringify('files')]])
    choice.value = 'all'
    expect(writes).toEqual([['tab', JSON.stringify('files')], ['tab', JSON.stringify('all')]])
  })

  test('ignores other keys and the previous device after a device switch', () => {
    const device = ref('desktop')
    const choice = mount(() => 'tab:' + device.value, 'all', validTab).choice
    device.value = 'laptop'
    entries.set('tab:laptop', JSON.stringify('agents'))
    storageEvent('tab:desktop'); storageEvent('unrelated')
    expect<string>(choice.value).toBe('all')
    storageEvent('tab:laptop')
    expect<string>(choice.value).toBe('agents')
    expect(writes).toEqual([])
  })

  test.each(['remove', 'clear', 'malformed', 'invalid'] as const)('restores the default on remote %s without rewriting storage', async change => {
    entries.set('tab', JSON.stringify('agents')); entries.set('other', 'keep')
    const choice = mount('tab', 'files', validTab).choice
    if (change === 'clear') entries.clear()
    else if (change === 'remove') entries.delete('tab')
    else entries.set('tab', change === 'malformed' ? '{broken' : JSON.stringify('unsupported'))
    const before = [...entries]
    storageEvent(change === 'clear' ? null : 'tab')
    await nextTick()
    expect<string>(choice.value).toBe('files')
    expect([...entries]).toEqual(before)
    expect(writes).toEqual([])
  })

  test('restores list values without an echo and continues tracking subsequent deep edits', async () => {
    const fallback = ['root']
    const choice = mount('pins', fallback, isStringList).choice
    entries.set('pins', JSON.stringify(['remote'])); storageEvent('pins')
    await nextTick()
    expect(choice.value).toEqual(['remote'])
    expect(writes).toEqual([])
    choice.value.push('local')
    expect(writes).toEqual([['pins', JSON.stringify(['remote', 'local'])]])
    entries.clear(); storageEvent(null)
    expect(choice.value).toEqual(['root'])
    expect(fallback).toEqual(['root'])
    expect(writes).toHaveLength(1)
  })

  test('removes storage listeners and stops persistence watches on unmount', async () => {
    const mounted = mount('tab', 'all', validTab)
    mounted.unmount()
    entries.set('tab', JSON.stringify('agents')); storageEvent('tab')
    expect(mounted.choice.value).toBe('all')
    mounted.choice.value = 'files'
    await nextTick()
    expect(entries.get('tab')).toBe(JSON.stringify('agents'))
    expect(writes).toEqual([])
    expect(mount('tab', 'all', validTab).choice.value).toBe('agents')
  })

  test.each(['access', 'read', 'write'] as const)('keeps the selection usable when storage %s throws', failure => {
    if (failure === 'access') global('localStorage', { get() { throw new Error('blocked storage') } })
    else global('localStorage', { value: {
      getItem: () => { if (failure === 'read') throw new Error('blocked read'); return null },
      setItem: () => { throw new Error('blocked write') },
    } })
    const choice = mount('tab', 'all', validTab).choice
    expect<string>(choice.value).toBe('all')
    expect(() => { choice.value = 'agents' }).not.toThrow()
    expect<string>(choice.value).toBe('agents')
  })
})

test('choice validators reject coercion, malformed lists and oversized persisted values', () => {
  expect(isBoolean(false)).toBe(true)
  expect(isBoolean('false')).toBe(false)
  expect(validTab('agents')).toBe(true)
  for (const value of ['AGENTS', null, ['agents'], 0]) expect(validTab(value)).toBe(false)
  expect(isStringList([])).toBe(true)
  expect(isStringList(Array.from({ length: 1000 }, () => 'thread'))).toBe(true)
  expect(isStringList(['x'.repeat(4095)])).toBe(true)
  for (const value of [null, 'thread', {}, ['thread', 1], Array.from({ length: 1001 }, () => 'thread'), ['x'.repeat(4096)]]) {
    expect(isStringList(value)).toBe(false)
  }
})
