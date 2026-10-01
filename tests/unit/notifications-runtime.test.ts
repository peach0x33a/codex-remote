import { afterEach, beforeEach, expect, test } from 'bun:test'
import { createRenderer, nextTick, type App } from 'vue'
import { useTaskNotifications } from '../../src/composables/useTaskNotifications'
import { NOTIFICATION_KEY, type TaskNotice } from '../../src/lib/task-notifications'
type Node = { children: Node[]; parent?: Node }
const renderer = createRenderer<Node, Node>({ createElement: () => ({ children: [] }), createText: () => ({ children: [] }), createComment: () => ({ children: [] }), insert: (node, parent) => { node.parent = parent; parent.children.push(node) }, remove: () => {}, setText: () => {}, setElementText: () => {}, patchProp: () => {}, parentNode: node => node.parent || null, nextSibling: () => null })
const original = new Map<string, PropertyDescriptor | undefined>()
function global(name: string, value: unknown) { original.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, writable: true, value }) }
let app: App<Node>, state: ReturnType<typeof useTaskNotifications>, permissionRequests: number, tones: number, desktopCalls: unknown[], targets: unknown[], data: Map<string, string>, focused: boolean
class FakeNotification {
  static permission: NotificationPermission = 'default'
  static async requestPermission() { permissionRequests++; return FakeNotification.permission = 'granted' }
  onclick?: () => void; onclose?: () => void; onerror?: () => void
  constructor(title: string, options: NotificationOptions) { desktopCalls.push({ title, options, instance: this }) }
  close() { this.onclose?.() }
}
class FakeAudio {
  state = 'running'; currentTime = 0; destination = {}
  async resume() { this.state = 'running' }
  async close() { this.state = 'closed' }
  createOscillator() { return { type: '', frequency: { value: 0 }, connect() {}, disconnect() {}, start() { tones++ }, stop() {}, onended: null } }
  createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} } }
}
const task = (id = 'one'): TaskNotice => ({ id, kind: 'completed', deviceId: 'device', deviceName: '设备', threadId: 'thread', threadName: '任务' })
beforeEach(() => {
  permissionRequests = 0; tones = 0; desktopCalls = []; targets = []; data = new Map(); focused = true; FakeNotification.permission = 'default'
  const win = Object.assign(new EventTarget(), { isSecureContext: true, AudioContext: FakeAudio, focus() {} })
  global('window', win); global('Notification', FakeNotification); global('AudioContext', FakeAudio)
  global('document', { visibilityState: 'visible', hasFocus: () => focused }); global('location', { href: 'https://example.test/' })
  global('navigator', { locks: { request: async (_name: string, fn: () => Promise<void>) => fn() } })
  global('localStorage', { getItem: (k: string) => data.get(k) || null, setItem: (k: string, v: string) => { data.set(k, v) } })
  app = renderer.createApp({ setup() { state = useTaskNotifications(target => targets.push(target)); return () => null } }); app.mount({ children: [] })
})
afterEach(() => { app.unmount(); for (const [name, descriptor] of original) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name) } original.clear() })
test('never prompts on mount or task events; explicit enable requests permission once', async () => {
  await state.notify(task()); expect(permissionRequests).toBe(0); expect(desktopCalls).toHaveLength(0)
  await state.setDesktop(true); expect(permissionRequests).toBe(1); expect(state.preferences.value.desktop).toBe(true)
  await state.notify(task('next')); expect(desktopCalls).toHaveLength(1); expect(tones).toBe(2)
  await state.notify(task('next')); expect(desktopCalls).toHaveLength(1); expect(tones).toBe(2)
})

test('sound works independently of desktop notifications and persists volume settings', async () => {
  state.update({ desktop: false, volume: 25 }); await state.unlockAudio(); await state.notify(task())
  expect(tones).toBe(2); expect(desktopCalls).toHaveLength(0)
  await nextTick(); expect(JSON.parse(data.get(NOTIFICATION_KEY)!)).toMatchObject({ volume: 25, desktop: false })
  state.update({ sound: false }); await state.notify(task('quiet')); expect(tones).toBe(2)
})

test('background filtering and per-event settings apply before delivery', async () => {
  await state.setDesktop(true); state.update({ backgroundOnly: true }); await state.notify(task()); expect(desktopCalls).toHaveLength(0)
  focused = false; await state.notify(task()); expect(desktopCalls).toHaveLength(1)
  state.update({ completed: false }); await state.notify(task('disabled-kind')); expect(desktopCalls).toHaveLength(1)
})
test('clicking a browser notification opens only its associated device and thread', async () => {
  await state.setDesktop(true); await state.notify(task())
  ;(desktopCalls[0] as { instance: FakeNotification }).instance.onclick?.()
  expect(targets).toEqual([{ deviceId: 'device', threadId: 'thread' }])
})

test('disposal suppresses late desktop delivery without breaking the task', async () => {
  let release: (() => void) | undefined
  Object.assign(navigator, { serviceWorker: Object.assign(new EventTarget(), { getRegistration: () => new Promise(resolve => { release = () => resolve({ active: {}, showNotification: async () => desktopCalls.push('late') }) }) }) })
  await state.setDesktop(true); const sending = state.notify(task()); await nextTick(); app.unmount(); release?.(); await sending
  expect(desktopCalls).toHaveLength(0)
})
