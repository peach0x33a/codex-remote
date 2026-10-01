import { afterEach, beforeAll, expect, spyOn, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { compileScript, parse } from '@vue/compiler-sfc'
import { createRenderer, h, nextTick, reactive, type App, type Component } from 'vue'
import type { ThreadGoal, ThreadGoalUpdate } from '../../src/lib/thread-goal'

let GoalPanel: Component
beforeAll(async () => {
  const file = new URL('../../src/components/GoalPanel.vue', import.meta.url)
  const { descriptor } = parse(await Bun.file(file).text(), { filename: file.pathname })
  const script = compileScript(descriptor, { id: 'goal-panel-resume-test', inlineTemplate: true })
  // Exercise the real summary and event handlers without native dialogs or CSS transitions.
  const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(script.content)
    .replace(/import MotionCollapse from ["']\.\/MotionCollapse\.vue["'];?/, 'const MotionCollapse = { props: ["open"], setup: (props, { slots }) => () => props.open ? slots.default?.() : null };')
    .replace(/import BaseDialog from ["']\.\/BaseDialog\.vue["'];?/, 'const BaseDialog = { render: () => null };')
    .replace(/from (["'])([^"']+)\1/g, (_match, _quote, specifier: string) => 'from ' + JSON.stringify(specifier.startsWith('.') ? new URL(specifier + '.ts', file).href : import.meta.resolve(specifier)))
  const directory = await mkdtemp(join(tmpdir(), 'codex-goal-panel-resume-'))
  try {
    const path = join(directory, 'goal-panel.mjs')
    await Bun.write(path, js)
    GoalPanel = (await import(pathToFileURL(path).href)).default
  } finally { await rm(directory, { recursive: true, force: true }) }
})

type HostNode = { type: string; props: Record<string, any>; children: HostNode[]; parent?: HostNode; text?: string }
const node = (type: string): HostNode => ({ type, props: {}, children: [] })
const body = node('body')
const renderer = createRenderer<HostNode, HostNode>({
  createElement: node, createText: text => ({ ...node('#text'), text }), createComment: () => node('#comment'),
  patchProp: (node, key, _old, value) => { node.props[key] = value },
  setText: (node, text) => { node.text = text }, setElementText: (node, text) => { node.text = text; node.children = [] },
  insert: (node, parent, anchor) => {
    if (node.parent) node.parent.children = node.parent.children.filter(child => child !== node)
    node.parent = parent
    const index = anchor ? parent.children.indexOf(anchor) : -1
    if (index < 0) parent.children.push(node)
    else parent.children.splice(index, 0, node)
  },
  remove: node => { if (node.parent) node.parent.children = node.parent.children.filter(child => child !== node) },
  parentNode: node => node.parent || null, nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] || null,
  querySelector: selector => selector === 'body' ? body : null,
})
const all = (root: HostNode): HostNode[] => [root, ...root.children.flatMap(all)]
const apps: App<HostNode>[] = []
afterEach(async () => { for (const app of apps.splice(0)) app.unmount(); await nextTick() })

type PanelProps = {
  goal: ThreadGoal | null; scopeKey?: string; loading: boolean; saving: boolean
  error: string; supported: boolean | null; disabled: boolean; showSummary: boolean
  now?: number
}
const goalFixture = (patch: Partial<ThreadGoal> = {}): ThreadGoal => ({
  threadId: 'current-thread', objective: '继续现有任务', status: 'paused', tokenBudget: 4096,
  tokensUsed: 812, timeUsedSeconds: 23, createdAt: 1, updatedAt: 2, ...patch,
})
function mountPanel(patch: Partial<PanelProps> = {}, startRequest = false) {
  const props = reactive<PanelProps>({ goal: goalFixture(), scopeKey: 'current-thread', loading: false, saving: false, error: '', supported: true, disabled: false, showSummary: true, ...patch })
  const saves: ThreadGoalUpdate[] = [], root = node('root')
  let refreshes = 0, clears = 0
  const app = renderer.createApp({ setup: () => () => h(GoalPanel, { ...props,
    onSave: (update: ThreadGoalUpdate) => { saves.push(update); if (startRequest) props.saving = true },
    onRefresh: () => { refreshes++ }, onClear: () => { clears++ },
  }) })
  apps.push(app); app.mount(root)
  const button = (label: string) => all(root).find(node => node.type === 'button' && node.props['aria-label'] === label)
  return { props, saves, root, button, resume: () => button('恢复目标'), refreshes: () => refreshes, clears: () => clears }
}

test('ticks active goal time between snapshots and freezes confirmed inactive counters', async () => {
  const clock = spyOn(Date, 'now').mockReturnValue(100_000)
  try {
    const view = mountPanel({ goal: goalFixture({ status: 'active' }), now: 100_000 })
    const elapsed = () => all(view.root).find(node => node.props.class === 'goal-time')?.props['aria-label']
    expect(elapsed()).toBe('已用 23 秒')
    view.props.now = 103_000; await nextTick()
    expect(elapsed()).toBe('已用 26 秒')
    clock.mockReturnValue(103_000)
    view.props.goal = { ...view.props.goal!, tokensUsed: 900, updatedAt: 103 }; await nextTick()
    view.props.now = 104_000; await nextTick()
    expect(elapsed()).toBe('已用 27 秒')
    clock.mockReturnValue(104_000)
    view.props.goal = { ...view.props.goal!, timeUsedSeconds: 30 }; await nextTick()
    expect(elapsed()).toBe('已用 30 秒')
    view.props.now = 106_000; await nextTick()
    expect(elapsed()).toBe('已用 32 秒')
    for (const status of ['paused', 'blocked', 'usageLimited', 'budgetLimited', 'complete'] as const) {
      view.props.goal = { ...view.props.goal!, status, timeUsedSeconds: 32 }; await nextTick()
      view.props.now! += 10_000; await nextTick()
      expect(elapsed()).toBe('已用 32 秒')
    }
    clock.mockReturnValue(200_000); view.props.now = 200_000
    view.props.scopeKey = 'other-thread'
    view.props.goal = goalFixture({ threadId: 'other-thread', status: 'active', timeUsedSeconds: 5, createdAt: 200 }); await nextTick()
    expect(elapsed()).toBe('已用 5 秒')
    view.props.now = 202_000; await nextTick()
    expect(elapsed()).toBe('已用 7 秒')
    view.props.goal = null; await nextTick()
    expect(elapsed()).toBeUndefined()
  } finally { clock.mockRestore() }
})

test('the island resumes an existing paused goal through save, preserving its objective, budget and counters', async () => {
  const view = mountPanel({}, true), initial = { ...view.props.goal! }, button = view.resume()!
  expect(button.props.title).toBe('恢复目标')
  expect(button.props.type).toBe('button')
  expect(button.props.disabled).toBe(false)
  expect(view.saves).toEqual([])
  button.props.onClick()
  button.props.onClick()
  expect(view.saves).toEqual([{ status: 'active' }])
  expect(view.props.goal).toEqual(initial)
  expect(view.refreshes()).toBe(0)
  expect(view.clears()).toBe(0)
  await nextTick()
  expect(view.resume()!.props.disabled).toBe(true)
  expect(all(view.root).find(node => node.type === 'section')!.props['aria-busy']).toBe(true)
  // Only the existing save callback's confirmed response changes the visible status.
  view.props.goal = { ...initial, status: 'active' }; view.props.saving = false
  await nextTick()
  expect(view.resume()).toBeUndefined()
  expect(view.props.goal).toEqual({ ...initial, status: 'active' })
})

test.each([['loading', { loading: true }], ['different current thread', { scopeKey: 'other-thread' }]] as [string, Partial<PanelProps>][])('blocks resume while %s, including direct invocation of an old handler', async (_name, patch) => {
  const view = mountPanel(), staleClick = view.resume()!.props.onClick
  Object.assign(view.props, patch)
  await nextTick()
  expect(view.resume()!.props.disabled).toBe(true)
  staleClick()
  expect(view.saves).toEqual([])
})

test('a cleared goal cannot be recreated by a stale resume click', async () => {
  const view = mountPanel(), staleClick = view.resume()!.props.onClick
  view.props.goal = null
  await nextTick()
  expect(view.resume()).toBeUndefined()
  staleClick()
  expect(view.saves).toEqual([])
})

test('a failed request retains the paused goal and permits an explicit retry', async () => {
  const view = mountPanel({}, true)
  view.resume()!.props.onClick()
  await nextTick()
  view.props.error = '目标操作失败：连接中断'; view.props.saving = false
  await nextTick()
  expect(view.props.goal!.status).toBe('paused')
  expect(view.saves).toHaveLength(1)
  expect(all(view.root).some(node => node.props.role === 'alert' && node.text === view.props.error)).toBe(true)
  expect(view.resume()!.props.disabled).toBe(false)
  view.resume()!.props.onClick()
  expect(view.saves).toEqual([{ status: 'active' }, { status: 'active' }])
})

test('releases the same-tick guard when the parent does not start a request', async () => {
  const view = mountPanel()
  view.resume()!.props.onClick()
  view.resume()!.props.onClick()
  expect(view.saves).toHaveLength(1)
  await nextTick()
  await nextTick()
  expect(view.resume()!.props.disabled).toBe(false)
})

test.each(['blocked', 'usageLimited'] as const)('offers recovery for %s without resetting budget, objective or counters', async status => {
  const view = mountPanel({ goal: goalFixture({ status }) }, true), initial = { ...view.props.goal! }
  const button = view.resume()!
  expect(button).toBeDefined(); expect(button.props.disabled).toBe(false)
  button.props.onClick(); button.props.onClick()
  expect(view.saves).toEqual([{ status: 'active' }]); expect(view.props.goal).toEqual(initial)
  view.props.error = '仍然受限'; view.props.saving = false
  await nextTick()
  expect(view.resume()).toBeDefined(); expect(view.props.goal!.status).toBe(status)
})
test('a completed goal cannot be resumed through an old limited-state handler', async () => {
  const view = mountPanel({ goal: goalFixture({ status: 'usageLimited' }) }), resume = view.resume()!.props.onClick
  view.props.goal = goalFixture({ status: 'complete' }); await nextTick()
  expect(view.resume()).toBeUndefined(); resume(); expect(view.saves).toEqual([])
})
test('an exhausted goal budget opens editing rather than restarting or silently raising the cap', async () => {
  const view = mountPanel({ goal: goalFixture({ status: 'budgetLimited', tokensUsed: 4096 }) })
  const button = view.resume()!
  expect(button.props.title).toBe('调整预算后恢复目标')
  button.props.onClick(); await nextTick()
  expect(view.saves).toEqual([]); expect(view.props.goal!.tokenBudget).toBe(4096)
})
