import { afterEach, beforeAll, describe, expect, mock, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { compileScript, parse } from '@vue/compiler-sfc'
import { computed, createRenderer, defineComponent, h, nextTick, ref, type App, type Component } from 'vue'
import type { Approval, ConnectionProfile, Item, Thread, Turn } from '../../shared/protocol'
import type { QueuedMessage } from '../../src/composables/useCodex'
import type { PromptPart } from '../../src/lib/prompt'
import type { TaskNotice } from '../../src/lib/task-notifications'

type Node = { type: string; text: string; props: Record<string, any>; children: Node[]; parent?: Node; scrollTop: number; scrollHeight: number; clientHeight: number }
const node = (type: string, text = ''): Node => ({ type, text, props: {}, children: [], scrollTop: 0, scrollHeight: 600, clientHeight: 200 })
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
const apps = new Set<App<Node>>()
afterEach(() => { for (const app of apps) app.unmount(); apps.clear() })
async function flush() { for (let i = 0; i < 6; i++) await nextTick() }
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const profile: ConnectionProfile = { id: 'device', name: '测试设备', endpoint: 'ws://example.invalid', cwd: '/work', createdAt: 1, credentialId: 'stored-credential' }
const parts = (text: string): PromptPart[] => [{ type: 'text', text }]
const image: PromptPart = { type: 'image', id: 'image-1', name: 'diagram.png', url: 'data:image/png;base64,aGVsbG8=', size: 5, source: { type: 'image', url: 'data:image/png;base64,aGVsbG8=' } }
const inherited = (): Thread => ({ id: 'fork', preview: '', cwd: '/work', createdAt: 1, updatedAt: 1, turns: [{ id: 'old-turn', status: 'completed', items: [{ id: 'old-user', type: 'userMessage', content: parts('原会话问题') }, { id: 'old-answer', type: 'agentMessage', text: '原会话回答' }] }] })
const job = (source?: 'server'): QueuedMessage => ({ id: 'queue-1', deviceId: 'device', threadId: 'fork', parts: [...parts('排队内容'), image], settings: { model: '', effort: '', permission: 'ask' }, state: 'queued', source })

function runtime() {
  const active = ref<Thread | null>(null), pending = ref<Item[]>([]), status = ref('disconnected')
  const loadingThread = ref(false), sending = ref(false), currentQueue = ref<QueuedMessage[]>([])
  const activeTurn = computed(() => active.value?.turns.findLast(turn => turn.status === 'inProgress'))
  const displayTurns = computed<Turn[]>(() => {
    const turns = (active.value?.turns || []).map(turn => ({ ...turn, items: [...turn.items] }))
    if (pending.value.length) turns.push({ id: 'optimistic', status: 'inProgress', items: pending.value })
    return turns
  })
  const listeners = new Set<(event: TaskNotice) => void>()
  const codex = {
    active, pending, status, loadingThread, sending, currentQueue, activeTurn, displayTurns,
    // Deliberately confirmed-only: the component must consume displayTurns.
    items: computed(() => active.value?.turns.flatMap(turn => turn.items) || []),
    connected: computed(() => status.value === 'connected'), busy: computed(() => sending.value || !!activeTurn.value),
    threadLoadError: ref(''), error: ref(''), notice: ref(''), currentTurnFailure: ref(''),
    steering: ref(false), revising: ref(false), pendingSteers: ref<{ id: string; accepted: boolean; parts: PromptPart[] }[]>([]),
    activeApprovals: ref<Approval[]>([]), queuePaused: ref(false), serverQueueSupported: ref(false),
    reconnectStatus: ref(''), compacting: ref(false), liveReasoning: ref(''), thinkingElapsed: ref<number>(), clockNow: ref(1),
    connectWithToken: mock(async (_profile: ConnectionProfile, _token: string) => { active.value = null; status.value = 'connected' }),
    openThread: mock(async (_id: string) => { loadingThread.value = true; active.value = inherited(); await nextTick(); loadingThread.value = false }),
    send: mock(async (_parts: PromptPart[]) => true), steer: mock(async (_parts: PromptPart[]) => true),
    updateQueued: mock(async (_id: string, _parts: PromptPart[]) => true), removeQueued: mock((_id: string) => {}),
    resumeQueue: mock(() => {}), pauseQueue: mock(() => {}), respond: mock(() => {}), withdrawPendingSteer: mock(() => {}), interrupt: mock(() => {}),
    toast: mock((text: string) => { codex.notice.value = text }),
    onTaskNotice: mock((listener: (event: TaskNotice) => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }),
  }
  return { codex, listeners }
}
type Codex = ReturnType<typeof runtime>['codex']
let component: (useCodex: (options: unknown) => Codex, ...children: Component[]) => Component
beforeAll(async () => {
  const file = new URL('../../src/components/SideChat.vue', import.meta.url)
  const { descriptor } = parse(await Bun.file(file).text(), { filename: file.pathname })
  const script = compileScript(descriptor, { id: 'side-chat-test', inlineTemplate: true })
  // Run the real SFC with injected transport and child boundaries; no browser or network.
  const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(script.content)
    .replace(/import[^;]*from ["'](?:\.\.\/composables\/useCodex|\.\/(?:MessageItem|ApprovalIsland|PromptEditor|QueuePane|WorkspaceFilePanel)\.vue)["'];?/g, '')
    .replace(/from (["'])([^"']+)\1/g, (_match, _quote, specifier: string) => 'from ' + JSON.stringify(specifier.startsWith('.') ? new URL(specifier + '.ts', file).href : import.meta.resolve(specifier)))
    .replace('export default', 'export default (useCodex, MessageItem, ApprovalIsland, PromptEditor, QueuePane, WorkspaceFilePanel = { render: () => null }) =>')
  const directory = await mkdtemp(join(tmpdir(), 'codex-side-chat-'))
  try { const path = join(directory, 'side-chat.mjs'); await Bun.write(path, js); component = (await import(pathToFileURL(path).href)).default }
  finally { await rm(directory, { recursive: true, force: true }) }
})

function mount(state = runtime()) {
  const renderedIds: string[] = [], busy: boolean[] = [], notices: TaskNotice[] = [], copies: string[] = []
  let closed = false
  const useCodex = mock((_options: unknown) => state.codex)
  const MessageItem = defineComponent({ props: ['item', 'now', 'actionsDisabled'], emits: ['copy'], setup(props, { emit }) { return () => { renderedIds.push(props.item.id); return h('message-item', { ...props, copy: (text: string) => emit('copy', text) }, props.item.text || '') } } })
  const ApprovalIsland = defineComponent({ props: ['approvals', 'steers', 'hasQueue', 'disabled', 'reasoning', 'thinkingElapsed'], emits: ['respond', 'withdrawSteer'], setup(props, { slots, emit }) { return () => h('approval-island', { ...props, respond: (...args: unknown[]) => emit('respond', ...args), withdraw: (id: string) => emit('withdrawSteer', id) }, props.hasQueue ? slots.queue?.() : []) } })
  const PromptEditor = defineComponent({ props: ['modelValue', 'disabled', 'label', 'placeholder'], emits: ['update:modelValue', 'files', 'keydown'], setup(props, { emit, expose }) { expose({ focus() {}, reserveInsertion() {}, insertImage(image: PromptPart) { emit('update:modelValue', [...props.modelValue, image]) } }); return () => h('prompt-editor', { ...props, input: (value: PromptPart[]) => emit('update:modelValue', value), onEditorKey: (event: unknown) => emit('keydown', event), files: (value: File[]) => emit('files', value) }) } })
  const QueuePane = defineComponent({ props: ['messages', 'working', 'paused', 'serverManaged', 'save', 'disabled'], emits: ['editing', 'restore', 'remove', 'resume', 'pause'], setup(props, { emit }) { return () => h('queue-pane', { ...props, editing: (value: boolean) => emit('editing', value), restore: (value: PromptPart[]) => emit('restore', value), remove: (id: string) => emit('remove', id), resume: () => emit('resume'), pause: () => emit('pause') }) } })
  const SideChat = component(useCodex, MessageItem, ApprovalIsland, PromptEditor, QueuePane), root = node('root')
  const app = renderer.createApp({ setup: () => () => h(SideChat, { threadId: 'fork', profile, token: '', onBusy: (value: boolean) => busy.push(value), onNotice: (event: TaskNotice) => notices.push(event), onCopy: (text: string) => copies.push(text), onClose: () => { closed = true } }) })
  apps.add(app); app.mount(root)
  const find = (type: string) => descendants(root).find(target => target.type === type)!
  return {
    ...state, root, renderedIds, busy, notices, copies, useCodex, closed: () => closed, find,
    input: (value: PromptPart[]) => find('prompt-editor').props.input(value),
    draft: () => find('prompt-editor').props.modelValue as PromptPart[],
    ids: () => descendants(root).filter(target => target.type === 'message-item').map(target => target.props.item.id),
    text: () => descendants(root).filter(target => target.type !== '#comment').map(target => target.text).join(' '),
    button: (label: string) => descendants(root).find(target => target.type === 'button' && (target.props['aria-label'] === label || target.text === label)),
    submit: () => find('form').props.onSubmit({ preventDefault() {} }),
    unmount() { app.unmount(); apps.delete(app) },
  }
}

describe('SideChat', () => {
  test('connects credential profiles with blank tokens and never flashes inherited history', async () => {
    const view = mount()
    expect(view.ids()).toEqual([])
    await flush()
    expect(view.useCodex).toHaveBeenCalledWith({ autoConnect: false, persistConnection: false })
    expect(view.codex.connectWithToken).toHaveBeenCalledWith(profile, '')
    expect(view.codex.openThread).toHaveBeenCalledWith('fork')
    expect(view.renderedIds).toEqual([])
    expect(view.busy.at(-1)).toBe(false)
  })

  test('renders optimistic sends immediately and replaces them with confirmed messages', async () => {
    const view = mount(); await flush()
    const ack = deferred<boolean>()
    view.codex.send.mockImplementation(async value => { view.codex.sending.value = true; view.codex.pending.value = [{ id: 'pending-send', type: 'userMessage', content: value }]; const accepted = await ack.promise; view.codex.sending.value = false; return accepted })
    view.input(parts('马上显示')); await nextTick()
    const request = view.submit(); await nextTick()
    expect(view.ids()).toEqual(['pending-send'])
    expect(view.codex.items.value.some(item => item.id === 'pending-send')).toBe(false)
    expect(view.button('发送侧边聊天消息')?.props.disabled).toBe(true)
    view.codex.active.value!.turns.push({ id: 'side-turn', status: 'inProgress', items: [{ id: 'sent', type: 'userMessage', content: parts('马上显示') }] })
    view.codex.pending.value = []; ack.resolve(true); await request; await flush()
    expect(view.ids()).toEqual(['sent'])
    expect(view.draft()).toEqual([])
    expect(view.busy.at(-1)).toBe(true)
    expect(view.renderedIds).not.toContain('old-user')
  })

  test('keeps original inherited ids after reconnect and preserves drafts', async () => {
    const view = mount(); await flush()
    view.codex.active.value!.turns.push({ id: 'side', status: 'completed', items: [{ id: 'side-answer', type: 'agentMessage', text: '侧边回答' }] })
    const restored = JSON.parse(JSON.stringify(view.codex.active.value)) as Thread
    view.input([...parts('未发送'), image]); await nextTick()
    view.codex.status.value = 'error'; view.codex.error.value = '连接中断'; await nextTick()
    expect(view.button('发送侧边聊天消息')?.props.disabled).toBe(true)
    view.codex.openThread.mockImplementation(async () => { view.codex.loadingThread.value = true; view.codex.active.value = restored; view.codex.error.value = ''; await nextTick(); view.codex.loadingThread.value = false })
    await view.button('重新连接侧边聊天')!.props.onClick(); await flush()
    expect(view.ids()).toEqual(['side-answer'])
    expect(view.renderedIds).not.toContain('old-user')
    expect(view.renderedIds).not.toContain('old-answer')
    expect(view.draft()).toEqual([...parts('未发送'), image])
  })

  test('does not hide later messages after automatic reloads', async () => {
    const view = mount(); await flush()
    view.codex.status.value = 'reconnecting'; await nextTick()
    expect(view.text()).toContain('正在重新连接')
    view.codex.loadingThread.value = true; view.codex.status.value = 'connected'
    view.codex.active.value = { ...inherited(), turns: [...inherited().turns, { id: 'new', status: 'completed', items: [{ id: 'new-answer', type: 'agentMessage', text: '重连期间的回答' }] }] }
    view.codex.loadingThread.value = false; await flush()
    expect(view.ids()).toEqual(['new-answer'])
  })

  test('shows failed initial loads and retries without reconnecting unnecessarily', async () => {
    const state = runtime()
    state.codex.openThread.mockImplementationOnce(async () => { state.codex.threadLoadError.value = '读取失败' })
    const view = mount(state); await flush()
    expect(view.text()).toContain('读取失败')
    expect(view.ids()).toEqual([])
    state.codex.openThread.mockImplementation(async () => { state.codex.loadingThread.value = true; state.codex.threadLoadError.value = ''; state.codex.active.value = inherited(); await nextTick(); state.codex.loadingThread.value = false })
    await view.button('重新加载侧边聊天')!.props.onClick(); await flush()
    expect(view.codex.connectWithToken).toHaveBeenCalledTimes(1)
    expect(view.renderedIds).toEqual([])
    view.input(parts('可以继续')); await nextTick()
    expect(view.button('发送侧边聊天消息')?.props.disabled).toBe(false)
  })

  test('catches rejected connections and retries without dropping drafts', async () => {
    const state = runtime(); state.codex.connectWithToken.mockImplementationOnce(async () => { throw new Error('凭据读取失败') })
    const view = mount(state); await flush()
    view.input(parts('保留草稿')); await nextTick()
    expect(view.text()).toContain('凭据读取失败')
    await view.button('重新连接侧边聊天')!.props.onClick(); await flush()
    expect(view.text()).not.toContain('凭据读取失败')
    expect(view.draft()).toEqual(parts('保留草稿'))
  })

  test('preserves changed drafts and images when submissions fail', async () => {
    const view = mount(); await flush()
    const ack = deferred<boolean>(); view.codex.send.mockImplementationOnce(() => ack.promise)
    view.input(parts('正在发送')); await nextTick()
    const request = view.submit(); view.input([...parts('接着写'), image]); ack.resolve(true); await request; await flush()
    expect(view.draft()).toEqual([...parts('接着写'), image])
    view.codex.send.mockImplementationOnce(async () => false); await view.submit(); await flush()
    expect(view.draft()).toEqual([...parts('接着写'), image])
    view.codex.send.mockImplementationOnce(async () => { throw new Error('发送失败') }); await view.submit(); await flush()
    expect(view.text()).toContain('发送失败')
    expect(view.draft()).toEqual([...parts('接着写'), image])
  })

  test('wires queue actions and keeps missing-message edits visible for image-safe restore', async () => {
    const view = mount(); await flush()
    view.codex.currentQueue.value = [job('server')]; await nextTick()
    const queue = view.find('queue-pane')
    expect(view.find('approval-island').props.hasQueue).toBe(true)
    expect(queue.props.serverManaged).toBe(true)
    await queue.props.save('queue-1', [image])
    expect(view.codex.updateQueued).toHaveBeenCalledWith('queue-1', [image])
    queue.props.remove('queue-1'); queue.props.resume(); queue.props.pause()
    expect(view.codex.removeQueued).toHaveBeenCalledWith('queue-1')
    expect(view.codex.resumeQueue).toHaveBeenCalledTimes(1)
    expect(view.codex.pauseQueue).toHaveBeenCalledTimes(1)
    queue.props.editing(true); view.codex.currentQueue.value = []; await nextTick()
    expect(view.find('queue-pane')).toBe(queue)
    expect(view.busy.at(-1)).toBe(true)
    view.input(parts('已有草稿')); queue.props.restore([image]); queue.props.editing(false); await flush()
    expect(view.draft()).toEqual([...parts('已有草稿'), { type: 'text', text: '\n' }, image])
    expect(view.draft().at(-1)).not.toBe(image)
    expect(view.text()).toContain('编辑草稿已放回输入框')
  })

  test('distinguishes mixed/local queues from server-only queues', async () => {
    const view = mount(); await flush()
    view.codex.serverQueueSupported.value = true; view.codex.currentQueue.value = [job('server'), { ...job(), id: 'local' }]; await nextTick()
    expect(view.find('queue-pane').props.serverManaged).toBe(false)
    view.codex.queuePaused.value = true; await nextTick()
    expect(view.find('queue-pane').props.paused).toBe(true)
  })

  test('supports steering and explicit queue submission with image parts', async () => {
    const view = mount(); await flush()
    view.codex.active.value!.turns.push({ id: 'working', status: 'inProgress', items: [] })
    view.input([image]); await nextTick(); await view.submit(); await flush()
    expect(view.codex.steer).toHaveBeenCalledWith([image])
    view.input([...parts('稍后发送'), image]); await nextTick()
    await view.button('加入侧边聊天队列')!.props.onClick(); await flush()
    expect(view.codex.send).toHaveBeenCalledWith([...parts('稍后发送'), image])
    expect(view.codex.steer).toHaveBeenCalledTimes(1)
  })

  test('reports drafts, active work, queues, steers, and revisions to the parent guard', async () => {
    const view = mount(); await flush()
    view.input([image]); expect(view.busy.at(-1)).toBe(true)
    view.input([]); expect(view.busy.at(-1)).toBe(false)
    view.codex.active.value!.turns.push({ id: 'running', status: 'inProgress', items: [] }); expect(view.busy.at(-1)).toBe(true)
    view.codex.active.value!.turns.pop(); expect(view.busy.at(-1)).toBe(false)
    view.codex.currentQueue.value = [job()]; expect(view.busy.at(-1)).toBe(true)
    view.codex.currentQueue.value = []; expect(view.busy.at(-1)).toBe(false)
    view.codex.pendingSteers.value = [{ id: 'steer', accepted: true, parts: [image] }]; expect(view.busy.at(-1)).toBe(true)
    view.codex.pendingSteers.value = []; expect(view.busy.at(-1)).toBe(false)
    view.codex.revising.value = true; expect(view.busy.at(-1)).toBe(true)
    view.codex.revising.value = false; expect(view.busy.at(-1)).toBe(false)
    view.input(parts('还有草稿')); view.unmount(); expect(view.busy.at(-1)).toBe(false)
  })

  test('prevents duplicate submissions while a queue acknowledgement is pending', async () => {
    const view = mount(); await flush()
    const ack = deferred<boolean>(); view.codex.send.mockImplementationOnce(() => ack.promise)
    view.input(parts('仅发送一次')); await nextTick()
    const request = view.submit(); await view.submit(); await nextTick()
    expect(view.codex.send).toHaveBeenCalledTimes(1)
    expect(view.busy.at(-1)).toBe(true)
    expect(view.button('发送侧边聊天消息')?.props.disabled).toBe(true)
    ack.resolve(false); await request; await flush()
    expect(view.draft()).toEqual(parts('仅发送一次'))
  })

  test('respects IME and modified Enter, and uses Tab for explicit queueing', async () => {
    const view = mount(); await flush()
    view.input(parts('输入法草稿')); await nextTick()
    const key = (overrides: Record<string, unknown> = {}) => ({ key: 'Enter', preventDefault: mock(() => {}), ...overrides })
    for (const overrides of [{ isComposing: true }, { keyCode: 229 }, { defaultPrevented: true }, { shiftKey: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
      const event = key(overrides); view.find('prompt-editor').props.onEditorKey(event)
      expect(event.preventDefault).not.toHaveBeenCalled()
    }
    expect(view.codex.send).not.toHaveBeenCalled()
    view.codex.active.value!.turns.push({ id: 'working', status: 'inProgress', items: [] }); await nextTick()
    const tab = key({ key: 'Tab' }); view.find('prompt-editor').props.onEditorKey(tab); await flush()
    expect(tab.preventDefault).toHaveBeenCalledTimes(1)
    expect(view.codex.send).toHaveBeenCalledWith(parts('输入法草稿'))
    expect(view.codex.steer).not.toHaveBeenCalled()
  })

  test('forwards notices/actions, announces failures, and removes its notice listener', async () => {
    const view = mount(); await flush()
    const notice: TaskNotice = { id: 'notice', kind: 'failed', deviceId: profile.id, deviceName: profile.name, threadId: 'fork', threadName: '侧边聊天' }
    for (const listener of view.listeners) listener(notice)
    expect(view.notices).toEqual([notice])
    view.codex.currentTurnFailure.value = '任务失败'; view.codex.reconnectStatus.value = 'HTTP 503，重试 2/5'; await nextTick()
    expect(view.text()).toContain('任务失败')
    expect(descendants(view.root).some(target => target.props.role === 'status' && target.text.includes('HTTP 503'))).toBe(true)
    view.find('approval-island').props.respond(1, { decision: 'accept' }); view.find('approval-island').props.withdraw('steer')
    expect(view.codex.respond).toHaveBeenCalledWith(1, { decision: 'accept' })
    expect(view.codex.withdrawPendingSteer).toHaveBeenCalledWith('steer')
    view.button('关闭侧边聊天')!.props.onClick(); expect(view.closed()).toBe(true)
    view.unmount(); expect(view.listeners.size).toBe(0)
  })

  test('autoscrolls streams only while the reader remains at the bottom', async () => {
    const view = mount(); await flush()
    const host = descendants(view.root).find(target => target.props.class === 'side-chat-messages')!
    host.scrollTop = 50; host.props.onScrollPassive()
    view.codex.active.value!.turns.push({ id: 'side', status: 'inProgress', items: [{ id: 'stream', type: 'agentMessage', text: '开始' }] }); await flush()
    expect(host.scrollTop).toBe(50)
    host.scrollTop = 400; host.props.onScrollPassive()
    host.scrollHeight = 800; view.codex.active.value!.turns.at(-1)!.items[0]!.text += '继续'; await flush()
    expect(host.scrollTop).toBe(800)
  })

  test('does not open a thread after closing during an unresolved connection', async () => {
    const state = runtime(), connection = deferred<void>()
    state.codex.connectWithToken.mockImplementation(async () => { await connection.promise; state.codex.status.value = 'connected' })
    const view = mount(state); view.unmount(); connection.resolve(); await flush()
    expect(state.codex.openThread).not.toHaveBeenCalled()
    expect(state.listeners.size).toBe(0)
    expect(view.busy.at(-1)).toBe(false)
  })
})
