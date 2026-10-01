import { expect, test } from 'bun:test'
import { createNoticeGate, DEFAULT_NOTIFICATIONS, normalizeNotifications, shouldNotify, taskNoticeFromMessage, type TaskNotice } from '../../src/lib/task-notifications'
const device = { id: 'device', name: '设备' }
const notice: TaskNotice = { id: 'one', kind: 'completed', deviceId: 'device', deviceName: '设备', threadId: 'thread', threadName: '任务' }
const classify = (method: string, params: Record<string, unknown>, id?: number) => taskNoticeFromMessage({ method, params, ...(id === undefined ? {} : { id }) }, device, () => '任务')
test('permission requests and Ask trigger attention with stable item identity', () => {
  for (const method of ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'item/permissions/requestApproval', 'item/tool/requestUserInput', 'tool/requestUserInput']) {
    const first = classify(method, { threadId: 't', turnId: 'turn', itemId: 'item' }, 1)
    const replay = classify(method, { threadId: 't', turnId: 'turn', itemId: 'item' }, 2)
    expect(first?.kind).toBe('attention'); expect(replay?.id).toBe(first?.id)
  }
})
test('terminal errors and failed completion use one deduplication identity', () => {
  const error = classify('error', { threadId: 't', turnId: 'turn', willRetry: false, error: { message: '429' } })
  const completed = classify('turn/completed', { threadId: 't', turn: { id: 'turn', status: 'failed' } })
  expect(error?.kind).toBe('failed'); expect(error?.id).toBe(completed?.id)
  expect(classify('error', { threadId: 't', turnId: 'turn', willRetry: true })).toBeUndefined()
})
test('does not infer completion from idle, tool success, interrupted turns or history responses', () => {
  expect(classify('thread/status/changed', { threadId: 't', status: { type: 'idle' } })).toBeUndefined()
  expect(classify('item/completed', { threadId: 't', item: { type: 'commandExecution' } })).toBeUndefined()
  expect(classify('turn/completed', { threadId: 't', turn: { id: 'turn', status: 'interrupted' } })).toBeUndefined()
  expect(taskNoticeFromMessage({ id: 1, result: { thread: {} } }, device, () => '')).toBeUndefined()
  expect(classify('turn/completed', { threadId: 't', turn: { id: 'turn', status: 'completed' } })?.kind).toBe('completed')
})
test('deduplicates replayed events across page instances and keeps devices distinct', () => {
  const data = new Map<string, string>(), storage = { getItem: (k: string) => data.get(k) || null, setItem: (k: string, v: string) => { data.set(k, v) } }
  const first = createNoticeGate(storage, () => 100), second = createNoticeGate(storage, () => 100)
  expect(first('device/a')).toBe(true); expect(first('device/a')).toBe(false); expect(second('device/a')).toBe(false); expect(second('other/a')).toBe(true)
})
test('filters only the selected event kinds and respects background and mute settings', () => {
  expect(shouldNotify(DEFAULT_NOTIFICATIONS, notice, true)).toBe(true)
  expect(shouldNotify({ ...DEFAULT_NOTIFICATIONS, completed: false }, notice, false)).toBe(false)
  expect(shouldNotify({ ...DEFAULT_NOTIFICATIONS, backgroundOnly: true }, notice, true)).toBe(false)
  expect(shouldNotify({ ...DEFAULT_NOTIFICATIONS, backgroundOnly: true }, notice, false)).toBe(true)
  expect(shouldNotify({ ...DEFAULT_NOTIFICATIONS, sound: false }, notice, false)).toBe(false)
  expect(shouldNotify({ ...DEFAULT_NOTIFICATIONS, volume: 0 }, notice, false)).toBe(false)
})
test('normalizes invalid preferences without ever granting browser permission', () => {
  expect(normalizeNotifications(null)).toEqual(DEFAULT_NOTIFICATIONS)
  expect(normalizeNotifications({ desktop: 'granted', volume: 999 })).toMatchObject({ desktop: false, volume: 100 })
  expect(normalizeNotifications({ volume: NaN })).toMatchObject({ volume: 40 })
})
