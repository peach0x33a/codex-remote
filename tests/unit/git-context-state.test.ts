import { afterEach, describe, expect, test } from 'bun:test'
import { createRenderer, nextTick, ref, type App } from 'vue'
import { useGitContext } from '../../src/composables/useGitContext'
import type { GitRun } from '../../src/lib/git-context'

type Host = { children: Host[]; parent?: Host }
const renderer = createRenderer<Host, Host>({
  createElement: () => ({ children: [] }), createText: () => ({ children: [] }), createComment: () => ({ children: [] }),
  insert: (node, parent) => { node.parent = parent; parent.children.push(node) },
  remove: node => { if (node.parent) node.parent.children = node.parent.children.filter(child => child !== node) },
  setText: () => {}, setElementText: () => {}, patchProp: () => {},
  parentNode: node => node.parent || null, nextSibling: () => null,
})
const apps = new Set<App<Host>>()
afterEach(() => { for (const app of apps) app.unmount(); apps.clear() })

type Call = { cwd: string; signal?: AbortSignal; resolve: (branch: string | null) => void }
function setup(initial = { cwd: '/work/a', connected: true }) {
  const cwd = ref(initial.cwd), deviceId = ref('one'), connected = ref(initial.connected), busy = ref(false)
  const calls: Call[] = []
  const run: GitRun = (params, options) => new Promise(resolve => {
    const args = (params.command as string[])
    const call: Call = { cwd: String(params.cwd), signal: options?.signal, resolve: branch => resolve(
      args.includes('symbolic-ref') ? { exitCode: branch ? 0 : 1, stdout: branch ? 'refs/heads/' + branch + '\n' : '' }
        : branch === null ? { exitCode: 128, stdout: '' } : { exitCode: 0, stdout: 'true\n.git\n.git\n' + String(params.cwd) + '\n' }) }
    calls.push(call)
  })
  let result!: ReturnType<typeof useGitContext>
  const app = renderer.createApp({ setup() { result = useGitContext({ cwd, deviceId, connected, busy, run }); return () => null } })
  apps.add(app); app.mount({ children: [] })
  const settle = async (branch: string | null, from = 0) => { for (const call of calls.splice(from)) call.resolve(branch); await new Promise(r => setTimeout(r, 0)); await nextTick() }
  return { ...result, cwd, deviceId, connected, busy, calls, settle }
}

describe('useGitContext', () => {
  test('reads the branch for the current directory on mount', async () => {
    const view = setup()
    expect(view.context.value).toBeNull()
    await view.settle('main')
    expect(view.context.value).toMatchObject({ branch: 'main', linked: false })
  })

  test('does not run while disconnected or without a directory, and runs once connected', async () => {
    const view = setup({ cwd: '/work/a', connected: false })
    expect(view.calls).toHaveLength(0)
    view.connected.value = true
    expect(view.calls.length).toBeGreaterThan(0)
    view.cwd.value = ''
    await view.settle('main')
    expect(view.context.value).toBeNull()
  })

  test('clears immediately on directory or device change and ignores the superseded read', async () => {
    const view = setup()
    await view.settle('main')
    view.cwd.value = '/work/b'
    expect(view.context.value).toBeNull()
    const stale = view.calls.length
    view.deviceId.value = 'two'
    expect(view.calls.slice(0, stale).every(call => call.signal?.aborted)).toBe(true)
    const staleCalls = view.calls.splice(0, stale)
    await view.settle('fresh')
    for (const call of staleCalls) call.resolve('stale')
    await new Promise(r => setTimeout(r, 0))
    expect(view.context.value).toMatchObject({ branch: 'fresh' })
  })

  test('refreshes when a running turn finishes, but not when one starts', async () => {
    const view = setup()
    await view.settle('main')
    view.busy.value = true; await nextTick()
    expect(view.calls).toHaveLength(0)
    view.busy.value = false; await nextTick()
    expect(view.calls.length).toBeGreaterThan(0)
    await view.settle('switched')
    expect(view.context.value).toMatchObject({ branch: 'switched' })
  })

  test('shows no context for a non-Git directory and recovers after a failed read', async () => {
    const view = setup()
    await view.settle(null)
    expect(view.context.value).toBeNull()
    view.cwd.value = '/work/repo'
    await view.settle('main')
    expect(view.context.value).toMatchObject({ branch: 'main' })
  })

  test('aborts an in-flight read when the owner scope is disposed', async () => {
    const view = setup()
    const pending = [...view.calls]
    for (const app of apps) app.unmount()
    apps.clear()
    expect(pending.every(call => call.signal?.aborted)).toBe(true)
  })
})
