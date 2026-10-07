import { computed, onScopeDispose, shallowRef, watch, type Ref } from 'vue'
import { latestGitCommand, normalizeGitCwd, readGitContext, type GitContext, type GitRun } from '../lib/git-context'
import type { Thread } from '../../shared/protocol'

export function useGitContext(options: { cwd: Ref<string>; thread: Ref<Thread | null>; deviceId: Ref<string>; connected: Ref<boolean>; busy: Ref<boolean>; run: GitRun }) {
  const context = shallowRef<GitContext | null>(null)
  const command = computed(() => latestGitCommand(options.thread.value))
  const commandCwd = computed(() => command.value?.cwd || '')
  const cwd = computed(() => commandCwd.value || normalizeGitCwd(options.cwd.value) || '')
  let controller: AbortController | undefined, generation = 0
  function stop() { generation++; controller?.abort(); controller = undefined }
  async function refresh() {
    stop()
    const directory = cwd.value
    if (!options.connected.value || !directory) return
    const mine = generation, abort = controller = new AbortController()
    let next: GitContext | null = null
    try { next = await readGitContext(options.run, directory, abort.signal) } catch { next = null }
    if (mine === generation) context.value = next
  }
  watch([options.cwd, options.deviceId, options.connected, () => options.thread.value?.id || '', cwd, () => command.value?.revision || ''], (values, previous) => {
    if (values.some((value, index) => index < 5 && value !== previous[index])) context.value = null
    void refresh()
  }, { flush: 'sync', immediate: true })
  watch(options.busy, busy => { if (!busy) void refresh() })
  onScopeDispose(stop)
  return { context, commandCwd, refresh }
}
