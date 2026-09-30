import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { compileScript, parse } from '@vue/compiler-sfc'
import { createRenderer, h, nextTick, ref, type App, type Component } from 'vue'
import { turnFailureMessage, type TurnFailureInfo } from '../../src/lib/turn-failure'

const exhausted = 'exceeded retry limit, last status: 429 Too Many Requests, request id: request-123'

describe('terminal turn error messages', () => {
  test('uses willRetry, not 429 or exhausted wording, to distinguish a live retry', () => {
    expect(turnFailureMessage({ message: exhausted, willRetry: true })).toBeNull()
    expect(turnFailureMessage({ message: exhausted, willRetry: false })).toBe(exhausted)
    expect(turnFailureMessage({ message: exhausted })).toBe(exhausted)
  })
  test('hides absent errors and live reconnect attempts', () => {
    expect(turnFailureMessage(null)).toBeNull()
    expect(turnFailureMessage(undefined)).toBeNull()
    expect(turnFailureMessage({ message: 'Reconnecting 5/5', willRetry: true })).toBeNull()
  })
  test('preserves the server error and request ID without inventing a rate limit explanation', () => {
    expect(turnFailureMessage({ message: exhausted, codexErrorInfo: { responseTooManyFailedAttempts: { httpStatusCode: 429 } }, additionalDetails: 'diagnostic detail' })).toBe(exhausted)
  })
  test('unwraps the Desktop JSON error envelope', () => {
    expect(turnFailureMessage({ message: JSON.stringify({ error: { message: exhausted, code: 'server_error' } }) })).toBe(exhausted)
  })
  test.each(['{broken', 'null', '{"error":null}', '{"error":{"message":42}}', '{"message":"not the server envelope"}'])('preserves an unrecognized error payload: %s', message => {
    expect(turnFailureMessage({ message })).toBe(message)
  })
  test('provides a readable fallback for an empty terminal message', () => {
    expect(turnFailureMessage({ message: ' \n ' })).toBe('本轮未完成，请重试。')
  })
})

let TurnFailure: Component
beforeAll(async () => {
  const file = new URL('../../src/components/TurnFailure.vue', import.meta.url)
  const { descriptor } = parse(await Bun.file(file).text(), { filename: file.pathname })
  const compiled = compileScript(descriptor, { id: 'turn-failure-test', inlineTemplate: true })
  const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(compiled.content)
    .replace(/from (["'])([^"']+)\1/g, (_match, _quote, specifier: string) =>
      'from ' + JSON.stringify(specifier.startsWith('.') ? new URL(specifier + '.ts', file).href : import.meta.resolve(specifier)))
  TurnFailure = (await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))).default
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
function mount(failure: TurnFailureInfo | null = { message: exhausted }) {
  const props = ref({ failure, loading: false, disabled: false }), root = node('root')
  let retries = 0
  const app = renderer.createApp({ setup: () => () => h(TurnFailure, { ...props.value, onRetry: () => { retries++ } }) })
  apps.push(app); app.mount(root)
  return {
    root, props, retries: () => retries,
    button: () => descendants(root).find(target => target.type === 'button'),
    text: () => descendants(root).filter(target => target.type !== '#comment').map(target => target.text).join(' '),
  }
}

describe('TurnFailure component', () => {
  test('renders a polite inline error and emits a retry action without any request dependency', () => {
    const view = mount()
    expect(view.text()).toContain(exhausted)
    expect(descendants(view.root).some(target => target.props.role === 'status')).toBe(true)
    expect(descendants(view.root).some(target => target.props.role === 'alert')).toBe(false)
    expect(view.button()?.props.type).toBe('button')
    ;(view.button()!.props.onClick as () => void)()
    expect(view.retries()).toBe(1)
  })
  test('disables retry while loading or unavailable, including direct handler invocation', async () => {
    const view = mount()
    view.props.value.loading = true; await nextTick()
    expect(view.button()?.props.disabled).toBe(true)
    expect(view.text()).toContain('重试中…')
    ;(view.button()!.props.onClick as () => void)()
    view.props.value.loading = false; view.props.value.disabled = true; await nextTick()
    expect(view.button()?.props.disabled).toBe(true)
    ;(view.button()!.props.onClick as () => void)()
    expect(view.retries()).toBe(0)
    view.props.value.disabled = false; await nextTick()
    ;(view.button()!.props.onClick as () => void)()
    expect(view.retries()).toBe(1)
  })
  test('does not turn live retry notifications into terminal failure UI', async () => {
    const view = mount({ message: exhausted, willRetry: true })
    expect(view.button()).toBeUndefined()
    expect(view.text()).not.toContain(exhausted)
    view.props.value.failure = { message: exhausted, willRetry: false }; await nextTick()
    expect(view.button()).toBeDefined()
    view.props.value.failure = null; await nextTick()
    expect(view.button()).toBeUndefined()
  })
  test('renders server text literally and keeps diagnostic details out of the main row', () => {
    const view = mount({ message: '<img src=x onerror=alert(1)>', additionalDetails: 'private diagnostic context' })
    expect(view.text()).toContain('<img src=x onerror=alert(1)>')
    expect(descendants(view.root).some(target => target.type === 'img')).toBe(false)
    expect(view.text()).not.toContain('private diagnostic context')
    expect(descendants(view.root).some(target => target.props.title === 'private diagnostic context')).toBe(true)
  })
})
