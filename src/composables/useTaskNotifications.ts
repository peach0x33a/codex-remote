import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { createNoticeGate, normalizeNotifications, readNotificationPreferences, shouldNotify, validNoticeTarget, NOTICE_TITLES, NOTIFICATION_KEY, type NoticeKind, type NoticeTarget, type TaskNotice, type NotificationPreferences } from '../lib/task-notifications'
export function useTaskNotifications(openTarget: (target: NoticeTarget) => void) {
  let storage: Storage | undefined
  try { storage = localStorage } catch { /* private mode */ }
  const preferences = ref(readNotificationPreferences(storage)), error = ref(''), requesting = ref(false)
  const supported = typeof Notification !== 'undefined' && window.isSecureContext
  const permission = ref<NotificationPermission | 'unsupported'>(supported ? Notification.permission : 'unsupported')
  const soundSupported = typeof AudioContext !== 'undefined' || !!(window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  const soundReady = ref(false)
  const volumePreview = ref<number | null>(null)
  const effectiveVolume = computed(() => volumePreview.value ?? preferences.value.volume)
  let previewTimer: ReturnType<typeof setTimeout> | undefined
  function previewVolume(value: number | null) {
    clearTimeout(previewTimer)
    volumePreview.value = value === null || !Number.isFinite(value) ? null : Math.max(0, Math.min(100, value))
    if (volumePreview.value !== null && preferences.value.sound) previewTimer = setTimeout(() => { if (!disposed && volumePreview.value !== null) playSound('completed') }, 180)
  }
  let audio: AudioContext | undefined, disposed = false, lastSound = 0
  const claim = createNoticeGate(storage), activeNotifications = new Set<Notification>()
  const permissionLabel = computed(() => ({ granted: '已允许', denied: '已被浏览器阻止', default: '尚未授权', unsupported: '需要 HTTPS 或支持通知的浏览器' }[permission.value]))
  function update(patch: Partial<NotificationPreferences>) { preferences.value = normalizeNotifications({ ...preferences.value, ...patch }) }
  function refreshPermission() { permission.value = supported ? Notification.permission : 'unsupported' }
  async function unlockAudio() {
    if (disposed || !soundSupported || !preferences.value.sound) return
    try {
      const Audio = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext!
      audio ||= new Audio()
      if (audio.state === 'suspended') await audio.resume()
      if (!disposed) soundReady.value = audio.state === 'running'
    } catch { soundReady.value = false }
  }
  async function setDesktop(enabled: boolean) {
    if (!enabled) { update({ desktop: false }); return }
    if (requesting.value || !supported) return
    requesting.value = true; error.value = ''
    void unlockAudio()
    try {
      const result = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission
      if (disposed) return
      permission.value = result; update({ desktop: result === 'granted' })
      if (result === 'denied') error.value = '请在浏览器的站点设置中允许通知，然后重新启用。'
    } catch { if (!disposed) error.value = '无法请求通知权限，请检查浏览器设置。' }
    finally { if (!disposed) requesting.value = false }
  }
  function playSound(kind: NoticeKind, force = false) {
    if (!audio || audio.state !== 'running' || !preferences.value.sound || effectiveVolume.value === 0) return false
    const now = Date.now()
    if (!force && now - lastSound < 700) return true
    lastSound = now
    const frequencies = { attention: [740, 740], completed: [523, 784], failed: [440, 330] }[kind]
    frequencies.forEach((frequency, index) => {
      const oscillator = audio!.createOscillator(), gain = audio!.createGain(), start = audio!.currentTime + index * .16
      oscillator.type = 'sine'; oscillator.frequency.value = frequency
      gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(effectiveVolume.value / 100 * .12, start + .012); gain.gain.exponentialRampToValueAtTime(.0001, start + .14)
      oscillator.connect(gain); gain.connect(audio!.destination)
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect() }
      oscillator.start(start); oscillator.stop(start + .15)
    })
    return true
  }
  async function showDesktop(notice: TaskNotice) {
    if (!preferences.value.desktop || permission.value !== 'granted' || disposed) return false
    const target = { deviceId: notice.deviceId, threadId: notice.threadId }
    const options: NotificationOptions = { body: [notice.deviceName, notice.threadName].filter(Boolean).join(' · '), tag: notice.id, icon: '/icons/icon-192.png', silent: true, data: { type: 'codex-task', ...target } }
    try {
      const registration = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined
      if (disposed || !preferences.value.desktop) return false
      if (registration?.active) await registration.showNotification(NOTICE_TITLES[notice.kind], options)
      else {
        const notification = new Notification(NOTICE_TITLES[notice.kind], options)
        activeNotifications.add(notification)
        notification.onclick = () => { notification.close(); window.focus(); if (validNoticeTarget(target)) openTarget(target) }
        notification.onclose = () => activeNotifications.delete(notification)
        notification.onerror = () => { error.value = '浏览器未能显示通知，请检查站点权限。' }
      }
      return true
    } catch { if (!disposed) error.value = '浏览器未能显示通知，请检查站点权限及系统通知设置。'; return false }
  }
  async function notify(notice: TaskNotice) {
    if (disposed || !shouldNotify(preferences.value, notice, document.visibilityState === 'visible' && document.hasFocus())) return
    const deliver = async () => {
      if (disposed || !shouldNotify(preferences.value, notice, document.visibilityState === 'visible' && document.hasFocus()) || !claim(notice.id)) return
      refreshPermission(); playSound(notice.kind); await showDesktop(notice)
    }
    try { if (navigator.locks?.request) await navigator.locks.request('codex-remote-task-notifications', deliver); else await deliver() }
    catch { if (!disposed) error.value = '通知发送失败。' }
  }
  async function test() {
    error.value = ''
    await unlockAudio()
    const sounded = playSound('completed', true)
    refreshPermission()
    const shown = await showDesktop({ id: 'codex-notification-test', kind: 'completed', deviceId: '', threadId: '', deviceName: 'Codex Remote', threadName: '这是一条测试通知' })
    if (!shown && !sounded && !error.value) error.value = '请先启用浏览器通知或通知音效。'
  }
  function storageChanged(event: StorageEvent) { if (event.key === NOTIFICATION_KEY) preferences.value = readNotificationPreferences(storage) }
  function workerMessage(event: MessageEvent) { if (event.data?.type === 'codex-notification-open' && validNoticeTarget(event.data.target)) openTarget(event.data.target) }
  watch(preferences, value => { try { storage?.setItem(NOTIFICATION_KEY, JSON.stringify(value)) } catch { error.value = '通知设置无法持久保存，当前页面仍可使用。' } }, { deep: true })
  onMounted(() => {
    window.addEventListener('storage', storageChanged); window.addEventListener('focus', refreshPermission)
    window.addEventListener('pointerdown', unlockAudio, { passive: true }); window.addEventListener('keydown', unlockAudio)
    navigator.serviceWorker?.addEventListener('message', workerMessage)
    const url = new URL(location.href), deviceId = url.searchParams.get('notificationDevice'), threadId = url.searchParams.get('notificationThread')
    if (deviceId !== null && threadId !== null) {
      url.searchParams.delete('notificationDevice'); url.searchParams.delete('notificationThread'); history.replaceState(history.state, '', url)
      const target = { deviceId, threadId }; if (validNoticeTarget(target)) openTarget(target)
    }
  })
  onUnmounted(() => {
    clearTimeout(previewTimer)
    disposed = true; window.removeEventListener('storage', storageChanged); window.removeEventListener('focus', refreshPermission)
    window.removeEventListener('pointerdown', unlockAudio); window.removeEventListener('keydown', unlockAudio)
    navigator.serviceWorker?.removeEventListener('message', workerMessage)
    for (const notification of activeNotifications) notification.close()
    void audio?.close().catch(() => {})
  })
  return { preferences, permission, permissionLabel, soundSupported, soundReady, requesting, error, update, setDesktop, test, notify, unlockAudio, previewVolume, effectiveVolume }
}
export type TaskNotifications = ReturnType<typeof useTaskNotifications>
