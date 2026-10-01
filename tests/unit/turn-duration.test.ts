import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { compileScript, parse } from '@vue/compiler-sfc'
import { createRenderer, defineComponent, h, nextTick, ref, type App, type Component } from 'vue'
import type { Item, Turn } from '../../shared/protocol'
import { completedTurnDurations, formatWorkDuration, turnDurationSeconds } from '../../src/lib/turn-duration'

const answer = (id = 'answer', patch: Partial<Item> = {}): Item => ({ id, type: 'agentMessage', phase: 'final_answer', text: '工作完成', ...patch })
const turn = (patch: Partial<Turn> = {}): Turn => ({ id: 'turn', status: 'completed', items: [answer()], ...patch })

describe('persisted turn duration', () => {
  test('prefers the native millisecond duration over second-resolution timestamps', () => {
    expect(turnDurationSeconds({ startedAt: 1750000000, completedAt: 1750000139, durationMs: 138250 })).toBe(138.25)
  })

  test('duration alone survives history with missing start/end timestamps', () => {
    expect(turnDurationSeconds({ startedAt: null, completedAt: null, durationMs: 138000 })).toBe(138)
    expect(turnDurationSeconds({ durationMs: 0 })).toBe(0)
    expect(turnDurationSeconds({ durationMs: 800 })).toBe(0.8)
  })

  test('falls back to actual Unix-second start and completion, including epoch zero', () => {
    expect(turnDurationSeconds({ startedAt: 1750000000, completedAt: 1750000138 })).toBe(138)
    expect(turnDurationSeconds({ startedAt: 0, completedAt: 138 })).toBe(138)
    expect(turnDurationSeconds({ startedAt: 10.5, completedAt: 11.75 })).toBe(1.25)
    expect(turnDurationSeconds({ startedAt: 12, completedAt: 12 })).toBe(0)
  })

  test.each([undefined, null, -1, NaN, Infinity, -Infinity])('invalid/missing duration %s falls back only when both timestamps exist', durationMs => {
    expect(turnDurationSeconds({ durationMs, startedAt: 10, completedAt: 20 })).toBe(10)
    expect(turnDurationSeconds({ durationMs })).toBeUndefined()
  })

  test.each([
    {}, { startedAt: 10 }, { completedAt: 20 }, { startedAt: null, completedAt: 20 },
    { startedAt: 10, completedAt: null }, { startedAt: 20, completedAt: 10 },
    { startedAt: -1, completedAt: 20 }, { startedAt: 10, completedAt: -1 },
    { startedAt: NaN, completedAt: 20 }, { startedAt: 10, completedAt: NaN },
    { startedAt: Infinity, completedAt: Infinity }, { startedAt: 10, completedAt: Infinity },
  ])('does not invent a duration for invalid/incomplete timestamps: %j', timing => {
    expect(turnDurationSeconds(timing)).toBeUndefined()
  })
})

describe('final-message duration mapping', () => {
  test('maps only the last explicit final answer of each completed turn', () => {
    const first = turn({ durationMs: 138000, items: [
      { id: 'user', type: 'userMessage' },
      answer('progress', { phase: 'commentary' }),
      { id: 'tool', type: 'commandExecution', status: 'completed' },
      { id: 'reasoning', type: 'reasoning', summary: ['thinking'] },
      answer('earlier-final'), answer('final'),
      { id: 'after-tool', type: 'commandExecution', status: 'completed' },
    ] })
    const second = turn({ id: 'second', startedAt: 1000, completedAt: 1042, items: [answer('second-final')] })
    expect([...completedTurnDurations([first, second])]).toEqual([['final', 138], ['second-final', 42]])
  })

  test('supports only the last assistant message in legacy history without phases', () => {
    const items = [answer('intermediate', { phase: undefined }), answer('legacy-final', { phase: undefined })]
    expect([...completedTurnDurations([turn({ durationMs: 3000, items })])]).toEqual([['legacy-final', 3]])
  })

  test('does not label an earlier final answer when a later assistant output exists', () => {
    const items = [answer('final'), answer('unclassified', { phase: undefined })]
    expect([...completedTurnDurations([turn({ durationMs: 3000, items })])]).toEqual([['unclassified', 3]])
  })

  test.each(['inProgress', 'failed', 'interrupted', 'cancelled', 'queued'])('does not label a %s turn', status => {
    expect(completedTurnDurations([turn({ status, durationMs: 138000 })]).size).toBe(0)
  })

  test('does not label a turn carrying a terminal error', () => {
    expect(completedTurnDurations([turn({ durationMs: 138000, error: { message: 'failed' } })]).size).toBe(0)
  })

  test.each(([
    [], [answer('commentary', { phase: 'commentary' })],
    [answer('intermediate', { phase: undefined }), answer('commentary', { phase: 'commentary' })],
    [answer('earlier-final'), answer('commentary', { phase: 'commentary' })],
    [answer('earlier'), answer('empty', { text: '' })],
    [answer('earlier'), answer('whitespace', { text: '  \n ' })],
    [answer('earlier'), answer('streaming', { status: 'inProgress' })],
    [answer('earlier'), answer('failed', { status: 'failed' })],
    [answer('error', { error: 'failed' })],
    [answer('analysis', { phase: 'analysis' })],
    [{ id: 'tool', type: 'commandExecution', text: 'done' }],
    [{ id: 'plan', type: 'plan', text: 'done' }],
    [{ id: 'reasoning', type: 'reasoning', text: 'done' }],
  ] as Item[][]).map(items => ({ items })))('omits turns without a renderable successful final message: %j', ({ items }) => {
    expect(completedTurnDurations([turn({ durationMs: 3000, items })]).size).toBe(0)
  })

  test('omits history without turn timing instead of using message timestamps or the clock', () => {
    const items = [answer('final', { startedAtMs: 1000, completedAtMs: 3000 })]
    expect(completedTurnDurations([turn({ items })]).size).toBe(0)
    expect(completedTurnDurations([]).size).toBe(0)
  })

  test('keeps real zero durations and does not mutate turn history', () => {
    const source = turn({ durationMs: 0 })
    const original = structuredClone(source)
    Object.freeze(source.items[0]); Object.freeze(source.items); Object.freeze(source)
    expect([...completedTurnDurations(Object.freeze([source]))]).toEqual([['answer', 0]])
    expect(source).toEqual(original)
  })
})

describe('compact Chinese duration', () => {
  test.each([
    [0, '工作了 0 秒'], [0.8, '工作了 0 秒'], [1, '工作了 1 秒'],
    [59.99, '工作了 59 秒'], [60, '工作了 1 分'], [138, '工作了 2 分 18 秒'],
    [3599.99, '工作了 59 分 59 秒'], [3600, '工作了 1 小时'],
    [3601, '工作了 1 小时 1 秒'], [3738, '工作了 1 小时 2 分 18 秒'],
    [86400, '工作了 1 天'], [90138, '工作了 1 天 1 小时 2 分 18 秒'],
  ] as const)('formats %s seconds as %s', (seconds, label) => {
    expect(formatWorkDuration(seconds)).toBe(label)
  })

  test.each([undefined, NaN, Infinity, -Infinity, -1, -0.01])('hides invalid/missing duration %s', seconds => {
    expect(formatWorkDuration(seconds)).toBeUndefined()
  })
})

// Exercise the real SFC without a browser, listener, network, or DOM implementation.
let MessageItem: Component
beforeAll(async () => {
  const file = new URL('../../src/components/MessageItem.vue', import.meta.url)
  const { descriptor } = parse(await Bun.file(file).text(), { filename: file.pathname })
  const compiled = compileScript(descriptor, { id: 'turn-duration-test', inlineTemplate: true })
  const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(compiled.content)
    .replace(/import[^;]*from ["'](?:\.\/InlineImage\.vue|\.\.\/lib\/(?:markdown|details-motion))["'];?/g, '')
    .replace(/from (["'])([^"']+)\1/g, (_match, _quote, specifier: string) =>
      'from ' + JSON.stringify(specifier.startsWith('.') ? new URL(specifier + '.ts', file).href : import.meta.resolve(specifier)))
    .replace('export default', 'export default (InlineImage, renderMarkdown, vAnimatedDetails) =>')
  const directory = await mkdtemp(join(tmpdir(), 'codex-turn-duration-'))
  try {
    const path = join(directory, 'message-item.mjs')
    await Bun.write(path, js)
    const factory = (await import(pathToFileURL(path).href)).default
    MessageItem = factory(defineComponent(() => () => h('image-stub')), (text: string) => text, {})
  } finally { await rm(directory, { recursive: true, force: true }) }
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
const descendants = (target: Node): Node[] => [target, ...target.children.flatMap(descendants)]
const apps: App<Node>[] = []
afterEach(() => { for (const app of apps.splice(0)) app.unmount() })
function mount(item = answer(), workDurationSeconds?: number) {
  const props = ref({ item, workDurationSeconds }), root = node('root'), copies: string[] = []
  const app = renderer.createApp({ setup: () => () => h(MessageItem, { ...props.value, onCopy: (text: string) => copies.push(text) }) })
  apps.push(app); app.mount(root)
  const byClass = (name: string) => descendants(root).find(target => String(target.props.class || '').split(' ').includes(name))
  return { root, props, copies, byClass, button: () => descendants(root).find(target => target.props['aria-label'] === '复制回复') }
}

describe('MessageItem completed-work footer', () => {
  test('puts the duration beside the accessible copy button and copies only the answer', () => {
    const view = mount(answer('final', { text: '**完成**' }), 138)
    const button = view.button()!, duration = view.byClass('work-duration')!
    expect(duration.text).toBe('工作了 2 分 18 秒')
    expect(duration.parent).toBe(button.parent)
    expect(button.parent?.children.filter(child => child.type !== '#comment')).toEqual([button, duration])
    expect(button.props.type).toBe('button')
    ;(button.props.onClick as () => void)()
    expect(view.copies).toEqual(['**完成**'])
  })

  test.each([undefined, NaN, Infinity, -1])('keeps copy available without a visible invalid duration %s', duration => {
    const view = mount(answer(), duration)
    expect(view.button()).toBeDefined()
    expect(view.byClass('work-duration')).toBeUndefined()
  })

  test('renders a known zero duration', () => {
    expect(mount(answer(), 0).byClass('work-duration')?.text).toBe('工作了 0 秒')
  })

  test('renders no empty action row for a message without text', () => {
    const view = mount(answer('empty', { text: '' }), 138)
    expect(view.byClass('agent-message-actions')).toBeUndefined()
    expect(view.button()).toBeUndefined()
  })

  test.each([
    { phase: 'commentary' }, { phase: 'analysis' }, { status: 'inProgress' },
    { status: 'failed' }, { status: 'interrupted' }, { error: 'failed' }, { text: '   ' },
    { type: 'userMessage' }, { type: 'plan' }, { type: 'reasoning' }, { type: 'commandExecution' },
  ])('never renders a duration on an ineligible item even when supplied: %j', patch => {
    expect(mount(answer('not-final', patch), 138).byClass('work-duration')).toBeUndefined()
  })

  test('reactively follows the parent final-message mapping without retaining a previous label', async () => {
    const source = turn({ status: 'inProgress', startedAt: 1000 })
    const view = mount(source.items[0], completedTurnDurations([source]).get('answer'))
    expect(view.byClass('work-duration')).toBeUndefined()
    source.status = 'completed'; source.completedAt = 1138
    view.props.value.workDurationSeconds = completedTurnDurations([source]).get('answer')
    await nextTick()
    expect(view.byClass('work-duration')?.text).toBe('工作了 2 分 18 秒')
    view.props.value = { item: answer('next'), workDurationSeconds: undefined }
    await nextTick()
    expect(view.byClass('work-duration')).toBeUndefined()
    expect(view.button()).toBeDefined()
  })
})
