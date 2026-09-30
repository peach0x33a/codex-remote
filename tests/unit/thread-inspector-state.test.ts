import { afterEach, beforeEach, expect, test } from 'bun:test'
import { createRenderer, ref, type App } from 'vue'
import { useThreadInspector } from '../../src/composables/useThreadInspector'
import type { Item, Thread } from '../../shared/protocol'

type Host = { children: Host[]; parent?: Host }
const renderer = createRenderer<Host, Host>({
  createElement: () => ({ children: [] }), createText: () => ({ children: [] }), createComment: () => ({ children: [] }),
  insert: (node, parent) => { node.parent = parent; parent.children.push(node) }, remove: node => { if (node.parent) node.parent.children = node.parent.children.filter(child => child !== node) },
  setElementText: () => {}, setText: () => {}, patchProp: () => {}, parentNode: node => node.parent || null, nextSibling: () => null,
})
const rootThread = (): Thread => ({ id: 'parent', preview: '', cwd: '/project', createdAt: 1, updatedAt: 2, turns: [{ id: 'turn', status: 'completed', items: [{ id: 'spawn', type: 'collabAgentToolCall', tool: 'spawnAgent', status: 'completed', receiverThreadIds: ['child'], agentsStates: { child: { status: 'running' } } } as Item] }] })
const thread = ref<Thread | null>(null), deviceId = ref('device'), connected = ref(true), knownThreads = ref<Thread[]>([])
let app: App<Host>, state: ReturnType<typeof useThreadInspector>
let calls: { method: string; params: Record<string, unknown>; signal?: AbortSignal }[]
let transport: (method: string, params: Record<string, unknown>, options?: { signal?: AbortSignal }) => Promise<unknown>
beforeEach(() => {
  thread.value = rootThread(); deviceId.value = 'device'; connected.value = true; knownThreads.value = []; calls = []
  transport = async (method, params) => method === 'thread/read'
    ? { thread: { id: params.threadId, agentNickname: 'Zeno', parentThreadId: 'parent' } }
    : { data: [{ item: { type: 'agentMessage', text: '检查完成' } }], nextCursor: null }
  app = renderer.createApp({ setup() {
    state = useThreadInspector({ thread, deviceId, connected, knownThreads, request: async <T>(method: string, params: Record<string, unknown>, options?: { signal?: AbortSignal }) => {
      calls.push({ method, params, signal: options?.signal }); return await transport(method, params, options) as T
    } }); return () => null
  } }); app.mount({ children: [] })
})
afterEach(() => app.unmount())

test('reads only a requested related agent, in bounded pages, without resuming it', async () => {
  expect(calls).toHaveLength(0)
  await state.inspect('unrelated')
  expect(calls).toHaveLength(0)
  await state.inspect('child')
  expect(calls.map(call => call.method)).toEqual(['thread/read', 'thread/items/list'])
  expect(calls[0]!.params).toEqual({ threadId: 'child', includeTurns: false })
  expect(calls[1]!.params).toEqual({ threadId: 'child', limit: 20, sortDirection: 'desc' })
  expect(state.insights.value.agents[0]).toMatchObject({ id: 'child', name: 'Zeno', message: '检查完成' })
  await state.inspect('child')
  expect(calls).toHaveLength(2)
})

test.each(['thread', 'device', 'disconnect'] as const)('rejects a stale reply after a %s change', async change => {
  let release!: (value: unknown) => void
  transport = () => new Promise(resolve => { release = resolve })
  const reading = state.inspect('child')
  expect(state.loading.value).toBe(true)
  if (change === 'thread') thread.value = { ...rootThread(), id: 'other', turns: [] }
  else if (change === 'device') deviceId.value = 'other'
  else connected.value = false
  expect(calls[0]!.signal!.aborted).toBe(true)
  release({ thread: { id: 'child', agentNickname: 'Wrong device' } })
  await reading
  expect(calls).toHaveLength(1)
  expect(state.loading.value).toBe(false)
  expect(state.error.value).toBe('')
  expect(state.insights.value.agents.some(agent => agent.name === 'Wrong device')).toBe(false)
})

test('deduplicates concurrent reads and retains the nickname when message reading fails', async () => {
  let release!: (value: unknown) => void
  transport = async method => {
    if (method === 'thread/items/list') throw new Error('暂时无法读取消息')
    return new Promise(resolve => { release = resolve })
  }
  const first = state.inspect('child'); await state.inspect('child', true)
  expect(calls).toHaveLength(1)
  release({ thread: { id: 'child', agentNickname: 'Zeno' } }); await first
  expect(state.insights.value.agents[0]?.name).toBe('Zeno')
  expect(state.error.value).toBe('暂时无法读取消息')
  expect(state.loading.value).toBe(false)
})
