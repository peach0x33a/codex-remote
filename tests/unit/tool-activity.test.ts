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
    expect(summarizeToolActivity(items).title).toBe('读取了 3 个文件')
    expect(toolActivityTitle(items[0]!)).toBe('读取了 2 个文件')
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

})

describe('truthful activity summaries', () => {

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
let MessageItem: Component, ToolActivityGroup: Component, UpdateBanner: Component
beforeAll(async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codex-tool-activity-'))
  async function compile(name: string) {
    const file = new URL('../../src/components/' + name + '.vue', import.meta.url)
    const { descriptor } = parse(await Bun.file(file).text(), { filename: file.pathname })
    const script = compileScript(descriptor, { id: name, inlineTemplate: true })
    const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(script.content)
      .replace(/import (AudioContent|ToolContent) from ["']\.\/[^"']+\.vue["'];?/g, (_match, name) => 'const ' + name + ' = { render: () => null };')
    .replace(/import MarkdownContent from ["']\.\/MarkdownContent\.vue["'];?/, 'const MarkdownContent = { props: ["text"], render() { return __hostH("div", { class: "markdown", innerHTML: this.text }) } };')
    .replace(/import InlineFile from ["']\.\/InlineFile\.vue["'];?/, 'const InlineFile = { render: () => null };')
    .replace(/import InlineImage from ["']\.\/InlineImage\.vue["'];?/, 'const InlineImage = { render: () => null };')
      .replace(/import PastedText from ["']\.\/PastedText\.vue["'];?/, 'const PastedText = { render: () => null };')
      .replace(/import FileChangeActivity from ["']\.\/FileChangeActivity\.vue["'];?/, 'const FileChangeActivity = { render: () => null };')
      .replace(/from (["'])([^"']+)\1/g, (_match, _quote, specifier: string) => 'from ' + JSON.stringify(
        specifier === './MessageItem.vue' ? pathToFileURL(join(directory, 'MessageItem.mjs')).href
          : specifier.startsWith('.') ? new URL(specifier + '.ts', file).href : import.meta.resolve(specifier)))
    const path = join(directory, name + '.mjs')
    await Bun.write(path, `import { h as __hostH } from ${JSON.stringify(import.meta.resolve('vue'))};\n${js}`)
    return (await import(pathToFileURL(path).href)).default
  }
  try { MessageItem = await compile('MessageItem'); ToolActivityGroup = await compile('ToolActivityGroup'); UpdateBanner = await compile('UpdateBanner') }
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
    expect(view.text()).toContain('读取了 1 个文件')
    expect(view.text()).not.toContain('/actual/file.ts')
    expect(view.details()).toHaveLength(1)
    expect(view.details()[0]!.props.open).toBe(false)
    await view.toggle(view.details()[0]!, true)
    expect(view.text()).toContain('/actual/file.ts')
    expect(view.text()).toContain('执行详情')
    expect(view.text()).not.toContain('读取 /actual/file.ts')
    const list = descendants(view.root).find(target => target.type === 'ul' && target.props['aria-label'] === '读取的文件')!
    expect(list.children.filter(target => target.type === 'li')).toHaveLength(1)
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
    expect(view.text()).toContain('读取了 2 个文件'); expect(view.text()).toContain('new output')
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

})

test('update banner allows manual updates, blocks duplicate clicks and allows retry after failure', async () => {
  let calls = 0, reject: ((cause: Error) => void) | undefined
  const errors: string[] = []
  const props = ref({ available: true, update: () => { calls++; return new Promise<void>((_resolve, fail) => { reject = fail }) }, onError: (message: string) => errors.push(message) })
  const root = node('root'), app = renderer.createApp({ setup: () => () => h(UpdateBanner, props.value) })
  apps.push(app); app.mount(root)
  const button = () => descendants(root).find(target => target.type === 'button')!
  const click = () => (button().props.onClick as () => Promise<void>)()
  expect(button().props.disabled).toBe(false)
  const pending = click(); await nextTick(); expect(button().props.disabled).toBe(true)
  await click(); expect(calls).toBe(1)
  reject!(new Error('Update failed')); await pending; await nextTick()
  expect(errors).toEqual(['更新失败，请稍后点击重试。'])
  expect(button().props.disabled).toBe(false)
  const retry = click(); expect(calls).toBe(2)
  reject!(new Error('Still unavailable')); await retry; await nextTick()
  expect(button().props.disabled).toBe(false)
  props.value.available = false; await nextTick(); expect(descendants(root).some(target => target.type === 'button')).toBe(false)
})
