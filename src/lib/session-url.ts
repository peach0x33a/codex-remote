import type { NoticeTarget } from './task-notifications'

const validId = (value: string | null): value is string => !!value && value.length < 512 && !/[\s\x00-\x1f\x7f]/.test(value)
export function readSessionTarget(url: URL): NoticeTarget | undefined {
  const deviceId = url.searchParams.get('device'), threadId = url.searchParams.get('thread')
  return validId(deviceId) && validId(threadId) && !threadId.startsWith('pending-thread-') ? { deviceId, threadId } : undefined
}

/** Persist identifiers only; endpoints and credentials never enter this URL. */
export function sessionLocation(base: string, target?: NoticeTarget): URL {
  const url = new URL(base)
  for (const key of ['device', 'thread', 'notificationDevice', 'notificationThread']) url.searchParams.delete(key)
  if (target) { url.searchParams.set('device', target.deviceId); url.searchParams.set('thread', target.threadId) }
  return url
}
