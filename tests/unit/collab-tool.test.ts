import { buildThreadInsights } from '../../src/lib/thread-insights'
import { toolActivityState, toolActivityTitle } from '../../src/lib/tool-activity'
import type { Thread, Item } from '../../shared/protocol'
import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { compileScript, parse } from '@vue/compiler-sfc'
import { createRenderer, h, nextTick, ref, type App, type Component } from 'vue'
import { parseCollabTool } from '../../src/lib/collab-tool'

const call = (fields: Record<string, unknown> = {}) => ({
  id: 'call-1', type: 'collabAgentToolCall', tool: 'spawnAgent', status: 'completed',
  senderThreadId: 'parent', receiverThreadIds: ['child'], prompt: '检查队列同步\n先核对协议。',
  model: 'model-a', reasoningEffort: 'high', agentsStates: { child: { status: 'running', message: null } },
  ...fields,
})

// Compile the actual SFC to a temporary module, including its toggle handler, without a browser or TCP.
// Images and DOM-based Markdown sanitization are stubbed; these tests exercise
// visibility, lazy expansion and the text passed to the Markdown renderer.
let MessageItem: Component
beforeAll(async () => {
  const file = new URL('../../src/components/MessageItem.vue', import.meta.url)
  const { descriptor } = parse(await Bun.file(file).text(), { filename: file.pathname })
  const script = compileScript(descriptor, { id: 'collab-tool-test', inlineTemplate: true })
  const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(script.content)
    .replace(/import \{ renderMarkdown \} from ["']\.\.\/lib\/markdown["'];?/, 'const renderMarkdown = (text) => text;')
    .replace(/import InlineImage from ["']\.\/InlineImage\.vue["'];?/, 'const InlineImage = { render: () => null };')
    .replace(/import PastedText from ["']\.\/PastedText\.vue["'];?/, 'const PastedText = { render: () => null };')
    .replace(/from (["'])([^"']+)\1/g, (_match, _quote, specifier: string) =>
      'from ' + JSON.stringify(specifier.startsWith('.') ? new URL(specifier + '.ts', file).href : import.meta.resolve(specifier)))
  const directory = await mkdtemp(join(tmpdir(), 'codex-remote-collab-tool-'))
  try {
    const modulePath = join(directory, 'MessageItem.mjs')
    await Bun.write(modulePath, js)
    MessageItem = (await import(pathToFileURL(modulePath).href)).default
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
type Node = { type: string; text: string; props: Record<string, unknown>; children: Node[]; parent?: Node }
const node = (type: string, text = ''): Node => ({ type, text, props: {}, children: [] })
const renderer = createRenderer<Node, Node>({
  createElement: type => node(type), createText: text => node('#text', text), createComment: text => node('#comment', text),
  setText: (target, text) => { target.text = text }, setElementText: (target, text) => { target.text = text; target.children = [] },
  patchProp: (target, key, _old, value) => { target.props[key] = value },
  insert: (target, parent, anchor) => {
    if (target.parent) target.parent.children = target.parent.children.filter(child => child !== target)
    target.parent = parent
    const index = anchor ? parent.children.indexOf(anchor) : -1
    if (index < 0) parent.children.push(target); else parent.children.splice(index, 0, target)
  },
  remove: target => { if (target.parent) target.parent.children = target.parent.children.filter(child => child !== target) },
  parentNode: target => target.parent ?? null,
  nextSibling: target => target.parent?.children[target.parent.children.indexOf(target) + 1] ?? null,
})
const apps: App<Node>[] = []
afterEach(() => { for (const app of apps.splice(0)) app.unmount() })
function descendants(target: Node): Node[] { return [target, ...target.children.flatMap(descendants)] }
function mount(item: Record<string, unknown>) {
  const current = ref(item), root = node('root')
  const app = renderer.createApp({ setup: () => () => h(MessageItem, { item: current.value, now: 15_000 }) })
  apps.push(app); app.mount(root)
  return {
    root,
    text: () => descendants(root).filter(target => target.type !== '#comment').map(target => target.text).join(' '),
    async update(next: Record<string, unknown>) { current.value = next; await nextTick() },
    async open() {
      const details = descendants(root).find(target => target.type === 'details')!
      ;(details.props.onToggle as (event: { target: { open: boolean } }) => void)({ target: { open: true } })
      await nextTick()
    },
  }
}

describe('collab tool presentation', () => {

  test.each([
    ['completed', '已完成', false, true],
    ['failed', '失败', true, false]
  ] as const)('keeps call status %s distinct from agent status', (status, label, failed, completed) => {
    const parsed = parseCollabTool(call({ status }))!
    expect(parsed).toMatchObject({ status: label, failed, completed })
    expect(parsed.agents[0].status).toBe('执行中')
  })

  test('describes a successful spawn without claiming the agent finished its task', () => {
    expect(parseCollabTool(call())).toEqual({
      title: '创建子代理', status: '已完成', failed: false, completed: true,
      promptLabel: '任务说明', prompt: '检查队列同步\n先核对协议。',
      sender: 'parent', model: 'model-a', effort: '高',
      agents: [{ id: 'child', status: '执行中', failed: false, message: undefined, messageLabel: '消息' }],
    })
  })

  test('deduplicates targets and includes state-only agents with their result or error text', () => {
    const parsed = parseCollabTool(call({ tool: 'wait', receiverThreadIds: ['a', 'a', 'b'], agentsStates: {
      a: { status: 'completed', message: '检查完成\n没有冲突。' }, c: { status: 'errored', message: '连接断开' },
    } }))!
    expect(parsed.agents).toEqual([
      { id: 'a', status: '任务完成', failed: false, message: '检查完成\n没有冲突。', messageLabel: '执行结果' },
      { id: 'b', status: '', failed: false, message: undefined, messageLabel: '消息' },
      { id: 'c', status: '执行出错', failed: true, message: '连接断开', messageLabel: '错误说明' },
    ])
  })

  test.each([
    'futureTool',
    '__proto__',
    { name: 'spawnAgent' }
  ])('unknown or malformed tools have a readable fallback: %j', tool => {
    const parsed = parseCollabTool(call({ tool, result: { privatePayload: 'do not dump' } }))!
    expect(parsed.title).toBe(typeof tool === 'string' && tool.trim() ? `子代理协作 · ${tool}` : '子代理协作')
    expect(parsed.prompt).toBe('检查队列同步\n先核对协议。')
    expect(parsed.agents[0].id).toBe('child')
    expect(JSON.stringify(parsed)).not.toContain('privatePayload')
  })

  test('tolerates absent fields, malformed states, and future enums without coercing objects to text', () => {
    const parsed = parseCollabTool({ type: 'collabAgentToolCall', status: 'newStatus',
      prompt: { text: 'not a protocol string' }, senderThreadId: 5, model: [], reasoningEffort: 'future',
      receiverThreadIds: ['child', '', 1, null], agentsStates: { child: { status: 'future', message: {} }, extra: null },
    })!
    expect(parsed).toMatchObject({ title: '子代理协作', status: '状态未知', completed: false, failed: false, effort: '未识别的强度' })
    expect(parsed.prompt).toBeUndefined(); expect(parsed.sender).toBeUndefined(); expect(parsed.model).toBeUndefined()
    expect(parsed.agents.map(agent => [agent.id, agent.status, agent.message])).toEqual([['child', '状态未知', undefined], ['extra', '', undefined]])
    expect(parseCollabTool({ type: 'collabAgentToolCall', receiverThreadIds: {}, agentsStates: [] })).toMatchObject({ status: '', failed: false, completed: false, agents: [] })
  })

  test('leaves empty optional text absent and preserves literal user text without interpreting JSON or HTML', () => {
    expect(parseCollabTool(call({ prompt: '  ', model: null, reasoningEffort: null }))).toMatchObject({ prompt: undefined, model: undefined, effort: undefined })
    const prompt = '<script>alert(1)</script>\n{"task":"inspect this literal JSON"}'
    expect(parseCollabTool(call({ prompt }))?.prompt).toBe(prompt)
    for (const value of [null, [], 'text', { type: 'reasoning' }, { type: 'mcpToolCall', tool: 'spawnAgent' }]) expect(parseCollabTool(value)).toBeUndefined()
  })
})

describe('collab tool cards and reasoning visibility', () => {
  test('expands the existing activity card into readable task, target, and agent-result text', async () => {
    const view = mount(call({ agentsStates: { child: { status: 'completed', message: '核对完成，无缺项。' } } }))
    expect(view.text()).toContain('创建子代理')
    expect(view.text()).not.toContain('spawnAgent')
    expect(view.text()).not.toContain('collabAgentToolCall')
    expect(descendants(view.root).find(target => target.type === 'details')?.props.class).toContain('activity')
    await view.open()
    for (const text of ['任务说明', '检查队列同步', '发起代理', 'parent', 'child', '任务完成', '执行结果', '核对完成，无缺项。', '模型', 'model-a', '思考强度', '高']) expect(view.text()).toContain(text)
    expect(descendants(view.root).some(target => target.type === 'pre')).toBe(false)
  })

  test('renders unknown tools as collaboration text and never falls through to the raw JSON branch', async () => {
    const view = mount(call({ tool: 'newTool', result: { secretPayload: 'do not show' }, status: 'futureStatus' }))
    await view.open()
    expect(view.text()).toContain('子代理协作')
    expect(view.text()).not.toContain('状态未知')
    expect(view.text()).toContain('newTool')
    expect(view.text()).not.toContain('secretPayload')
    expect(descendants(view.root).some(target => target.type === 'pre')).toBe(false)
  })

  test('updates partial live cards and keeps tool-provided markup as literal text', async () => {
    const view = mount(call({ status: 'inProgress', receiverThreadIds: [], agentsStates: {}, prompt: null, senderThreadId: '', model: null, reasoningEffort: null }))
    await view.open()
    expect(view.text().replace(/\s+/g, ' ').trim()).toBe('创建子代理')
    const prompt = '<script>alert(1)</script>', message = '<img src=x onerror=alert(1)>'
    await view.update(call({ prompt, agentsStates: { child: { status: 'errored', message } }, status: 'failed' }))
    expect(view.text()).toContain('失败'); expect(view.text()).toContain('执行出错')
    expect(view.text()).toContain(prompt); expect(view.text()).toContain(message)
    expect(descendants(view.root).some(target => ['script', 'img'].includes(target.type) || target.props.innerHTML)).toBe(false)
  })

  test('hides live and blank reasoning, displays one line directly and folds multiple lines', async () => {
    const item = { id: 'reasoning', type: 'reasoning', summary: [], content: ['已有实际思考正文'], status: 'inProgress', startedAtMs: 1000 }
    const view = mount(item)
    expect(view.text().trim()).toBe('')
    expect(descendants(view.root).some(target => target.type === 'details')).toBe(false)
    await view.update({ ...item, status: 'completed', completedAtMs: 4000 })
    expect(descendants(view.root).filter(target => target.type === 'details')).toHaveLength(0)
    expect(descendants(view.root).some(target => String(target.props.innerHTML || '').includes('已有实际思考正文'))).toBe(true)
    await view.update({ ...item, content: ['已有实际思考正文', '第二行思考正文'], status: 'completed', completedAtMs: 4000 })
    expect(view.text()).toContain('已思考 3秒')
    expect(view.text()).not.toContain('已有实际思考正文')
    expect(descendants(view.root).filter(target => target.type === 'details')).toHaveLength(1)
    expect(descendants(view.root).find(target => target.type === 'details')?.props.open).toBeFalsy()
    expect(descendants(view.root).some(target => target.props.innerHTML)).toBe(false)
    await view.open()
    expect(descendants(view.root).some(target => String(target.props.innerHTML || '').includes('已有实际思考正文'))).toBe(true)
    await view.update({ ...item, summary: [' '], content: [], status: 'completed', completedAtMs: 4000 })
    expect(view.text().trim()).toBe('')
    expect(descendants(view.root).some(target => target.type === 'details')).toBe(false)
  })

})

describe('native sub-agent activity events', () => {
  const activity: Item = { type: 'subAgentActivity', id: 'call-1', kind: 'interacted', agentThreadId: '01a0f75e-a768-7682-ad2f-2716871ce8f1', agentPath: '/root/crossflow_sol', completedAtMs: 1790862448504 }
  test('parses the screenshot payload without claiming the agent finished', async () => {
    const parsed = parseCollabTool(activity)!
    expect(parsed.title).toBe('与子代理交互')
    expect(parsed.agents).toMatchObject([{ id: activity.agentThreadId, path: activity.agentPath, status: '' }])
    expect(toolActivityState(activity)).toMatchObject({ completed: true, running: false, failed: false })
    const view = mount(activity); await view.open()
    expect(view.text()).toContain('/root/crossflow_sol')
    expect(view.text()).toContain(activity.agentThreadId!)
    expect(view.text()).not.toContain('subAgentActivity')
    expect(view.text()).not.toContain('任务完成')
    expect(descendants(view.root).some(target => target.type === 'pre')).toBe(false)
  })
  test.each([['started', '启动子代理'], ['interacted', '与子代理交互'], ['interrupted', '中断子代理'], ['completed', '子代理任务完成']])('labels native activity kind %s', (kind, title) => {
    expect(toolActivityTitle({ ...activity, kind })).toBe(title)
  })
  test('keeps malformed and future fields readable without dumping JSON', async () => {
    const parsed = parseCollabTool({ type: 'subAgentActivity', kind: '__proto__', agentThreadId: {}, agentPath: 4 })!
    expect(parsed.title).toBe('子代理活动 · __proto__'); expect(parsed.agents).toEqual([])
    const view = mount({ type: 'subAgentActivity', kind: 'future', agentThreadId: '<script>literal</script>', agentPath: '<img src=x>' })
    await view.open()
    expect(view.text()).toContain('<img src=x>')
    expect(descendants(view.root).some(target => ['script', 'img', 'pre'].includes(target.type))).toBe(false)
  })
  test('discovers the real thread for the inspector while keeping interaction distinct from completion', () => {
    const thread = { id: 'parent', turns: [{ id: 'turn', items: [activity] }] } as Thread
    expect(buildThreadInsights(thread).agents).toEqual([{ id: activity.agentThreadId!, name: 'crossflow_sol' }])
    thread.turns[0]!.items.push({ ...activity, id: 'completed', kind: 'completed' })
    expect(buildThreadInsights(thread).agents[0]?.status).toBe('completed')
  })
})
