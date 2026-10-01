import { afterEach, beforeAll, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse, compileScript } from '@vue/compiler-sfc'
import { createRenderer, h, markRaw, nextTick, shallowReactive, type App, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { Approval, RpcId } from '../../shared/protocol'
let ApprovalIsland: Component
beforeAll(async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codex-reasoning-island-'))
  try {
    for (const name of ['ApprovalCard', 'ApprovalIsland']) {
      const file = new URL('../../src/components/' + name + '.vue', import.meta.url)
      const { descriptor } = parse(await Bun.file(file).text(), { filename: file.pathname })
      const script = compileScript(descriptor, { id: name, inlineTemplate: true })
      // Render both real components and their v-model directives. Only image previews
      // and CSS animation wrappers are stubbed; the host has no browser/layout engine.
      let wrappers = ''
      const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(script.content)
        .replace(/import InlineImage from ["']\.\/InlineImage\.vue["'];?/, 'const InlineImage = { render: () => null };')
        .replace(/\b(TransitionGroup|Transition) as (\w+),?/g, (_match, name, alias) => {
          wrappers += name === 'Transition'
            ? `const ${alias} = { props: ['name'], setup: (_, { slots }) => () => slots.default?.() };\n`
            : `const ${alias} = { props: ['tag', 'name'], setup: (props, { slots }) => () => __hostH(props.tag || 'div', null, slots.default?.()) };\n`
          return ''
        })
        .replace(/from (["'])([^"']+)\1/g, (_match, _quote, specifier: string) => 'from ' + JSON.stringify(specifier.endsWith('.vue')
          ? specifier.replace(/\.vue$/, '.mjs')
          : specifier.startsWith('.') ? new URL(specifier + '.ts', file).href : import.meta.resolve(specifier)))
      await Bun.write(join(directory, name + '.mjs'), `import { h as __hostH } from ${JSON.stringify(import.meta.resolve('vue'))};\n${wrappers}${js}`)
    }
    ApprovalIsland = (await import(pathToFileURL(join(directory, 'ApprovalIsland.mjs')).href)).default
  }
  finally { await rm(directory, { recursive: true, force: true }) }
})
test.each(['', '  ', undefined])('omits empty live reasoning %p', async reasoning => {
  const html = await renderToString(h(ApprovalIsland, { approvals: [], reasoning, thinkingElapsed: 7 }))
  expect(html).not.toContain('island-thinking-preview')
  expect(html).not.toContain('思考中')
})
test('shows the live preview and real elapsed time inside the island', async () => {
  const html = await renderToString(h(ApprovalIsland, { approvals: [], reasoning: '正在核对实际事件', thinkingElapsed: 7 }))
  expect(html).toContain('island-thinking-preview')
  expect(html).toContain('正在核对实际事件')
  expect(html).toContain('7秒')
})
test('never invents a duration or interprets reasoning as HTML', async () => {
  const html = await renderToString(h(ApprovalIsland, { approvals: [], reasoning: '<script>unsafe()</script>' }))
  expect(html).not.toContain('island-thinking-time')
  expect(html).not.toContain('<script>')
  expect(html).toContain('&lt;script&gt;')
})
test('approval requests take priority over the live preview', async () => {
  const html = await renderToString(h(ApprovalIsland, { approvals: [{ id: 1, method: 'item/commandExecution/requestApproval', params: { threadId: 'a', command: 'pwd' } }], reasoning: '实时思考' }))
  expect(html).toContain('island-header')
  expect(html).not.toContain('island-thinking-preview')
  expect(html).not.toContain('实时思考')
})
test.each([false, true])('pending steer is visible in the island with accepted=%s', async accepted => {
  const html = await renderToString(h(ApprovalIsland, { approvals: [], steers: [{ id: 'pending', accepted, parts: [{ type: 'text', text: '先处理这条插话' }] }] }))
  expect(html).toContain('先处理这条插话')
  expect(html).toContain(accepted ? '待插入' : '正在发送插话…')
})

// Minimal DOM-shaped host for Vue refs, v-show, v-model and focus. Event handlers
// come from the compiled templates; tests never reach into private setup state.
class HostNode {
  props: Record<string, any> = {}
  children: HostNode[] = []
  parent?: HostNode
  style = { display: '' }
  value = ''
  checked = false
  scrolls = 0
  listeners = new Map<string, ((event: any) => void)[]>()
  constructor(readonly tag: string, public text = '') { markRaw(this) }
  get tagName() { return this.tag.toUpperCase() }
  get type() { return this.props.type }
  getRootNode() { return hostDocument }
  contains(other: unknown): boolean { return this === other || this.children.some(child => child.contains(other)) }
  focus() { hostDocument!.activeElement = this }
  scrollIntoView() { this.scrolls++ }
  querySelector() { return all(this).find(node => node.props['aria-selected'] === true) }
  closest() {
    let node: HostNode | undefined = this
    while (node) {
      if (['input', 'textarea', 'select'].includes(node.tag) || (node.props.contenteditable !== undefined && node.props.contenteditable !== 'false')) return node
      node = node.parent
    }
    return null
  }
  addEventListener(name: string, handler: (event: any) => void) { this.listeners.set(name, [...(this.listeners.get(name) || []), handler]) }
  fire(name: string) { for (const handler of this.listeners.get(name) || []) handler({ target: this }) }
}
class HostDocument {
  body = new HostNode('body')
  activeElement: HostNode | null = this.body
  composer = new HostNode('textarea')
  getElementById(id: string) { return id === 'message-input' ? this.composer : null }
}
let hostDocument: HostDocument | undefined
const apps = new Set<App<HostNode>>()
const globals = new Map<string, PropertyDescriptor | undefined>()
function setGlobal(name: string, value: unknown) {
  if (!globals.has(name)) globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
}
afterEach(() => {
  for (const app of apps) app.unmount()
  apps.clear()
  for (const [name, descriptor] of globals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else Reflect.deleteProperty(globalThis, name)
  }
  globals.clear(); hostDocument = undefined
})
function detach(node: HostNode) {
  if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1)
  node.parent = undefined
}
const renderer = createRenderer<HostNode, HostNode>({
  createElement: tag => new HostNode(tag), createText: text => new HostNode('#text', text), createComment: () => new HostNode('#comment'),
  patchProp(node, key, _previous, value) { node.props[key] = value; if (key === 'value') node.value = value },
  setText(node, text) { node.text = text },
  setElementText(node, text) { node.text = text; node.children = [] },
  insert(node, parent, anchor) { detach(node); node.parent = parent; const at = anchor ? parent.children.indexOf(anchor) : -1; parent.children.splice(at < 0 ? parent.children.length : at, 0, node) },
  remove(node) {
    if (node.contains(hostDocument?.activeElement)) hostDocument!.activeElement = hostDocument!.body
    detach(node)
  },
  parentNode: node => node.parent || null, nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] || null,
})
const all = (node: HostNode): HostNode[] => [node, ...node.children.flatMap(all)]
const textContent = (node: HostNode): string => node.text + node.children.map(textContent).join('')
const hasClass = (node: HostNode, name: string) => String(node.props.class || '').split(' ').includes(name)
const visible = (node: HostNode): boolean => node.style.display !== 'none' && (!node.parent || visible(node.parent))
const tabs = [{ id: 'all', label: '全部' }, { id: 'files', label: '文件' }, { id: 'skills', label: '技能' }]
const ask = (id: RpcId, choice = false): Approval => ({ id, method: 'item/tool/requestUserInput', params: { questions: [{ id: 'answer', header: 'Answer', question: `Question ${typeof id}:${id}`, ...(choice ? { isOther: true, options: [{ label: 'Yes', description: 'Use this choice' }] } : {}) }] } })
type IslandProps = { approvals: Approval[]; completionOpen?: boolean; completionTitle?: string; completionTabs?: typeof tabs; completionTab?: string; hasQueue?: boolean; disabled?: boolean; reasoning?: string; steers?: { id: string; accepted: boolean; cancelable?: boolean; parts: { type: 'text'; text: string }[] }[] }
type IslandApi = { navigate(direction: number): void; movePage(direction: number): void; showCompletion(): void }
async function mountIsland(initial: Partial<IslandProps> = {}) {
  hostDocument = new HostDocument()
  setGlobal('document', hostDocument); setGlobal('Document', HostDocument); setGlobal('ShadowRoot', class {})
  const props = shallowReactive<IslandProps>({ approvals: [], ...initial }), root = new HostNode('root')
  const tabEvents: string[] = [], activeEvents: boolean[] = [], hosts: (HostNode | null)[] = [], responses: [RpcId, unknown][] = [], withdrawals: string[] = []
  let api!: IslandApi
  const app = renderer.createApp({ setup: () => () => h(ApprovalIsland, {
    ...props, ref: (value: unknown) => { api = value as IslandApi },
    'onUpdate:completionTab': (id: string) => { tabEvents.push(id); props.completionTab = id },
    onCompletionActive: (active: boolean) => activeEvents.push(active), onCompletionHost: (host: HostNode | null) => hosts.push(host),
    onRespond: (id: RpcId, result: unknown) => responses.push([id, result]), onWithdrawSteer: (id: string) => withdrawals.push(id),
  }, { default: () => h('div', { 'data-slot': 'project' }, 'Project'), goal: () => h('div', { 'data-slot': 'goal' }, 'Goal'), queue: () => h('div', { 'data-slot': 'queue' }, 'Queue') }) })
  apps.add(app); app.mount(root); await nextTick()
  const find = (predicate: (node: HostNode) => boolean) => all(root).find(predicate)
  const byClass = (name: string) => find(node => hasClass(node, name))
  return { props, root, api, tabEvents, activeEvents, hosts, responses, withdrawals, document: hostDocument, find, byClass,
    page: () => textContent(byClass('island-page-header')!).replace(/\s*(\d+ \/ \d+)$/, ' $1'),
    field: (label = 'Answer') => find(node => node.tag === 'input' && node.props['aria-label'] === label)!,
    async update(changes: Partial<IslandProps>) { Object.assign(props, changes); await nextTick() },
    async move(direction: number) { api.movePage(direction); await nextTick() },
    async navigate(direction: number) { api.navigate(direction); await nextTick() },
    async click(label: string) { find(node => node.tag === 'button' && node.props['aria-label'] === label)!.props.onClick(); await nextTick() },
    async type(value: string, label = 'Answer') { const field = find(node => node.tag === 'input' && node.props['aria-label'] === label)!; field.value = value; field.fire('input'); await nextTick() },
    async key(key: string, target: unknown = byClass('composer-island')) {
      const event = { key, target, prevented: false, stopped: false, preventDefault() { this.prevented = true }, stopPropagation() { this.stopped = true } }
      byClass('composer-island')!.props.onKeydown(event); await nextTick(); return event
    },
  }
}

test.each(['命令', '提及', '技能'])('%s completion keeps tabs at the bottom and omits empty pages', async title => {
  const view = await mountIsland({ completionOpen: true, completionTitle: title, completionTabs: tabs, completionTab: 'all', reasoning: '  ', steers: [] })
  expect(view.page()).toBe(title)
  expect(view.byClass('island-content')).toBeUndefined()
  const section = view.byClass('composer-island')!, tablist = view.byClass('island-completion-tabs')!
  expect(section.children.at(-1)).toBe(tablist)
  expect(all(tablist).filter(node => node.props.role === 'tab').map(textContent)).toEqual(tabs.map(tab => tab.label))
  expect(view.find(node => node.props['aria-label'] === '浮岛下一页')!.props.disabled).toBe(true)
  expect(view.find(node => node.props['aria-label'] === '浮岛上一页')!.props.disabled).toBe(true)
  for (const name of ['project', 'goal']) expect(visible(view.find(node => node.props['data-slot'] === name)!)).toBe(false)
  await view.navigate(-1); expect(view.page()).toBe(title); expect(view.tabEvents).toEqual([])
})

test('pages include exactly the real requests, queue, steers and nonblank reasoning', async () => {
  const view = await mountIsland({ completionOpen: true, approvals: [ask(0), ask('second')], hasQueue: true, steers: [{ id: 's', accepted: true, parts: [{ type: 'text', text: '插话' }] }], reasoning: '检查实现', completionTabs: tabs, completionTab: 'all' })
  const sequence = [
    ['列表', 'island-completion-host'], ['Codex 想确认一下', 'island-content'], ['Codex 想确认一下', 'island-content'],
    ['消息队列', 'island-queue'], ['待插入的消息', 'island-steers'], ['思考进度', 'island-thinking'],
  ]
  for (const [index, [label, name]] of sequence.entries()) {
    expect(view.page()).toBe(`${label} ${index + 1} / 6`)
    expect(visible(view.byClass(name!)!)).toBe(true)
    if (index === 1 || index === 2) expect(textContent(view.find(node => node.tag === 'legend')!)).toBe(index === 1 ? 'Question number:0' : 'Question string:second')
    else expect(view.byClass('island-content')).toBeUndefined()
    for (const slot of ['project', 'goal']) expect(visible(view.find(node => node.props['data-slot'] === slot)!)).toBe(false)
    expect(!!view.byClass('island-completion-tabs')).toBe(index === 0)
    await view.move(1)
  }
  expect(view.page()).toBe('列表 1 / 6')
  expect(view.hosts).toHaveLength(1)
  expect(view.activeEvents).toEqual([true, false, true])
})

const dynamicPages: { label: string; present: Partial<IslandProps>; absent: Partial<IslandProps> }[] = [
  { label: '消息队列', present: { hasQueue: true }, absent: { hasQueue: false } },
  { label: '待插入的消息', present: { steers: [{ id: 's', accepted: false, parts: [{ type: 'text' as const, text: 'hello' }] }] }, absent: { steers: [] } },
  { label: '思考进度', present: { reasoning: 'working' }, absent: { reasoning: '\n  ' } },
]
test.each(dynamicPages)('adds/removes the $label page from live props without phantom pages', async ({ label, present, absent }) => {
  const view = await mountIsland({ completionOpen: true })
  await view.update(present); expect(view.page()).toBe('列表 1 / 2')
  await view.move(1); expect(view.page()).toBe(`${label} 2 / 2`)
  await view.update(absent); expect(view.page()).toBe('列表')
  await view.move(1); expect(view.page()).toBe('列表')
})

test('ArrowLeft/Right changes tabs first, then pages at both edges', async () => {
  const view = await mountIsland({ completionOpen: true, completionTabs: tabs, completionTab: 'all', approvals: [ask(1)], hasQueue: true })
  expect((await view.key('ArrowRight')).prevented).toBe(true)
  expect(view.props.completionTab).toBe('files'); expect(view.page()).toBe('列表 1 / 3')
  await view.key('ArrowRight'); expect(view.props.completionTab).toBe('skills')
  await view.key('ArrowRight'); expect(view.page()).toBe('Codex 想确认一下 2 / 3')
  await view.key('ArrowLeft'); expect(view.page()).toBe('列表 1 / 3'); expect(view.props.completionTab).toBe('skills')
  await view.key('ArrowLeft'); await view.key('ArrowLeft'); expect(view.props.completionTab).toBe('all')
  await view.key('ArrowLeft'); expect(view.page()).toBe('消息队列 3 / 3')
  await view.key('ArrowRight'); expect(view.props.completionTab).toBe('all'); expect(view.page()).toBe('列表 1 / 3')
  expect(view.tabEvents).toEqual(['files', 'skills', 'skills', 'files', 'all', 'all'])
  await view.click('浮岛下一页'); expect(view.page()).toBe('Codex 想确认一下 2 / 3')
})

test('arrow handling leaves editable targets alone and tolerates missing DOM targets', async () => {
  const view = await mountIsland({ completionOpen: true, approvals: [ask(1)], hasQueue: true })
  await view.move(1)
  for (const target of [view.field(), new HostNode('textarea'), new HostNode('select')]) {
    expect((await view.key('ArrowRight', target)).prevented).toBe(false)
  }
  const editable = new HostNode('div'), child = new HostNode('span'); editable.props.contenteditable = 'plaintext-only'; child.parent = editable
  expect((await view.key('ArrowRight', child)).prevented).toBe(false)
  expect((await view.key('ArrowDown')).prevented).toBe(false)
  expect(view.page()).toBe('Codex 想确认一下 2 / 3')
  expect((await view.key('ArrowRight', null)).stopped).toBe(true)
  expect(view.page()).toBe('消息队列 3 / 3')
})

test('real approval forms retain separate text/other drafts and emit the current typed ID', async () => {
  const first = ask(1), second = ask('1', true)
  const view = await mountIsland({ approvals: [first, second] })
  await view.type('first draft'); await view.click('下一个请求')
  view.find(node => node.tag === 'input' && node.value === '__other')!.fire('change'); await nextTick()
  await view.type('custom answer', 'Answer，其他回答')
  await view.click('上一个请求'); expect(view.field().value).toBe('first draft')
  await view.update({ approvals: [second, first] }); expect(view.field().value).toBe('first draft')
  await view.click('上一个请求'); expect(view.field('Answer，其他回答').value).toBe('custom answer')
  view.find(node => node.tag === 'form')!.props.onSubmit({ preventDefault() {} }); await nextTick()
  expect(view.responses).toEqual([['1', { answers: { answer: { answers: ['custom answer'] } } }]])
  // A failed/pending response leaves the request and its unfinished draft intact.
  expect(view.field('Answer，其他回答').value).toBe('custom answer')
  await view.update({ disabled: true }); expect(view.find(node => node.tag === 'button' && node.props.type === 'submit')!.props.disabled).toBe(true)
  await view.update({ approvals: [first] }); expect(view.field().value).toBe('first draft')
  await view.update({ approvals: [first, second], disabled: false }); await view.click('下一个请求')
  expect(view.field('Answer，其他回答')).toBeUndefined()
  expect(view.find(node => node.tag === 'input' && node.value === '__other')!.checked).toBe(false)
})

test.each([0, 1, 2])('deleting request index %i selects the next actual request, including wraparound', async selected => {
  const approvals = [ask(1), ask(2), ask(3)]
  const view = await mountIsland({ completionOpen: true, approvals, hasQueue: true, reasoning: 'working' })
  for (let index = 0; index <= selected; index++) await view.move(1)
  view.field().focus()
  await view.update({ approvals: approvals.filter((_, index) => index !== selected) })
  const next = approvals[(selected + 1) % approvals.length]!
  expect(textContent(view.find(node => node.tag === 'legend')!)).toBe(`Question number:${next.id}`)
  expect(view.document.activeElement).toBe(view.byClass('island-content')!)
  await view.update({ completionOpen: false })
  expect(textContent(view.find(node => node.tag === 'legend')!)).toBe(`Question number:${next.id}`)
})

test('removing a trailing queue selects a real request and preserves it when completion closes', async () => {
  const view = await mountIsland({ completionOpen: true, approvals: [ask(1), ask(2)], hasQueue: true })
  await view.move(-1); expect(view.page()).toBe('消息队列 4 / 4')
  await view.update({ hasQueue: false }); expect(view.page()).toBe('Codex 想确认一下 3 / 3')
  await view.type('second draft'); await view.update({ completionOpen: false })
  expect(textContent(view.find(node => node.tag === 'legend')!)).toBe('Question number:2')
  expect(view.field().value).toBe('second draft')
})

test.each(['queue', 'completion'])('paging from a focused approval to %s restores composer focus and retains the draft', async destination => {
  const view = await mountIsland({ completionOpen: true, approvals: [ask(1)], hasQueue: true })
  await view.move(1); await view.type('keep this draft')
  const previous = view.field(); previous.focus()
  if (destination === 'queue') await view.move(1)
  else { view.api.showCompletion(); await nextTick(); await nextTick() }
  expect(view.byClass('island-content')).toBeUndefined()
  expect(view.root.contains(previous)).toBe(false)
  expect(view.document.activeElement).toBe(view.document.composer)
  await view.move(destination === 'queue' ? -1 : 1)
  expect(view.field().value).toBe('keep this draft')
  expect(view.document.activeElement).toBe(view.document.composer)
})

test('closing the final request returns focus to the composer and reveals independent slots', async () => {
  const view = await mountIsland({ approvals: [ask(1)], reasoning: 'working' })
  view.field().focus(); await view.update({ approvals: [] })
  expect(view.document.activeElement).toBe(view.document.composer)
  expect(visible(view.byClass('island-thinking')!)).toBe(true)
  for (const name of ['project', 'goal']) expect(visible(view.find(node => node.props['data-slot'] === name)!)).toBe(true)
})

test('project and goal share one context row and stay mounted while requests or completion hide them', async () => {
  const view = await mountIsland()
  const context = view.byClass('island-context')!, project = view.find(node => node.props['data-slot'] === 'project')!, goal = view.find(node => node.props['data-slot'] === 'goal')!
  expect(project.parent).toBe(view.byClass('island-project')!)
  expect(goal.parent).toBe(view.byClass('island-goal')!)
  expect(project.parent!.parent).toBe(context); expect(goal.parent!.parent).toBe(context)
  expect(visible(project)).toBe(true); expect(visible(goal)).toBe(true)
  await view.update({ approvals: [ask(1)] })
  expect(visible(project)).toBe(false); expect(visible(goal)).toBe(false)
  await view.update({ approvals: [], completionOpen: true })
  expect(visible(project)).toBe(false); expect(visible(goal)).toBe(false)
  await view.update({ completionOpen: false })
  expect(visible(project)).toBe(true); expect(visible(goal)).toBe(true)
  expect(view.find(node => node.props['data-slot'] === 'project')).toBe(project)
  expect(view.find(node => node.props['data-slot'] === 'goal')).toBe(goal)
})

test('completion opening releases approval focus, keeps its host while paging, and clears it on close', async () => {
  const view = await mountIsland({ approvals: [ask(1)], completionTabs: tabs, completionTab: 'all' })
  await view.type('saved'); view.field().focus(); await view.update({ completionOpen: true })
  expect(view.document.activeElement).toBe(view.document.composer)
  expect(view.activeEvents).toEqual([false, true]); expect(view.hosts).toHaveLength(1)
  await view.move(1); expect(view.hosts).toHaveLength(1); expect(view.activeEvents.at(-1)).toBe(false)
  await view.update({ completionOpen: false }); expect(view.hosts.at(-1)).toBeNull(); expect(view.field().value).toBe('saved')
  await view.navigate(1); expect(view.tabEvents).toEqual([])
})

test('tab scrolling uses only current mounted refs after paging removes the tablist', async () => {
  const view = await mountIsland({ completionOpen: true, completionTabs: tabs, completionTab: 'all', approvals: [ask(1)] })
  const oldTabs = all(view.byClass('island-completion-tabs')!).filter(node => node.props.role === 'tab')
  view.props.completionTab = 'files'; view.api.movePage(1); await nextTick()
  expect(oldTabs.every(node => node.scrolls === 0)).toBe(true)
  view.api.showCompletion(); view.props.completionTab = 'skills'; await nextTick(); await nextTick()
  const active = view.find(node => node.props['aria-selected'] === true)!
  expect(active.scrolls).toBe(1); expect(oldTabs.includes(active)).toBe(false)
})

test('navigation tolerates document being absent and never grabs unrelated focus', async () => {
  const view = await mountIsland({ completionOpen: true, approvals: [ask(1), ask(2)], hasQueue: true })
  await view.move(1); view.document.composer.focus(); await view.move(1)
  expect(view.document.activeElement).toBe(view.document.composer)
  setGlobal('document', undefined)
  await view.move(1); view.api.showCompletion(); await nextTick()
  expect(view.page()).toBe('列表 1 / 4')
})
