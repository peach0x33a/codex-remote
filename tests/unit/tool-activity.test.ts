import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { compileScript, parse } from '@vue/compiler-sfc'
import { computed, createRenderer, h, nextTick, ref, type App, type Component } from 'vue'
import type { Item, Turn } from '../../shared/protocol'
import { buildActivityRows, buildDocumentActivityRows, commandActivityKind, documentActivityTitle, readFilePaths, summarizeToolActivity, toolActivityError, toolActivityState, toolActivityTitle, type CommandAction } from '../../src/lib/tool-activity'

const read = (path: string): CommandAction => ({ type: 'read', command: 'reader', name: path.split('/').at(-1)!, path })
const action = (type: 'listFiles' | 'search' | 'unknown'): CommandAction => type === 'listFiles'
  ? { type, command: 'list', path: null } : type === 'search' ? { type, command: 'search', path: null, query: 'needle' } : { type, command: 'run' }
function command(id: string, actions?: unknown, fields: Record<string, unknown> = {}): Item {
  return { id, type: 'commandExecution', status: 'completed', command: 'cat guessed-name.txt', commandActions: actions, ...fields } as Item
}
const call = (id: string, type: string, fields: Record<string, unknown> = {}): Item => ({ id, type, status: 'completed', ...fields })
const turn = (items: Item[], id = 'turn'): Turn => ({ id, status: 'completed', items })
const ids = (turns: Turn[]) => buildActivityRows(turns).map(row => 'group' in row ? row.group.map(item => item.id) : row.item.id)

describe('server-classified command activities', () => {
  test('uses only complete homogeneous commandActions, never shell text or the filename label', () => {
    expect(commandActivityKind(command('a', [read('/actual/a'), read('/actual/b')]))).toBe('read')
    for (const kind of ['listFiles', 'search', 'unknown'] as const) expect(commandActivityKind(command('a', [action(kind)]))).toBe(kind)
    for (const actions of [undefined, null, [], 'read', [null], [{}], [{ type: 'read' }], [{ type: 'read', path: '' }], [read('/a'), null], [read('/a'), action('search')], [read('/a'), action('unknown')], [action('search'), action('listFiles')], [{ type: 'futureAction' }]]) {
      expect(commandActivityKind(command('a', actions))).toBe('unknown')
      expect(readFilePaths([command('a', actions)])).toEqual([])
    }
    expect(commandActivityKind(call('a', 'mcpToolCall', { commandActions: [read('/a')] }))).toBeUndefined()
  })

  test('deduplicates exact server paths across actions and items, keeping first-seen order', () => {
    const items = [command('a', [read('/src/a'), read('/src/b'), read('/src/a')]), command('b', [read('/src/b'), read('/other/a')])]
    expect(readFilePaths(items)).toEqual(['/src/a', '/src/b', '/other/a'])
    expect(summarizeToolActivity(items).title).toBe('已读取 3 个文件')
    expect(toolActivityTitle(items[0]!)).toBe('读取 /src/a、/src/b')
  })

  test('shows a literal one-line shell summary when no read metadata exists', () => {
    const item = command('a', undefined, { command: 'printf "<script>"\n  && echo done' })
    expect(toolActivityTitle(item)).toBe('printf "<script>" && echo done')
    expect(toolActivityTitle(command('empty', undefined, { command: '' }))).toBe('运行命令')
  })
})

describe('adjacent activity rows', () => {
  test('groups even one read and only groups other tool categories when adjacent at least twice', () => {
    expect(ids([turn([command('r', [read('/a')]), command('u')])])).toEqual([['r'], 'u'])
    expect(ids([turn([
      command('r1', [read('/a')]), command('r2', [read('/b')]),
      command('l1', [action('listFiles')]), command('l2', [action('listFiles')]),
      command('s1', [action('search')]), command('s2', [action('search')]),
      command('u1'), command('u2', [read('/a'), action('unknown')]), command('r3', [read('/c')]),
    ])])).toEqual([['r1', 'r2'], ['l1', 'l2'], ['s1', 's2'], ['u1', 'u2'], ['r3']])
  })

  test.each(['userMessage', 'agentMessage', 'reasoning', 'contextCompaction', 'plan', 'hookPrompt', 'futureItem'])('never crosses a %s boundary, even when its body is empty', type => {
    const items = [command('a', [read('/a')]), call('boundary', type), command('b', [read('/b')])]
    expect(ids([turn(items)])).toEqual([['a'], 'boundary', ['b']])
    expect(buildActivityRows([turn(items)]).flatMap(row => 'group' in row ? row.group : [row.item])).toEqual(items)
  })

  test('never crosses turns and gives repeated item IDs in different turns distinct keys', () => {
    const rows = buildActivityRows([turn([command('same', [read('/a')])], 'one'), turn([command('same', [read('/b')])], 'two')])
    expect(rows).toHaveLength(2)
    expect(rows[0]!.key).not.toBe(rows[1]!.key)
  })

  test('distinguishes MCP servers and tool names, without merging incomplete identities', () => {
    const mcp = (id: string, server?: string, tool?: string) => call(id, 'mcpToolCall', { server, tool })
    expect(ids([turn([mcp('a', 'one', 'read'), mcp('b', 'one', 'read'), mcp('c', 'two', 'read'), mcp('d', 'two', 'search'), mcp('e'), mcp('f')])]))
      .toEqual([['a', 'b'], 'c', 'd', 'e', 'f'])
    // Delimiters in names cannot collide with identity tuple boundaries.
    expect(ids([turn([mcp('a', 'a:b', 'c'), mcp('b', 'a', 'b:c')])])).toEqual(['a', 'b'])
  })

  test('distinguishes collaborative operations and dynamic tool namespaces', () => {
    const collab = (id: string, tool: string) => call(id, 'collabAgentToolCall', { tool })
    const dynamic = (id: string, namespace: string, tool = 'run') => call(id, 'dynamicToolCall', { namespace, tool })
    expect(ids([turn([collab('a', 'spawnAgent'), collab('b', 'spawnAgent'), collab('c', 'wait'), collab('d', 'sendInput'), dynamic('e', 'one'), dynamic('f', 'one'), dynamic('g', 'two'), dynamic('h', 'two', 'other')])]))
      .toEqual([['a', 'b'], 'c', 'd', ['e', 'f'], 'g', 'h'])
  })

  test('preserves ordering and input identity without mutating turn arrays', () => {
    const first = command('a'), middle = call('b', 'webSearch'), last = command('c')
    const items = Object.freeze([first, middle, last])
    const rows = buildActivityRows([turn(items as unknown as Item[])])
    expect(ids([turn([...items])])).toEqual(['a', 'b', 'c'])
    expect('item' in rows[0]! && rows[0]!.item).toBe(first)
  })

  test('keys depend on the first item, not streamed status, output or appended siblings', () => {
    const a = command('a', [read('/a')], { status: 'inProgress' })
    const before = buildActivityRows([turn([a])])[0]!
    const after = buildActivityRows([turn([{ ...a, status: 'completed', aggregatedOutput: 'done' }, command('b', [read('/b')])])])[0]!
    expect(before.key).toBe(after.key)
    expect(after.key).toBe(JSON.stringify(['turn', 'a']))
  })
})

describe('document activity rows across a turn', () => {
  const documentIds = (turns: Turn[]) => buildDocumentActivityRows(turns).map(row => 'group' in row ? row.group.map(item => item.id) : row.item.id)

  test('collects nonconsecutive mixed reads and changes at the first document call', () => {
    const before = call('before', 'agentMessage', { text: 'Starting' })
    const first = command('read-a', [read('/src/a')])
    const reasoning = call('reasoning', 'reasoning')
    const edit = call('edit', 'fileChange', { changes: [{ path: '/src/a' }] })
    const search = call('search', 'webSearch')
    const second = command('read-b', [read('/src/b')])
    const after = call('after', 'agentMessage', { text: 'Done' })
    const items = Object.freeze([before, first, reasoning, edit, search, second, after])
    const rows = buildDocumentActivityRows([turn(items as unknown as Item[])])

    expect(rows.map(row => 'group' in row ? row.group.map(item => item.id) : row.item.id))
      .toEqual(['before', ['read-a', 'edit', 'read-b'], 'reasoning', 'search', 'after'])
    expect(rows[1]).toEqual({ key: JSON.stringify(['turn', 'read-a']), group: [first, edit, second], documentSummary: true })
    const retained = rows.flatMap(row => 'item' in row ? [row.item] : [])
    expect(retained).toEqual([before, reasoning, search, after])
    expect(retained[1]).toBe(reasoning)
    expect(rows.flatMap(row => 'group' in row ? row.group : [row.item])).toHaveLength(items.length)
    expect(items).toEqual([before, first, reasoning, edit, search, second, after])
  })

  test.each(['reads', 'changes'] as const)('combines separated %s even without the other document category', kind => {
    const item = (id: string) => kind === 'reads' ? command(id, [read('/' + id)]) : call(id, 'fileChange')
    const rows = buildDocumentActivityRows([turn([item('a'), call('between', 'plan'), item('b')])])
    expect(rows[0]).toMatchObject({ documentSummary: true, group: [{ id: 'a' }, { id: 'b' }] })
    expect(rows[1]).toMatchObject({ item: { id: 'between' } })
    expect(rows).toHaveLength(2)
  })

  test('combines adjacent mixed document calls but retains ordinary homogeneous groups', () => {
    const mixed = [command('read', [read('/a')]), call('edit', 'fileChange')]
    expect(buildDocumentActivityRows([turn(mixed)])[0]).toMatchObject({ documentSummary: true, group: mixed })
    for (const items of [[], [command('read', [read('/a')])], [call('edit', 'fileChange')],
      [command('a', [read('/a')]), command('b', [read('/b')])],
      [call('a', 'fileChange'), call('b', 'fileChange')]]) {
      expect(buildDocumentActivityRows([turn(items)])).toEqual(buildActivityRows([turn(items)]))
    }
  })

  test('retains unrelated tools, messages and their adjacent groups in source order', () => {
    const unrelated = [
      command('list', [action('listFiles')]), command('search', [action('search')]),
      command('shell-a'), command('shell-b', [read('/mixed'), action('unknown')]),
      call('mcp-a', 'mcpToolCall', { server: 'repo', tool: 'read' }),
      call('mcp-b', 'mcpToolCall', { server: 'repo', tool: 'read' }),
      call('dynamic', 'dynamicToolCall', { tool: 'read', commandActions: [read('/metadata')] }),
      call('agent', 'agentMessage'), call('reasoning', 'reasoning'), call('plan', 'plan'),
      call('compaction', 'contextCompaction'), call('hook', 'hookPrompt'), call('unknown', 'futureItem'),
    ]
    const first = command('read', [read('/a')]), last = call('edit', 'fileChange')
    const rows = buildDocumentActivityRows([turn([first, ...unrelated, last])])
    expect(rows[0]).toMatchObject({ documentSummary: true, group: [first, last] })
    expect(rows.slice(1)).toEqual(buildActivityRows([turn(unrelated)]))
    const retained = rows.slice(1).flatMap(row => 'group' in row ? row.group : [row.item])
    retained.forEach((item, index) => expect(item).toBe(unrelated[index]))
  })

  test('does not aggregate a read and change across an empty user message', () => {
    const items = [command('read', [read('/a')]), call('user', 'userMessage'), call('edit', 'fileChange')]
    expect(documentIds([turn(items)])).toEqual([['read'], 'user', 'edit'])
    expect(buildDocumentActivityRows([turn(items)])).toEqual(buildActivityRows([turn(items)]))
  })

  test('builds independent document summaries on each side of user boundaries', () => {
    const items = [
      command('r1', [read('/a')]), call('e1', 'fileChange'),
      call('u1', 'userMessage'), call('u2', 'userMessage'),
      call('e2', 'fileChange'), call('middle', 'reasoning'), command('r2', [read('/b')]),
      call('u3', 'userMessage'),
    ]
    expect(documentIds([turn(items)])).toEqual([['r1', 'e1'], 'u1', 'u2', ['e2', 'r2'], 'middle', 'u3'])
    expect(buildDocumentActivityRows([turn(items)]).filter(row => 'group' in row && row.documentSummary)).toHaveLength(2)
  })

  test('never merges across turns and scopes summary keys to the turn', () => {
    const items = [command('read', [read('/a')]), call('edit', 'fileChange')]
    const rows = buildDocumentActivityRows([turn(items, 'one'), turn([], 'empty'), turn(items, 'two')])
    expect(rows).toHaveLength(2)
    expect(rows.map(row => row.key)).toEqual([JSON.stringify(['one', 'read']), JSON.stringify(['two', 'read'])])
    expect(documentIds([turn([items[0]!], 'one'), turn([items[1]!], 'two')])).toEqual([['read'], 'edit'])
  })

  test('keeps keys and first-seen order while using the latest snapshot of a repeated item', () => {
    const initial = command('read', [read('/a')], { status: 'inProgress' })
    const updated = { ...initial, status: 'completed', aggregatedOutput: 'latest' }
    const change = call('edit', 'fileChange')
    const before = buildDocumentActivityRows([turn([initial])])[0]!
    const after = buildDocumentActivityRows([turn([initial, call('between', 'reasoning'), change, updated])])[0]!
    expect(after.key).toBe(before.key)
    expect(after).toEqual({ key: before.key, group: [updated, change], documentSummary: true })
    expect('group' in after && after.group[0]).toBe(updated)
    expect(documentActivityTitle('group' in after ? after.group : [])).toBe('合计 1 次读取，1 次变更')
  })

  test('counts calls rather than files or successful outcomes in document titles', () => {
    const items = [
      command('a', [read('/a'), read('/b'), read('/a')]),
      command('b', [read('/a')], { status: 'failed' }),
      call('edit', 'fileChange', { status: 'inProgress', changes: [{ path: '/a' }, { path: '/b' }] }),
      call('declined', 'fileChange', { status: 'declined' }),
      command('mixed', [read('/c'), action('search')]), command('shell'),
      call('mcp', 'mcpToolCall', { tool: 'read', commandActions: [read('/d')] }),
    ]
    expect(documentActivityTitle(items)).toBe('合计 2 次读取，2 次变更')
    expect(documentActivityTitle([])).toBe('合计 0 次读取，0 次变更')
    expect(documentActivityTitle([items[0]!])).toBe('合计 1 次读取，0 次变更')
    expect(documentActivityTitle([items[2]!])).toBe('合计 0 次读取，1 次变更')
  })
})

describe('truthful activity summaries', () => {
  test.each(['inProgress', 'failed', 'declined', 'interrupted', 'futureStatus', undefined])('does not claim reading completed for %s', status => {
    const summary = summarizeToolActivity([command('a', [read('/a')]), command('b', [read('/b')], { status })])
    expect(summary.completed).toBe(false)
    expect(summary.title).not.toStartWith('已')
    if (status === 'inProgress') expect(summary.title).toBe('正在读取 2 个文件')
    if (status === 'failed') expect(summary.failed).toBe(true)
  })

  test('keeps mixed failure and running states visible without a completion checkmark', () => {
    const summary = summarizeToolActivity([command('a', undefined, { status: 'failed' }), command('b', undefined, { status: 'inProgress' })])
    expect(summary).toMatchObject({ title: '正在运行 2 个命令', completed: false, failed: true, running: true })
    expect(summary.status).toContain('1 项失败'); expect(summary.status).toContain('1 项进行中')
  })

  test('treats nonzero exits, explicit errors and unsuccessful dynamic calls as failures', () => {
    for (const item of [command('a', undefined, { exitCode: 1 }), call('b', 'mcpToolCall', { error: { message: 'Denied' } }), call('c', 'dynamicToolCall', { success: false })]) {
      expect(toolActivityState(item)).toMatchObject({ failed: true, completed: false, label: '失败' })
    }
    expect(toolActivityError(command('a', undefined, { exitCode: 2 }))).toBe('命令退出码：2')
    expect(toolActivityError(call('b', 'mcpToolCall', { error: { message: '<script>denied</script>' } }))).toBe('<script>denied</script>')
  })

  test('names each completed group according to the actual tool category', () => {
    expect(summarizeToolActivity([command('a'), command('b')]).title).toBe('已运行 2 个命令')
    expect(summarizeToolActivity([call('a', 'mcpToolCall', { server: 'repo', tool: 'lookup' }), call('b', 'mcpToolCall', { server: 'repo', tool: 'lookup' })]).title).toBe('已调用 2 次 repo · lookup')
    expect(summarizeToolActivity([call('a', 'collabAgentToolCall', { tool: 'spawnAgent' }), call('b', 'collabAgentToolCall', { tool: 'spawnAgent' })]).title).toBe('已调用 2 次 创建子代理')
    expect(summarizeToolActivity([]).completed).toBe(false)
  })
})

// Compile the real components with the same in-memory renderer as the existing
// collab tests. No browser, network or extra DOM dependency is needed.
let MessageItem: Component, ToolActivityGroup: Component
beforeAll(async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codex-tool-activity-'))
  async function compile(name: string) {
    const file = new URL('../../src/components/' + name + '.vue', import.meta.url)
    const { descriptor } = parse(await Bun.file(file).text(), { filename: file.pathname })
    const script = compileScript(descriptor, { id: name, inlineTemplate: true })
    const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(script.content)
      .replace(/import InlineImage from ["']\.\/InlineImage\.vue["'];?/, 'const InlineImage = { render: () => null };')
      .replace(/from (["'])([^"']+)\1/g, (_match, _quote, specifier: string) => 'from ' + JSON.stringify(
        specifier === './MessageItem.vue' ? pathToFileURL(join(directory, 'MessageItem.mjs')).href
          : specifier.startsWith('.') ? new URL(specifier + '.ts', file).href : import.meta.resolve(specifier)))
    const path = join(directory, name + '.mjs')
    await Bun.write(path, js)
    return (await import(pathToFileURL(path).href)).default
  }
  try { MessageItem = await compile('MessageItem'); ToolActivityGroup = await compile('ToolActivityGroup') }
  finally { await rm(directory, { recursive: true, force: true }) }
})
type RenderNode = { type: string; text: string; props: Record<string, unknown>; children: RenderNode[]; parent?: RenderNode }
const node = (type: string, text = ''): RenderNode => ({ type, text, props: {}, children: [] })
const renderer = createRenderer<RenderNode, RenderNode>({
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
const apps: App<RenderNode>[] = []
afterEach(() => { for (const app of apps.splice(0)) app.unmount() })
function descendants(target: RenderNode): RenderNode[] { return [target, ...target.children.flatMap(descendants)] }
function mountRows(items: Item[]) {
  const turns = ref([turn(items)]), rows = computed(() => buildActivityRows(turns.value)), root = node('root')
  const app = renderer.createApp({ setup: () => () => h('div', rows.value.map(row => 'group' in row
    ? h(ToolActivityGroup, { key: row.key, items: row.group }) : h(MessageItem, { key: row.key, item: row.item }))) })
  apps.push(app); app.mount(root)
  return {
    root,
    text: () => descendants(root).filter(target => target.type !== '#comment').map(target => target.text).join(' '),
    details: () => descendants(root).filter(target => target.type === 'details'),
    async update(items: Item[]) { turns.value = [turn(items)]; await nextTick() },
    async toggle(details: RenderNode, open: boolean) { (details.props.onToggle as (event: { target: { open: boolean } }) => void)({ target: { open } }); await nextTick() },
  }
}

describe('collapsed tool groups and streaming detail state', () => {
  test.each(['completed', 'inProgress'])('omits status badges for %s tool rows and groups', async status => {
    const view = mountRows([command('a', [read('/actual/a')], { status }), command('b', [read('/actual/b')], { status })])
    expect(view.text()).not.toContain('已完成'); expect(view.text()).not.toContain('进行中')
    expect(descendants(view.root).some(target => String(target.props.class || '').includes('activity-state'))).toBe(false)
    if (status === 'inProgress') expect(view.text()).toContain('正在读取')
    await view.toggle(view.details()[0]!, true)
    expect(descendants(view.root).some(target => String(target.props.class || '').includes('activity-state'))).toBe(false)
  })

  test('renders only the failure indicator and puts its count in the group title', async () => {
    const view = mountRows([command('a', undefined, { status: 'failed' }), command('b', undefined, { status: 'failed' }), command('c')])
    const badge = descendants(view.root).find(target => target.props.class === 'activity-state failed')!
    expect(badge.props.title).toBe('2 项失败')
    expect(view.text()).toContain('失败'); expect(view.text()).not.toContain('已完成')
    expect(view.text()).not.toContain('2 项失败')
    await view.toggle(view.details()[0]!, true)
    expect(descendants(view.root).filter(target => target.props.class === 'activity-state failed')).toHaveLength(3)
  })

  test('wraps a single read in a collapsed group and shows real paths only when expanded', async () => {
    const view = mountRows([command('a', [read('/actual/file.ts')])])
    expect(view.text()).toContain('已读取 1 个文件')
    expect(view.text()).not.toContain('/actual/file.ts')
    expect(view.details()).toHaveLength(1)
    expect(view.details()[0]!.props.open).toBe(false)
    await view.toggle(view.details()[0]!, true)
    expect(view.text()).toContain('读取 /actual/file.ts')
    expect(view.text()).not.toContain('guessed-name.txt')
    expect(view.details()).toHaveLength(2)
  })

  test('retains group and child open state through status, output and item-count updates', async () => {
    const a = command('a', [read('/actual/a')], { status: 'inProgress', command: 'printf "$HOME"' })
    const view = mountRows([a]), group = view.details()[0]!
    await view.toggle(group, true)
    const child = view.details()[1]!
    await view.toggle(child, true)
    await view.update([{ ...a, status: 'completed', aggregatedOutput: 'new output' }, command('b', [read('/actual/b')])])
    expect(view.details()[0]).toBe(group); expect(view.details()[1]).toBe(child)
    expect(group.props.open).toBe(true); expect(child.props.open).toBe(true)
    expect(view.text()).toContain('已读取 2 个文件'); expect(view.text()).toContain('new output')
    const html = descendants(view.root).find(target => target.type === 'code' && target.props.innerHTML)?.props.innerHTML as string
    expect(html).toContain('command-token-command'); expect(html).toContain('command-token-variable')
  })

  test('keeps failed command output and escaped highlighting inside the group', async () => {
    const view = mountRows([command('a', undefined, { status: 'failed', command: 'echo "<script>"', aggregatedOutput: '<img>stderr', error: { message: 'Denied <script>' } }), command('b')])
    expect(view.text()).not.toContain('已运行')
    expect(view.text()).toContain('失败')
    await view.toggle(view.details()[0]!, true); await view.toggle(view.details()[1]!, true)
    expect(view.text()).toContain('Denied <script>'); expect(view.text()).toContain('<img>stderr')
    const html = descendants(view.root).find(target => target.type === 'code' && target.props.innerHTML)?.props.innerHTML as string
    expect(html).toContain('&lt;script&gt;'); expect(html).not.toContain('<script>')
    expect(descendants(view.root).some(target => ['script', 'img'].includes(target.type))).toBe(false)
  })

  test('shows an ordinary command as one compact text summary and lazily mounts its output', async () => {
    const view = mountRows([command('a', undefined, { command: 'echo one\n  && echo two', aggregatedOutput: 'large output' })])
    expect(view.text()).toContain('echo one && echo two')
    expect(view.text()).not.toContain('large output')
    expect(descendants(view.root).some(target => target.props.innerHTML)).toBe(false)
    await view.toggle(view.details()[0]!, true)
    expect(view.text()).toContain('large output')
  })
})
