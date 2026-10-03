import { onScopeDispose, watch } from 'vue'
import type { useCodexWorkspace } from './useCodexWorkspace'
import type { NoticeTarget } from '../lib/task-notifications'
import { sessionLocation } from '../lib/session-url'

export function useSessionUrl(codex: ReturnType<typeof useCodexWorkspace>, initial: NoticeTarget | undefined, blocked: () => boolean) {
  let pending = initial, restoring = false, holdUrl = !!initial, disposed = false, generation = 0
  function sync() {
    if (holdUrl && !pending && !restoring && !codex.loadingThread.value && !codex.threadLoadError.value && codex.selectedId.value === initial?.deviceId && codex.active.value?.id === initial?.threadId) holdUrl = false
    if (disposed || holdUrl || pending || restoring || !codex.authenticated.value || !codex.profilesLoaded.value || codex.loadingThread.value || codex.threadLoadError.value) return
    const threadId = codex.active.value?.id
    if (threadId?.startsWith('pending-thread-')) return
    const target = threadId && codex.selectedId.value ? { deviceId: codex.selectedId.value, threadId } : undefined
    const url = sessionLocation(location.href, target)
    if (url.href !== location.href) history.replaceState(history.state, '', url)
  }
  async function restore() {
    if (disposed || !pending || restoring || !codex.authenticated.value || !codex.profilesLoaded.value || blocked()) return
    const target = pending, ticket = generation
    const current = () => !disposed && ticket === generation && pending === target
    const profile = codex.profiles.value.find(profile => profile.id === target.deviceId)
    if (!profile) { pending = undefined; codex.toast('链接对应的设备已不存在，请选择设备后打开会话。'); return }
    restoring = true
    try {
      await codex.connect(profile)
      if (!current() || codex.selectedId.value !== target.deviceId || !codex.connected.value) return
      await codex.openThread(target.threadId)
      if (current() && codex.active.value?.id === target.threadId && !codex.threadLoadError.value) {
        pending = undefined; restoring = false; holdUrl = false; sync()
      }
    } catch (cause) { if (current()) codex.toast(cause instanceof Error ? cause.message : '无法恢复链接中的会话。') }
    finally { if (ticket === generation) { restoring = false; if (codex.authenticated.value) pending = undefined } }
  }
  function cancelRestore() {
    generation++; pending = undefined; restoring = false; holdUrl = false
    // A same-device action may leave both watched IDs unchanged.
    queueMicrotask(sync)
  }
  watch([codex.authenticated, codex.profilesLoaded, blocked], () => { void restore() }, { immediate: true })
  watch([codex.selectedId, () => codex.active.value?.id, codex.loadingThread], sync, { flush: 'post' })
  onScopeDispose(() => { disposed = true; generation++ })
  return { cancelRestore, sync }
}
