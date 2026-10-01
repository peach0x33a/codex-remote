import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { effectScope, nextTick, ref, type EffectScope } from 'vue'
import { AGENT_CENTER_REFRESH_MS, useAgentCenter, type AgentCenterRequest } from '../../src/composables/useAgentCenter'
import { agentState, buildAgentRows, filterAgentRows, groupAgentRows, type AgentThread } from '../../src/lib/agent-center'
import { activityTime } from '../../src/lib/recent-window'

const thread = (id: string, fields: Partial<AgentThread> = {}): AgentThread => ({ id, name: id, preview: '', cwd: '/work/api', model: 'model-a', createdAt: 1, updatedAt: 2, turns: [], status: { type: 'idle' }, ...fields })
const activityDate = (day: number) => new Date(2026, 8, day, 12).getTime() / 1000
describe('agent center projections', () => {
  test('maps active flags and errors without mistaking unknown statuses for inactive or completed', () => {
    expect(agentState({ type: 'active', activeFlags: ['waitingOnApproval'] })).toBe('needsYou')
    expect(agentState({ type: 'active', activeFlags: ['waitingOnUserInput'] })).toBe('needsYou')
    expect(agentState({ type: 'active', activeFlags: ['futureFlag'] })).toBe('working')
    expect(agentState({ type: 'systemError' })).toBe('needsYou')
    expect(agentState({ type: 'idle' })).toBe('ready')
    expect(agentState({ type: 'notLoaded' })).toBe('inactive')
    for (const status of [undefined, { type: 'futureStatus' }, { type: 'completed' }]) expect(agentState(status)).toBe('unknown')
  })
  test('aggregates descendants, deduplicates IDs and searches child metadata', () => {
    const root = thread('root', { status: { type: 'active' } })
    const child = thread('child', { parentThreadId: 'root', name: 'Database check', cwd: '/work/Storage', model: 'model-b', status: { type: 'active', activeFlags: ['waitingOnApproval'] } })
    const rows = buildAgentRows([root, child, child, thread('ephemeral', { ephemeral: true })])
    expect(rows).toHaveLength(1)
    expect(rows[0].members.map(member => member.id)).toEqual(['root', 'child'])
    expect(rows[0].state).toBe('needsYou')
    for (const search of [' DATABASE ', 'storage', 'MODEL-B']) expect(filterAgentRows(rows, search, 'needsYou')).toEqual(rows)
    expect(filterAgentRows(rows, 'database', 'working')).toEqual([])
    expect(filterAgentRows(rows, 'missing', 'all')).toEqual([])
  })
  test('keeps unknown states, orphans and cyclic ancestry inspectable', () => {
    const rows = buildAgentRows([thread('root', { status: { type: 'notLoaded' } }), thread('child', { parentThreadId: 'root', status: undefined }), thread('orphan', { parentThreadId: 'missing' }), thread('cycle-a', { parentThreadId: 'cycle-b' }), thread('cycle-b', { parentThreadId: 'cycle-a' })])
    expect(rows.find(row => row.thread.id === 'root')?.state).toBe('unknown')
    expect(rows.flatMap(row => row.members.map(member => member.id)).sort()).toEqual(['child', 'cycle-a', 'cycle-b', 'orphan', 'root'])
    expect(filterAgentRows(rows, '', 'inactive')).toEqual([])
  })

})

type Call = { method: string; params: Record<string, unknown>; signal?: AbortSignal }
const scopes: EffectScope[] = []
const restores: (() => void)[] = []
afterEach(() => { for (const scope of scopes.splice(0)) scope.stop(); for (const restore of restores.splice(0)) restore() })
async function settle() { for (let i = 0; i < 35; i++) await Promise.resolve(); await nextTick() }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
function createCenter(handle: (call: Call) => unknown | Promise<unknown>) {
  const open = ref(false), connected = ref(true), device = ref('device-a'), calls: Call[] = []
  const request: AgentCenterRequest = async <T>(method: string, params = {}, options: { signal?: AbortSignal } = {}) => {
    const call = { method, params, signal: options.signal }; calls.push(call)
    return await handle(call) as T
  }
  const scope = effectScope(); scopes.push(scope)
  const center = scope.run(() => useAgentCenter({ request, isVisible: () => open.value, isConnected: () => connected.value, deviceKey: () => device.value }))!
  return { center, calls, open, connected, device, scope }
}
function response(call: Call, data = [thread('a'), thread('b')]) {
  if (call.method === 'thread/loaded/list') return { data: data.map(item => item.id), nextCursor: null }
  if (call.method === 'thread/list') return { data: (call.params.sourceKinds as string[]).length ? [] : data, nextCursor: null }
  if (call.method === 'thread/read') return { thread: data.find(item => item.id === call.params.threadId)! }
  if (call.method === 'thread/turns/list') return { data: [], nextCursor: null }
  if (call.method === 'account/usage/read') return { threadUsage: null }
  throw new Error('Unexpected method: ' + call.method)
}

function sourceFilteredResponse(call: Call, data: AgentThread[], pageSize = 100) {
  if (call.method !== 'thread/list') return response(call, data)
  const requested = call.params.sourceKinds as string[] | undefined
  // app-server/src/filters.rs + rollout/src/lib.rs: the default interactive
  // sources include CLI/VSCode and custom atlas/chatgpt; subAgent matches every
  // CoreSessionSource::SubAgent variant. Fixtures use the v2 wire projection.
  const kinds = requested?.length ? requested : ['cli', 'vscode']
  const filtered = data.filter(({ source }) => {
    if (typeof source === 'string') return kinds.includes(source)
    if (source === null || typeof source !== 'object') return false
    if ('subAgent' in source) return kinds.includes('subAgent')
    return !requested?.length && 'custom' in source && (source.custom === 'atlas' || source.custom === 'chatgpt')
  })
    .sort((a, b) => (activityTime(b) ?? 0) - (activityTime(a) ?? 0))
  const offset = Number(call.params.cursor || 0), size = Math.min(Number(call.params.limit), pageSize)
  return { data: filtered.slice(offset, offset + size), nextCursor: offset + size < filtered.length ? String(offset + size) : null }
}

describe('read-only agent center controller without network listeners', () => {
  test('loads only while visible and uses metadata-only reads, never resume or queue writes', async () => {
    const state = createCenter(call => response(call))
    expect(state.calls).toHaveLength(0)
    state.open.value = true; await settle()
    expect(state.center.rows.value).toHaveLength(2)
    expect(state.center.details.value?.thread.id).toBe('a')
    const allowed = new Set(['thread/loaded/list', 'thread/list', 'thread/read', 'thread/turns/list', 'account/usage/read'])
    expect(state.calls.every(call => allowed.has(call.method))).toBe(true)
    expect(state.calls.filter(call => call.method === 'thread/read').every(call => call.params.includeTurns === false)).toBe(true)
    expect(state.calls.filter(call => call.method === 'thread/list').every(call => call.params.useStateDbOnly === true)).toBe(true)
  })
  test('bounds pagination even when a server repeats its cursor', async () => {
    const state = createCenter(call => call.method === 'thread/list' && !(call.params.sourceKinds as string[]).length
      ? { data: [thread('a')], nextCursor: 'repeated' } : response(call))
    state.open.value = true; await settle()
    expect(state.calls.filter(call => call.method === 'thread/loaded/list')).toHaveLength(0)
    expect(state.calls.filter(call => call.method === 'thread/list')).toHaveLength(3)
    expect(state.center.notice.value).toContain('部分任务')
    expect(state.center.loading.value).toBe(false)
  })

  test.each(['interactive', 'subAgent'] as const)('includes spawn children through actual source filtering with the latest anchor from %s', async newestSource => {
    const spawnSource = { subAgent: { thread_spawn: { parent_thread_id: 'root', depth: 1, agent_path: null, agent_nickname: null, agent_role: null } } }
    const data = [
      thread('root', { source: 'cli', updatedAt: activityDate(28), recencyAt: activityDate(newestSource === 'interactive' ? 29 : 28) }),
      thread('spawn', { source: spawnSource, name: 'Child database audit', updatedAt: activityDate(28), recencyAt: activityDate(newestSource === 'subAgent' ? 29 : 28), status: { type: 'active', activeFlags: ['waitingOnApproval'] } }),
      ...[
        ['vscode', 'vscode'], ['exec', 'exec'], ['app-server', 'appServer'],
        ['atlas', { custom: 'atlas' }], ['chatgpt', { custom: 'chatgpt' }],
        ['review', { subAgent: 'review' }], ['compact', { subAgent: 'compact' }],
        ['other', { subAgent: { other: 'custom' } }], ['memory', { subAgent: 'memory_consolidation' }],
      ].map(([id, source]) => thread(id as string, { source, updatedAt: activityDate(28) })),
      thread('old-cli', { source: 'cli', updatedAt: activityDate(27), status: { type: 'active' } }),
      thread('old-spawn', { source: spawnSource, updatedAt: activityDate(27), status: { type: 'active' } }),
      thread('ancient-cli', { source: 'cli', updatedAt: activityDate(26) }),
      thread('ancient-exec', { source: 'exec', updatedAt: activityDate(26) }),
      // A newer unknown source must not move the anchor of either queried source.
      thread('unknown', { source: 'unknown', updatedAt: activityDate(30) }),
    ]
    const state = createCenter(call => sourceFilteredResponse(call, data, 2))
    state.open.value = true; await settle(); await settle()
    const rows = state.center.rows.value, root = rows.find(row => row.thread.id === 'root')!
    expect(rows.flatMap(row => row.members.map(member => member.id)).sort()).toEqual(['app-server', 'atlas', 'chatgpt', 'compact', 'exec', 'memory', 'other', 'review', 'root', 'spawn', 'vscode'])
    expect(root.members.map(member => member.id)).toEqual(['root', 'spawn'])
    expect(root.state).toBe('needsYou')
    expect(filterAgentRows(rows, 'database', 'needsYou')).toEqual([root])
    expect(groupAgentRows(rows, 'project')[0]?.rows.find(row => row.thread.id === 'root')?.members).toEqual(root.members)
    expect(state.center.selectedId.value).toBe('root')
    expect(state.center.details.value?.thread.id).toBe('root')
    expect(state.center.loading.value).toBe(false)
    const lists = state.calls.filter(call => call.method === 'thread/list')
    expect([...new Set(lists.map(call => (call.params.sourceKinds as string[]).join(',')))]).toEqual(['', 'exec,appServer,subAgent'])
    expect(lists.every(call => call.params.limit === 100 && call.params.sortKey === 'recency_at')).toBe(true)
    expect(lists.filter(call => !(call.params.sourceKinds as string[]).length)).toHaveLength(3)
    expect(lists.filter(call => (call.params.sourceKinds as string[]).length)).toHaveLength(4)
    expect(state.calls.filter(call => call.method === 'thread/read').map(call => call.params.threadId)).toEqual(['root'])
    expect(state.calls.some(call => call.method === 'thread/loaded/list')).toBe(false)
  })
  test.each([
    ['thread/read', { thread: { ...thread('a'), name: 123 } }],
    ['thread/turns/list', { data: [{ items: [{ type: 'userMessage', content: [null] }] }] }],
    ['account/usage/read', { threadUsage: { threadId: 'a', groups: [null] } }]
  ])('settles malformed fulfilled %s responses without breaking available details', async (method, payload) => {
    const state = createCenter(call => call.method === method ? payload : response(call))
    state.open.value = true; await settle()
    expect(state.center.detailLoading.value).toBe(false)
    expect(state.center.details.value?.thread.id).toBe('a')
    if (method === 'thread/read') expect(state.center.detailError.value).toContain('格式无效')
    if (method === 'thread/turns/list') expect(state.center.details.value?.notice).toContain('最近消息暂不可用')
    if (method === 'account/usage/read') expect(state.center.details.value?.usage).toBeUndefined()
    await state.center.refreshDetails()
    expect(state.center.detailLoading.value).toBe(false)
  })

  test.each([
    'refresh',
    'device'
  ] as const)('%s prevents late recent pages from merging into another snapshot', async action => {
    const late = deferred<unknown>()
    let fresh = false
    const state = createCenter(call => {
      if (fresh) return response(call, [thread('b')])
      if (call.method === 'thread/list' && !(call.params.sourceKinds as string[]).length) return call.params.cursor ? late.promise : { data: [thread('a')], nextCursor: 'late' }
      return response(call, [thread('a')])
    })
    state.open.value = true; await settle()
    expect(state.center.selectedId.value).toBe('a')
    const pending = state.calls.find(call => call.method === 'thread/list' && call.params.cursor === 'late')!
    fresh = true
    if (action === 'refresh') void state.center.refresh()
    else state.device.value = 'device-b'
    await settle()
    expect(pending.signal?.aborted).toBe(true)
    late.resolve({ data: [thread('late')], nextCursor: null }); await settle()
    expect(state.center.rows.value.map(row => row.thread.id)).toEqual(['b'])
    expect(state.center.loading.value).toBe(false)
  })

  test('late details cannot replace a newer selection, even when the adapter ignores abort', async () => {
    const late = deferred<{ thread: AgentThread }>()
    const state = createCenter(call => call.method === 'thread/read' && call.params.threadId === 'a' ? late.promise : response(call))
    state.open.value = true; await settle()
    state.center.select('b'); await settle()
    expect(state.center.details.value?.thread.id).toBe('b')
    expect(state.calls.find(call => call.method === 'thread/read' && call.params.threadId === 'a')?.signal?.aborted).toBe(true)
    late.resolve({ thread: thread('a', { name: 'Stale' }) }); await settle()
    expect(state.center.selectedId.value).toBe('b')
    expect(state.center.details.value?.thread.id).toBe('b')
    expect(state.center.detailLoading.value).toBe(false)
  })
  test('scope changes cancel and reject old lists; closing clears all data', async () => {
    const late = deferred<{ data: AgentThread[]; nextCursor: null }>()
    const state = createCenter(call => {
      if (state.device.value === 'device-a' && call.method === 'thread/list') return late.promise
      return response(call, [thread(state.device.value === 'device-a' ? 'a' : 'b')])
    })
    state.open.value = true; await settle()
    const old = state.calls[0]
    state.device.value = 'device-b'; await settle()
    expect(old.signal?.aborted).toBe(true)
    expect(state.center.rows.value.map(row => row.thread.id)).toEqual(['b'])
    late.resolve({ data: [thread('a')], nextCursor: null }); await settle()
    expect(state.center.rows.value.map(row => row.thread.id)).toEqual(['b'])
    state.open.value = false
    expect(state.center.rows.value).toEqual([])
    expect(state.center.details.value).toBeNull()
    expect(state.center.updatedAt.value).toBeNull()
  })

  test('refreshes at 15 seconds and releases the timer when hidden', async () => {
    const interval = spyOn(globalThis, 'setInterval'), clear = spyOn(globalThis, 'clearInterval')
    restores.push(() => interval.mockRestore(), () => clear.mockRestore())
    const state = createCenter(call => response(call))
    state.open.value = true; await settle()
    const scheduled = interval.mock.calls.at(-1)!
    expect(scheduled[1]).toBe(AGENT_CENTER_REFRESH_MS)
    const before = state.calls.length, tick = scheduled[0]
    if (typeof tick === 'function') tick()
    await settle(); expect(state.calls.length).toBeGreaterThan(before)
    state.open.value = false
    expect(clear).toHaveBeenCalled()
    const after = state.calls.length
    if (typeof tick === 'function') tick()
    await settle(); expect(state.calls).toHaveLength(after)
  })
  test('keeps available details when history or usage is unsupported and rejects another thread usage', async () => {
    const state = createCenter(call => {
      if (call.method === 'thread/turns/list') throw new Error('Unsupported method')
      if (call.method === 'account/usage/read') return { threadUsage: { threadId: 'other-device-thread', groups: [{ totalTokens: 123 }] } }
      return response(call)
    })
    state.open.value = true; await settle()
    expect(state.center.details.value?.thread.id).toBe('a')
    expect(state.center.details.value?.notice).toContain('最近消息暂不可用')
    expect(state.center.details.value?.usage).toBeUndefined()
  })
})
