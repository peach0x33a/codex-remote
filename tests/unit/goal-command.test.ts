import { afterEach, beforeAll, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { compileScript, parse } from '@vue/compiler-sfc'
import { createRenderer, h, markRaw, nextTick, shallowReactive, type App, type Component } from 'vue'
import { goalEditPrompt, parseGoalCommand } from '../../src/lib/goal-command'
import type { ThreadGoal, ThreadGoalUpdate } from '../../src/lib/thread-goal'

test.each(['', 'goal', '/goals', '/goalpost x', '/goal-status', '/goal/edit', '/goal=edit', 'text /goal status', '/status'])('does not consume unrelated input %j', input => {
  expect(parseGoalCommand(input)).toBeUndefined()
})
test.each(['/goal', '/goal ', '/goal\t \n', '  /GOAL\r\n'])('opens the modal only for an empty goal command %j', input => {
  expect(parseGoalCommand(input)).toEqual({ kind: 'open' })
})
test.each(['edit', 'status'] as const)('reserves only the complete, case-sensitive %s token', token => {
  expect(parseGoalCommand('/goal ' + token)).toEqual({ kind: token })
  expect(parseGoalCommand('/goal \t' + token + ' \n')).toEqual({ kind: token })
  for (const objective of [token + ' this task', token + 's', token + ': details', token + '\nthen continue', token.toUpperCase()]) {
    expect(parseGoalCommand('/goal ' + objective)).toEqual({ kind: 'start', objective })
  }
})
test.each([
  'finish the task', '  keep indentation\n  and trailing spaces  \n', '\nstart with a newline\r\n',
  '\tfirst\tsecond  third', '处理目标，保留  空格', '/goal status',
])('edit and start preserve the objective verbatim: %j', objective => {
  const prompt = goalEditPrompt(objective)
  expect(prompt).toBe('/goal ' + objective)
  expect(parseGoalCommand(prompt)).toEqual({ kind: 'start', objective })
})
test('handles a tab or CRLF command separator without normalizing the objective', () => {
  expect(parseGoalCommand('/goal\t  first\nsecond  ')).toEqual({ kind: 'start', objective: '  first\nsecond  ' })
  expect(parseGoalCommand('/goal\r\nfirst\r\nsecond\r\n')).toEqual({ kind: 'start', objective: 'first\r\nsecond\r\n' })
  expect(goalEditPrompt('')).toBe('/goal ')
  expect(goalEditPrompt('status')).toBe('/goal status')
})

let GoalPanel: Component
beforeAll(async () => {
  const file = new URL('../../src/components/GoalPanel.vue', import.meta.url)
  const { descriptor } = parse(await Bun.file(file).text(), { filename: file.pathname })
  const script = compileScript(descriptor, { id: 'goal-command-panel', inlineTemplate: true })
  // Keep the real panel, exposed methods, refs and Teleport. Replace only animation
  // and the native-dialog shell; status never needs to mount the modal's form.
  const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(script.content)
    .replace(/import MotionCollapse from ["']\.\/MotionCollapse\.vue["'];?/, 'const MotionCollapse = { props: ["open"], setup: (props, { slots }) => () => props.open ? slots.default?.() : null };')
    .replace(/import BaseDialog from ["']\.\/BaseDialog\.vue["'];?/, 'const BaseDialog = { props: ["open"], setup: props => () => props.open ? __hostH("dialog") : null };')
    .replace(/from (["'])([^"']+)\1/g, (_match, _quote, specifier: string) => 'from ' + JSON.stringify(specifier.startsWith('.') ? new URL(specifier + '.ts', file).href : import.meta.resolve(specifier)))
  const directory = await mkdtemp(join(tmpdir(), 'codex-goal-command-'))
  try {
    const path = join(directory, 'goal-panel.mjs')
    await Bun.write(path, `import { h as __hostH } from ${JSON.stringify(import.meta.resolve('vue'))};\n${js}`)
    GoalPanel = (await import(pathToFileURL(path).href)).default
  } finally { await rm(directory, { recursive: true, force: true }) }
})

type HostNode = { tag: string; props: Record<string, any>; children: HostNode[]; parent?: HostNode; text: string; focus(): void }
let focusCalls = 0
const node = (tag: string, text = ''): HostNode => markRaw({ tag, text, props: {}, children: [], focus() { focusCalls++ } })
const body = node('body')
const renderer = createRenderer<HostNode, HostNode>({
  createElement: tag => node(tag), createText: text => node('#text', text), createComment: () => node('#comment'),
  patchProp: (node, key, _previous, value) => { node.props[key] = value },
  setText: (node, text) => { node.text = text }, setElementText: (node, text) => { node.text = text; node.children = [] },
  insert(node, parent, anchor) {
    if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1)
    node.parent = parent
    const index = anchor ? parent.children.indexOf(anchor) : -1
    parent.children.splice(index < 0 ? parent.children.length : index, 0, node)
  },
  remove(node) { if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1); node.parent = undefined },
  parentNode: node => node.parent || null, nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] || null,
  querySelector: selector => selector === 'body' ? body : null,
})
const all = (node: HostNode): HostNode[] => [node, ...node.children.flatMap(all)]
const textContent = (node: HostNode): string => node.text + node.children.map(textContent).join('')
const hasClass = (node: HostNode, name: string) => String(node.props.class || '').split(' ').includes(name)
const apps = new Set<App<HostNode>>()
const originals = new Map<string, PropertyDescriptor | undefined>()
function setGlobal(name: string, value: unknown) {
  if (!originals.has(name)) originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
}
afterEach(async () => {
  for (const app of apps) app.unmount()
  apps.clear(); await nextTick(); body.children = []
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else Reflect.deleteProperty(globalThis, name)
  }
  originals.clear()
})
function installClock() {
  let now = 0, id = 0
  const timers = new Map<number, { at: number; run: () => void }>()
  setGlobal('setTimeout', (run: () => void, delay = 0) => { timers.set(++id, { at: now + delay, run }); return id })
  setGlobal('clearTimeout', (id: number) => { timers.delete(id) })
  return { timers, async advance(ms: number) {
    now += ms
    for (const [id, timer] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
      if (timer.at <= now && timers.delete(id)) timer.run()
    }
    await nextTick(); await nextTick()
  } }
}
type PanelProps = { goal: ThreadGoal | null; scopeKey?: string; loading: boolean; saving: boolean; error: string; supported: boolean | null; disabled: boolean; showSummary: boolean }
const goal = (patch: Partial<ThreadGoal> = {}): ThreadGoal => ({
  threadId: 'current-thread', objective: '先完成任务\n  保留格式  ', status: 'paused', tokenBudget: 5000,
  tokensUsed: 1234, timeUsedSeconds: 3723, createdAt: 1, updatedAt: 2, ...patch,
})
async function mountPanel(patch: Partial<PanelProps> = {}) {
  const clock = installClock(), root = node('root')
  focusCalls = 0
  const props = shallowReactive<PanelProps>({ goal: goal(), scopeKey: 'current-thread', loading: false, saving: false, error: '', supported: true, disabled: false, showSummary: true, ...patch })
  let api!: { show(preset?: string): Promise<void>; showStatus(): void }, refreshes = 0, clears = 0
  const saves: ThreadGoalUpdate[] = []
  const app = renderer.createApp({ setup: () => () => h(GoalPanel, {
    ...props, ref: (value: unknown) => { api = value as typeof api },
    onRefresh: () => { refreshes++ }, onSave: (update: ThreadGoalUpdate) => saves.push(update), onClear: () => { clears++ },
  }) })
  apps.add(app); app.mount(root); await nextTick()
  const find = (predicate: (node: HostNode) => boolean) => all(root).find(predicate)
  return { api, props, root, clock, saves, find, refreshes: () => refreshes, clears: () => clears,
    details: () => find(node => hasClass(node, 'goal-status-details')),
    modal: () => all(body).find(node => node.tag === 'dialog'),
    async showStatus() { api.showStatus(); await nextTick(); await nextTick() },
    async update(patch: Partial<PanelProps>) { Object.assign(props, patch); await nextTick(); await nextTick() },
    async unmount() { app.unmount(); apps.delete(app); await nextTick() },
  }
}

test('the compact summary keeps objective/status and paused resume, and still opens the editor', async () => {
  const view = await mountPanel()
  expect(textContent(view.root)).toContain(view.props.goal!.objective)
  expect(textContent(view.root)).toContain('已暂停')
  expect(textContent(view.root)).not.toContain('tokens')
  expect(textContent(view.root)).toContain('已用 1 小时 2 分 3 秒')
  expect(view.find(node => node.props['aria-label'] === '恢复目标')).toBeDefined()
  expect(view.details()).toBeUndefined(); expect(view.modal()).toBeUndefined()
  await view.find(node => node.props['aria-label'] === '编辑目标')!.props.onClick()
  expect(view.modal()).toBeDefined(); expect(view.saves).toEqual([])
})

test('status shows full objective, status, budget, remaining tokens and elapsed time without a modal', async () => {
  const view = await mountPanel({ showSummary: false })
  expect(view.details()).toBeUndefined()
  await view.showStatus()
  expect(textContent(view.find(node => hasClass(node, 'goal-objective'))!)).toBe(view.props.goal!.objective)
  expect(textContent(view.details()!)).toBe('状态已暂停已用 tokens1,234Token 预算5,000剩余 tokens3,766已用时间1 小时 2 分 3 秒')
  expect(view.details()!.props.role).toBe('status')
  expect(view.modal()).toBeUndefined(); expect(focusCalls).toBe(0)
  expect(view.refreshes()).toBe(1); expect(view.saves).toEqual([]); expect(view.clears()).toBe(0)
  await view.clock.advance(7999); expect(view.details()).toBeDefined()
  await view.clock.advance(1); expect(view.details()).toBeUndefined()
  expect(view.find(node => hasClass(node, 'goal-panel'))).toBeUndefined()
  expect(view.clock.timers.size).toBe(0)
})

test('status with no goal shows a short empty state for eight seconds without opening setup', async () => {
  const view = await mountPanel({ goal: null })
  await view.showStatus()
  expect(textContent(view.details()!)).toBe('当前没有目标。')
  expect(view.modal()).toBeUndefined(); expect(view.saves).toEqual([])
  await view.clock.advance(8000)
  expect(view.details()).toBeUndefined(); expect(view.modal()).toBeUndefined()
})

test('a repeated status command renews one timer instead of letting the previous timeout dismiss it', async () => {
  const view = await mountPanel()
  await view.showStatus(); await view.clock.advance(4000); await view.showStatus()
  expect(view.clock.timers.size).toBe(1)
  await view.clock.advance(4000); expect(view.details()).toBeDefined()
  await view.clock.advance(3999); expect(view.details()).toBeDefined()
  await view.clock.advance(1); expect(view.details()).toBeUndefined()
  expect(view.find(node => hasClass(node, 'goal-panel'))).toBeDefined()
  expect(textContent(view.root)).not.toContain('tokens')
})

test.each([false, true])('changing scope clears status and its timer even with saving=%s', async saving => {
  const view = await mountPanel({ saving })
  await view.showStatus(); await view.update({ scopeKey: 'another-thread' })
  expect(view.details()).toBeUndefined(); expect(view.clock.timers.size).toBe(0)
  await view.clock.advance(8000); expect(view.modal()).toBeUndefined()
})

test('unmount and opening the ordinary modal both clear the status timer', async () => {
  const view = await mountPanel()
  await view.showStatus(); await view.api.show()
  expect(view.details()).toBeUndefined(); expect(view.clock.timers.size).toBe(0); expect(view.modal()).toBeDefined()
  await view.unmount()
  const another = await mountPanel()
  await another.showStatus(); await another.unmount()
  expect(another.clock.timers.size).toBe(0)
})

test('live goal updates refresh displayed metrics without extending the status lifetime', async () => {
  const view = await mountPanel()
  await view.showStatus(); await view.clock.advance(3000)
  await view.update({ goal: goal({ tokensUsed: 5500, status: 'complete', timeUsedSeconds: 9 }) })
  expect(textContent(view.details()!)).toBe('状态已完成已用 tokens5,500Token 预算5,000剩余 tokens0已用时间9 秒')
  expect(view.find(node => node.props['aria-label'] === '恢复目标')).toBeUndefined()
  await view.clock.advance(5000); expect(view.details()).toBeUndefined()
})

test('unset budgets stay unset and a removed goal becomes an empty status until expiry', async () => {
  const view = await mountPanel({ goal: goal({ tokenBudget: null }) })
  await view.showStatus()
  expect(textContent(view.details()!)).toContain('Token 预算未设置')
  expect(textContent(view.details()!)).not.toContain('剩余 tokens')
  expect(view.props.goal!.tokenBudget).toBeNull()
  await view.update({ goal: null }); expect(textContent(view.details()!)).toBe('当前没有目标。')
  await view.clock.advance(8000); expect(view.details()).toBeUndefined()
})

test.each([
  { supported: false, loading: false, text: '当前服务不支持目标模式。' },
  { supported: true, loading: true, text: '正在读取目标…' },
])('status reports unavailable/loading state without a modal or duplicate refresh', async ({ supported, loading, text }) => {
  const view = await mountPanel({ goal: null, supported, loading })
  await view.showStatus()
  expect(textContent(view.details()!)).toBe(text)
  expect(view.refreshes()).toBe(0); expect(view.modal()).toBeUndefined(); expect(view.saves).toEqual([])
})
