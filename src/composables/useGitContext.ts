import { onScopeDispose, shallowRef, watch, type Ref } from 'vue'
import { readGitContext, type GitContext, type GitRun } from '../lib/git-context'

export function useGitContext(options: { cwd: Ref<string>; deviceId: Ref<string>; connected: Ref<boolean>; busy: Ref<boolean>; run: GitRun }) {
  const context = shallowRef<GitContext | null>(null)
  let controller: AbortController | undefined, generation = 0
  function stop() { generation++; controller?.abort(); controller = undefined }
  async function refresh() {
    stop()
    const cwd = options.cwd.value
    if (!options.connected.value || !cwd) return
    const mine = generation, abort = controller = new AbortController()
    let next: GitContext | null = null
    try { next = await readGitContext(options.run, cwd, abort.signal) } catch { next = null }
    if (mine === generation) context.value = next
  }
  watch([options.cwd, options.deviceId, options.connected], () => { context.value = null; void refresh() }, { flush: 'sync', immediate: true })
  watch(options.busy, busy => { if (!busy) void refresh() })
  onScopeDispose(stop)
  return { context, refresh }
}
