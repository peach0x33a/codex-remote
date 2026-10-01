import { afterEach, beforeAll, expect, test } from 'bun:test'
import { normalizeSliderValue } from '../../src/lib/slider'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { compileScript, parse } from '@vue/compiler-sfc'
import { createRenderer, h, nextTick, ref, type App, type Component } from 'vue'
let Slider: Component
beforeAll(async () => {
  async function load(name: string) {
    const file = new URL('../../src/components/' + name + '.vue', import.meta.url)
    const { descriptor } = parse(await Bun.file(file).text(), { filename: file.pathname })
    const script = compileScript(descriptor, { id: name, inlineTemplate: true })
    const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(script.content).replace(/from (["'])([^"']+)\1/g, (_m, _q, specifier: string) => 'from ' + JSON.stringify(specifier.startsWith('.') ? new URL(specifier + '.ts', file).href : import.meta.resolve(specifier)))
    const dir = await mkdtemp(join(tmpdir(), 'codex-slider-'))
    try { const path = join(dir, name + '.mjs'); await Bun.write(path, js); return (await import(pathToFileURL(path).href)).default } finally { await rm(dir, { recursive: true, force: true }) }
  }
  Slider = await load('ValueSlider')
})
test('normalizes typed slider values to supported steps and bounds', () => {
  expect(normalizeSliderValue('1127', 720, 1600, 40)).toBe(1120)
  expect(normalizeSliderValue('2000', 720, 1600, 40)).toBe(1600)
  expect(normalizeSliderValue('-20', 0, 100)).toBe(0)
  expect(normalizeSliderValue('.36', 0, 1, .1)).toBe(.4)
  for (const raw of ['', ' ', 'bad', Infinity, NaN]) expect(normalizeSliderValue(raw, 0, 100)).toBeUndefined()
})

type Node = { type: string; props: Record<string, any>; children: Node[]; parent?: Node; text?: string }
const node = (type: string): Node => ({ type, props: {}, children: [] })
const renderer = createRenderer<Node, Node>({
  createElement: node, createText: text => ({ ...node('#text'), text }), createComment: () => node('#comment'),
  patchProp: (node, key, _old, value) => { node.props[key] = value }, setText: (node, text) => { node.text = text }, setElementText: (node, text) => { node.text = text; node.children = [] },
  insert: (node, parent, anchor) => { if (node.parent) node.parent.children = node.parent.children.filter(child => child !== node); node.parent = parent; const at = anchor ? parent.children.indexOf(anchor) : -1; if (at < 0) parent.children.push(node); else parent.children.splice(at, 0, node) },
  remove: node => { if (node.parent) node.parent.children = node.parent.children.filter(child => child !== node) }, parentNode: node => node.parent || null, nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] || null,
})
const all = (root: Node): Node[] => [root, ...root.children.flatMap(all)]
const apps: App<Node>[] = []
afterEach(() => { for (const app of apps.splice(0)) app.unmount() })
function mountSlider() {
  const value = ref(40), disabled = ref(false), committed: number[] = [], previews: (number | null)[] = [], root = node('root')
  const app = renderer.createApp({ setup: () => () => h(Slider, { modelValue: value.value, disabled: disabled.value, min: 0, max: 100, step: 1, label: '数值', 'onUpdate:modelValue': (next: number) => { committed.push(next); value.value = next }, onPreview: (next: number | null) => { previews.push(next) } }) })
  apps.push(app); app.mount(root)
  const rail = () => all(root).find(node => node.props.class === 'value-slider-rail')!
  return { app, root, value, disabled, committed, previews, rail,
    range: () => all(root).find(node => node.props.type === 'range')!, field: () => all(root).find(node => node.props.type === 'text')!,
    async hover(value: number, pointerType = 'mouse') { rail().props.onPointermove({ pointerType, clientX: 9 + value, currentTarget: { getBoundingClientRect: () => ({ left: 0, width: 118 }) } }); await nextTick() },
  }
}
test('hover previews without moving the standard thumb or committing; leave restores the prior value', async () => {
  const view = mountSlider(); await view.hover(75)
  expect(view.previews).toEqual([75]); expect(view.committed).toEqual([]); expect(view.range().props.value).toBe(40)
  expect(all(view.root).some(node => node.props.class === 'value-slider-preview-marker')).toBe(true)
  view.rail().props.onPointerleave(); await nextTick()
  expect(view.previews).toEqual([75, null]); expect(view.value.value).toBe(40)
  expect(all(view.root).some(node => node.props.class === 'value-slider-preview-marker')).toBe(false)
})
test('native click and drag input commit while hover state is cleared', async () => {
  const view = mountSlider(); await view.hover(75)
  view.range().props.onInput({ target: { value: '75' } }); await nextTick()
  view.rail().props.onPointerleave(); await nextTick()
  expect(view.committed).toEqual([75]); expect(view.value.value).toBe(75); expect(view.previews.at(-1)).toBeNull()
})

test('disable and unmount end a preview; touch movement does not create hover', async () => {
  const view = mountSlider(); await view.hover(80, 'touch'); expect(view.previews).toEqual([])
  await view.hover(60); view.disabled.value = true; await nextTick(); expect(view.previews.at(-1)).toBeNull()
  view.disabled.value = false; await nextTick(); await view.hover(90); view.app.unmount(); expect(view.previews.at(-1)).toBeNull()
})
test('the right field commits on confirmation and cancels invalid or escaped drafts', async () => {
  const view = mountSlider(), field = view.field()
  field.props.onFocus({ target: { select() {} } }); field.props.onInput({ target: { value: '85' } })
  expect(view.committed).toEqual([])
  field.props.onBlur(); await nextTick(); expect(view.committed).toEqual([85])
  field.props.onFocus({ target: { select() {} } }); field.props.onInput({ target: { value: 'bad' } }); field.props.onBlur(); await nextTick()
  expect(view.committed).toEqual([85]); expect(view.field().props.value).toBe('85')
})
