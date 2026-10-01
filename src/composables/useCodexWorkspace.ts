import { computed, effectScope, getCurrentInstance, getCurrentScope, isReadonly, isRef, onMounted, onScopeDispose, ref, shallowReactive, watch, type EffectScope, type Ref } from 'vue'
import type { ConnectionProfile } from '../../shared/protocol'
import { readUiPreferences } from '../lib/ui-preferences'
import type { TaskNotice } from '../lib/task-notifications'
import { useCodex } from './useCodex'

type Runtime = ReturnType<typeof useCodex>
type Entry = { runtime: Runtime; scope: EffectScope; connecting?: Promise<void> }
export type DeviceConnectionState = { status: Runtime['status']['value']; busy: boolean; approvals: number }

/** One metadata/session owner, independent transports, and a stable selected-device facade. */
export function useCodexWorkspace(options: { autoConnect?: boolean; deferLifecycle?: boolean } = {}) {
  let storage: Storage | undefined
  try { storage = localStorage } catch { /* useCodex reports unavailable storage. */ }
  const metadataScope = effectScope(true)
  const metadata = metadataScope.run(() => useCodex({ autoConnect: false, deferLifecycle: true }))!
  const entries = shallowReactive(new Map<string, Entry>())
  const listeners = new Set<(notice: TaskNotice) => void>(), sessionTokens = new Map<string, string>()
  const profileWriting = ref(false), loggingOut = ref(false)
  let disposed = false, started = false, sessionReady = false, selectionDirty = false
  let startupPending = options.autoConnect !== false, starting: Promise<void> | undefined
  let selectionVersion = 0, selectionIntent = metadata.selectedId.value
  const selectedId = computed({
    get: () => metadata.selectedId.value,
    set: (id: string) => { selectionVersion++; selectionIntent = id; metadata.selectedId.value = id },
  })

  function persistSelection() {
    if (disposed) return
    if (profileWriting.value) { selectionDirty = true; return }
    metadata.persistSelection()
  }
  function emitNotice(notice: TaskNotice) {
    if (disposed) return
    for (const listener of listeners) { try { listener(notice) } catch { /* Keep other devices and listeners running. */ } }
  }
  function ensureRuntime(profile: ConnectionProfile): Entry {
    if (disposed) throw new Error('工作区已关闭。')
    const existing = entries.get(profile.id)
    if (existing) return existing
    const scope = effectScope(true)
    const runtime = scope.run(() => {
      const child = useCodex({ autoConnect: false, persistConnection: false, deferLifecycle: true })
      child.profiles.value = [profile]; child.selectedId.value = profile.id
      child.authenticated.value = metadata.authenticated.value
      onScopeDispose(child.onTaskNotice(emitNotice))
      watch(child.authenticated, value => { if (!value && !disposed && !loggingOut.value) metadata.authenticated.value = false }, { flush: 'sync' })
      return child
    })!
    const entry = { runtime, scope }
    entries.set(profile.id, entry)
    if (started) void runtime.start({ checkSession: false })
    return entry
  }
  function ensureSelected() {
    const profile = metadata.selected.value
    if (profile && !disposed) ensureRuntime(profile)
  }
  function disconnectEntry(entry: Entry, keepThread = false) { entry.connecting = undefined; entry.runtime.disconnect(keepThread) }
  function disconnectAll() { for (const entry of entries.values()) disconnectEntry(entry) }
  const selectedRuntime = computed(() => entries.get(metadata.selectedId.value)?.runtime || metadata)
  const tokenFor = (id: string) => sessionTokens.get(id) ?? metadata.tokenFor(id)

  async function connectDevice(profile: ConnectionProfile, reconnecting = false, token?: string) {
    if (disposed || loggingOut.value) return
    startupPending = false
    const canonical = metadata.profiles.value.find(item => item.id === profile.id) || profile
    const entry = ensureRuntime(canonical), runtime = entry.runtime
    const changedToken = token !== undefined && token !== tokenFor(profile.id)
    if (token !== undefined) sessionTokens.set(profile.id, token)
    selectedId.value = profile.id
    // Selection must not reset an already-connected device's conversation or settings.
    if (!reconnecting && !changedToken && runtime.connected.value) return
    if (!changedToken && entry.connecting) return entry.connecting
    if (!reconnecting && !changedToken && runtime.status.value === 'reconnecting') return
    const operation = reconnecting && !changedToken && runtime.tokenFor(profile.id) === tokenFor(profile.id)
      ? runtime.connect(canonical, true)
      : runtime.connectWithToken(canonical, tokenFor(profile.id))
    entry.connecting = operation
    try { await operation }
    finally { if (entry.connecting === operation) entry.connecting = undefined }
  }
  const connect: Runtime['connect'] = (profile, reconnecting = false) => connectDevice(profile, reconnecting)
  const connectWithToken: Runtime['connectWithToken'] = (profile, token) => connectDevice(profile, false, token)
  function disconnect(keepThread = false) {
    startupPending = false
    const entry = entries.get(metadata.selectedId.value)
    if (entry) disconnectEntry(entry, keepThread)
    else metadata.disconnect(keepThread)
  }
  function disconnectDevice(id: string) {
    if (id === metadata.selectedId.value) startupPending = false
    const entry = entries.get(id)
    if (entry) disconnectEntry(entry)
  }

  async function saveProfile(input: Parameters<Runtime['saveProfile']>[0]) {
    if (disposed || loggingOut.value) throw new Error('工作区当前不可保存连接。')
    if (profileWriting.value) throw new Error('正在保存连接，请稍候。')
    const old = metadata.profiles.value.find(profile => profile.id === input.id), oldToken = old ? tokenFor(old.id) : ''
    profileWriting.value = true
    try {
      // The server commits metadata and credentials in one transaction.
      const profile = await metadata.saveProfile(input)
      sessionTokens.delete(profile.id)
      if (disposed) return profile
      const entry = entries.get(profile.id)
      if (entry && old && (old.endpoint !== profile.endpoint || old.credentialId !== profile.credentialId || (!profile.credentialId && oldToken !== metadata.tokenFor(profile.id)))) disconnectEntry(entry)
      return profile
    } finally {
      profileWriting.value = false
      if (selectionDirty) { selectionDirty = false; persistSelection() }
    }
  }
  async function removeProfile(id: string) {
    if (disposed || loggingOut.value) throw new Error('工作区当前不可移除连接。')
    if (profileWriting.value) throw new Error('正在保存连接，请稍候。')
    if (entries.get(id)?.runtime.queuedMessages.value.length) throw new Error('该设备还有待发送消息，请先发送或移除队列。')
    const selectedVersion = selectionVersion
    profileWriting.value = true
    try {
      const removed = await metadata.removeProfile(id)
      if (removed) { entries.get(id)?.scope.stop(); entries.delete(id); sessionTokens.delete(id) }
      // Credential deletion can finish after the user selects a different device.
      if (!disposed && selectionVersion !== selectedVersion && metadata.profiles.value.some(profile => profile.id === selectionIntent)) metadata.selectedId.value = selectionIntent
      return removed
    } finally {
      profileWriting.value = false
      if (selectionDirty) { selectionDirty = false; persistSelection() }
    }
  }
  async function login(key: string) {
    if (disposed || loggingOut.value) return
    await metadata.login(key)
    if (!disposed) maybeConnectOnStartup()
  }
  async function logout() {
    if (disposed || loggingOut.value) return
    if (profileWriting.value) throw new Error('正在保存连接，请稍候再退出。')
    startupPending = false; loggingOut.value = true
    disconnectAll()
    try {
      await metadata.logout()
      sessionTokens.clear()
    } finally { loggingOut.value = false }
  }
  function maybeConnectOnStartup() {
    if (disposed || !sessionReady || !startupPending || !readUiPreferences(storage).autoConnect || !metadata.authenticated.value || !metadata.bridgeReachable.value || !metadata.online.value || !metadata.selected.value) return
    startupPending = false
    void connect(metadata.selected.value)
  }
  function start() {
    if (disposed) return Promise.resolve()
    if (!starting) {
      started = true
      starting = metadata.start().then(() => {
        if (disposed) return
        sessionReady = true
        for (const { runtime } of entries.values()) void runtime.start({ checkSession: false })
        maybeConnectOnStartup()
      })
    }
    return starting
  }
  function dispose() {
    if (disposed) return
    disposed = true; startupPending = false
    for (const entry of entries.values()) entry.scope.stop()
    entries.clear(); metadataScope.stop(); sessionTokens.clear(); listeners.clear()
  }
  function onTaskNotice(listener: (notice: TaskNotice) => void) { listeners.add(listener); return () => { listeners.delete(listener) } }

  metadataScope.run(() => {
    watch(metadata.selectedId, () => { ensureSelected(); persistSelection() }, { flush: 'sync' })
    watch(metadata.profiles, profiles => {
      for (const [id, entry] of entries) {
        const profile = profiles.find(item => item.id === id)
        if (!profile) { entry.scope.stop(); entries.delete(id); sessionTokens.delete(id); continue }
        const old = entry.runtime.selected.value
        if (old && (old.endpoint !== profile.endpoint || old.credentialId !== profile.credentialId)) { disconnectEntry(entry); sessionTokens.delete(id) }
        if (JSON.stringify(old) !== JSON.stringify(profile)) entry.runtime.profiles.value = [profile]
      }
      ensureSelected()
    }, { deep: true, flush: 'sync' })
    watch(metadata.authenticated, value => {
      if (disposed) return
      if (!value) disconnectAll()
      for (const { runtime } of entries.values()) runtime.authenticated.value = value
    }, { flush: 'sync' })
    watch([metadata.authenticated, metadata.bridgeReachable, metadata.online], maybeConnectOnStartup, { flush: 'post' })
  })
  ensureSelected()

  // These wrappers stay stable when App destructures them. Each call/ref lookup
  // captures the selected runtime; an awaited response never changes selection.
  const facade = Object.fromEntries(Object.entries(metadata).map(([key, value]) => {
    const target = () => selectedRuntime.value[key as keyof Runtime]
    if (isRef(value)) {
      const get = () => (target() as Ref).value
      return [key, isReadonly(value) ? computed(get) : computed({ get, set: next => { (target() as Ref).value = next } })]
    }
    return [key, (...args: unknown[]) => {
      if (disposed) throw new Error('工作区已关闭。')
      return (target() as (...args: unknown[]) => unknown)(...args)
    }]
  })) as Runtime
  function deviceBusy(runtime: Runtime) {
    return runtime.busy.value || runtime.sending.value || runtime.steering.value || runtime.revising.value || runtime.goalSaving.value || !!runtime.pendingSteers.value.length
      || runtime.threads.value.some(thread => thread.status?.type === 'active') || runtime.projectThreads.value.some(thread => thread.status?.type === 'active')
  }
  const connectionStates = computed<Record<string, DeviceConnectionState>>(() => {
    const ids = new Set([...metadata.profiles.value.map(profile => profile.id), ...entries.keys()])
    return Object.fromEntries([...ids].map(id => {
      const runtime = entries.get(id)?.runtime
      return [id, { status: runtime?.status.value || 'disconnected', busy: runtime ? deviceBusy(runtime) : false, approvals: runtime?.approvals.value.length || 0 }]
    }))
  })
  const queuedMessages = computed(() => [...entries.values()].flatMap(entry => entry.runtime.queuedMessages.value))
  const anyBusy = computed(() => profileWriting.value || loggingOut.value || !!queuedMessages.value.length || Object.values(connectionStates.value).some(state => state.busy || state.approvals > 0))
  const selected = computed(() => metadata.selected.value || entries.get(metadata.selectedId.value)?.runtime.selected.value)
  const notice = computed({ get: () => metadata.notice.value || selectedRuntime.value.notice.value, set: value => { metadata.notice.value = ''; selectedRuntime.value.notice.value = value } })
  const error = computed({ get: () => selectedRuntime.value.error.value || metadata.error.value, set: value => { metadata.error.value = ''; selectedRuntime.value.error.value = value } })
  if (getCurrentScope()) onScopeDispose(dispose)
  if (!options.deferLifecycle) {
    if (getCurrentInstance()) onMounted(() => { void start() })
    else void start()
  }
  return Object.assign(facade, {
    profiles: metadata.profiles, profilesLoaded: metadata.profilesLoaded, refreshProfiles: metadata.refreshProfiles, selectedId, selected,
    online: metadata.online, bridgeReachable: metadata.bridgeReachable, authenticated: metadata.authenticated, requiresKey: metadata.requiresKey,
    notice, error, queuedMessages, connectionStates, anyBusy,
    connect, connectWithToken, disconnect, disconnectDevice, saveProfile, removeProfile, tokenFor, login, logout, onTaskNotice, start, dispose,
  })
}
