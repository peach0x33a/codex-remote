import type { Item, RpcMessage } from '../../shared/protocol'
import { pendingAsyncQuestions } from './async-questions'
export type NoticeKind = 'attention' | 'completed' | 'failed'
export type NoticeTarget = { deviceId: string; threadId: string }
export type TaskNotice = NoticeTarget & { id: string; kind: NoticeKind; deviceName: string; threadName: string }
export type NotificationPreferences = { desktop: boolean; sound: boolean; volume: number; backgroundOnly: boolean; attention: boolean; completed: boolean; failed: boolean }
export const NOTIFICATION_KEY = 'codex-remote.notifications.v1'
export const NOTICE_TITLES: Record<NoticeKind, string> = { attention: '需要你处理', completed: '对话已完成', failed: '请求失败' }
export const DEFAULT_NOTIFICATIONS: NotificationPreferences = { desktop: false, sound: true, volume: 40, backgroundOnly: false, attention: true, completed: true, failed: true }
export function normalizeNotifications(value: unknown): NotificationPreferences {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const result = { ...DEFAULT_NOTIFICATIONS }
  for (const key of ['desktop', 'sound', 'backgroundOnly', 'attention', 'completed', 'failed'] as const) if (typeof input[key] === 'boolean') result[key] = input[key]
  if (typeof input.volume === 'number' && Number.isFinite(input.volume)) result.volume = Math.round(Math.max(0, Math.min(100, input.volume)))
  return result
}
export function readNotificationPreferences(storage?: Pick<Storage, 'getItem'>) {
  try { return normalizeNotifications(JSON.parse(storage?.getItem(NOTIFICATION_KEY) || '{}')) } catch { return { ...DEFAULT_NOTIFICATIONS } }
}
export function validNoticeTarget(value: unknown): value is NoticeTarget {
  if (!value || typeof value !== 'object') return false
  const target = value as NoticeTarget
  return typeof target.deviceId === 'string' && !!target.deviceId && target.deviceId.length < 512 && typeof target.threadId === 'string' && target.threadId.length < 512
}
export function taskNoticeFromMessage(message: RpcMessage, device: { id: string; name: string }, threadName: (id: string) => string): TaskNotice | undefined {
  const method = message.method, p = message.params || {}, threadId = p.threadId
  if (!device.id || typeof threadId !== 'string' || !threadId) return
  let kind: NoticeKind, eventKey: string
  if (message.id !== undefined && ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'item/permissions/requestApproval', 'item/tool/requestUserInput', 'tool/requestUserInput'].includes(method || '')) {
    kind = 'attention'; eventKey = JSON.stringify(['attention', p.turnId, p.itemId ?? message.id, method])
  } else if (method === 'item/completed' && p.item && pendingAsyncQuestions([p.item as Item]).length) {
    kind = 'attention'; eventKey = JSON.stringify(['async-question', p.turnId, (p.item as Item).id])
  } else if (method === 'turn/completed') {
    const turn = p.turn as { id?: string; status?: string } | undefined
    if (!turn?.id || !['completed', 'failed'].includes(turn.status || '')) return
    kind = turn.status === 'failed' ? 'failed' : 'completed'; eventKey = 'terminal/' + turn.id
  } else if (method === 'error' && p.willRetry !== true && typeof p.turnId === 'string') {
    kind = 'failed'; eventKey = 'terminal/' + p.turnId
  } else return
  return { id: JSON.stringify([device.id, threadId, eventKey]), kind, deviceId: device.id, deviceName: device.name, threadId, threadName: threadName(threadId) }
}
export function shouldNotify(preferences: NotificationPreferences, notice: TaskNotice, foreground: boolean) {
  return preferences[notice.kind] && (preferences.desktop || preferences.sound && preferences.volume > 0) && (!preferences.backgroundOnly || !foreground)
}
// A shared lock in the browser serializes this check across tabs. Storage is bounded;
// a page-local set still suppresses replayed events when storage is unavailable.
export function createNoticeGate(storage?: Pick<Storage, 'getItem' | 'setItem'>, now = Date.now) {
  const seen = new Set<string>(), key = NOTIFICATION_KEY + '.seen'
  return (id: string) => {
    if (seen.has(id)) return false
    const time = now()
    let entries: [string, number][] = []
    try { const value: unknown = JSON.parse(storage?.getItem(key) || '[]'); if (Array.isArray(value)) entries = value.filter((row): row is [string, number] => Array.isArray(row) && typeof row[0] === 'string' && typeof row[1] === 'number' && row[1] > time - 86_400_000).slice(-127) } catch { /* private mode */ }
    seen.add(id); if (seen.size > 512) seen.delete(seen.values().next().value!)
    if (entries.some(row => row[0] === id)) return false
    try { storage?.setItem(key, JSON.stringify([...entries, [id, time]])) } catch { /* retain page-local deduplication */ }
    return true
  }
}
