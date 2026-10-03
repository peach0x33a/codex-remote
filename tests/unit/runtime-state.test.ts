import { createProfileApi } from '../profile-api-fixture'
// Exercises the real RpcClient/useCodex pipeline in memory, without HTTP listeners.
import { afterEach, beforeEach, describe, expect, setSystemTime, spyOn, test } from 'bun:test'
import { createRenderer, nextTick, type App } from 'vue'
import { useCodex } from '../../src/composables/useCodex'
import { RpcClient, RpcError } from '../../src/lib/rpc'
import { promptText } from '../../src/lib/prompt'
import { completedTurnDurations } from '../../src/lib/turn-duration'
import type { ThreadGoal } from '../../src/lib/thread-goal'
import type { ConnectionProfile, Item, MessageContent, Thread, Turn } from '../../shared/protocol'

type HostNode = { children: HostNode[]; parent?: HostNode; text?: string }
const renderer = createRenderer<HostNode, HostNode>({
  createElement: () => ({ children: [] }), createText: text => ({ children: [], text }), createComment: text => ({ children: [], text }),
  insert: (node, parent) => { node.parent = parent; parent.children.push(node) }, remove: node => { if (node.parent) node.parent.children = node.parent.children.filter(child => child !== node) },
  setElementText: (node, text) => { node.text = text }, setText: (node, text) => { node.text = text }, patchProp: () => {}, parentNode: node => node.parent || null, nextSibling: () => null,
})
class MemoryStorage implements Storage {
  private data = new Map<string, string>()
  get length() { return this.data.size }
  getItem(key: string) { return this.data.get(key) ?? null }
  setItem(key: string, value: string) { this.data.set(key, value) }
  removeItem(key: string) { this.data.delete(key) }
  clear() { this.data.clear() }
  key(index: number) { return [...this.data.keys()][index] ?? null }
}
let revertFailure = false, sendFailure = false, turnSequence = 0
type NativeSubmission = { id: string; input: MessageContent[]; clientUserMessageId: string }
type NativeServer = { queues: Map<string, NativeSubmission[]>; settings: Map<string, Record<string, any>>; goals: Map<string, ThreadGoal> }
const primaryDevice: ConnectionProfile = { id: 'device', name: 'Device', endpoint: 'ws://memory.test', cwd: '/configured', createdAt: 0 }
let nativeQueueEnabled = false, queueSequence = 0, holdSettings = false, holdQueueList = false
let releaseSettings: (() => void) | undefined
let releaseQueueList: (() => void) | undefined
let nativeFailure: { method: string; code: number; message: string } | undefined
let nativeServers: Map<string, NativeServer>
let archivedIds: Set<string>
let archiveTransport: ((method: string, params: Record<string, any>, reply: (result: unknown) => void, fail: (code: number, message: string) => void) => boolean) | undefined
function nativeServer(endpoint = primaryDevice.endpoint): NativeServer {
  let server = nativeServers.get(endpoint)
  if (!server) { server = { queues: new Map(), settings: new Map(), goals: new Map() }; nativeServers.set(endpoint, server) }
  return server
}
function pendingOnServer(threadId = 'a', endpoint = primaryDevice.endpoint) {
  const queues = nativeServer(endpoint).queues
  if (!queues.has(threadId)) queues.set(threadId, [])
  return queues.get(threadId)!
}
function remoteSubmission(id: string, text: string): NativeSubmission {
  return { id, clientUserMessageId: 'client-' + id, input: [{ type: 'text', text, text_elements: [] }] }
}
let store: Map<string, Thread>, requests: { method: string; params: Record<string, any>; endpoint: string }[], socket: MemorySocket
class MemorySocket {
  static OPEN = 1
  readyState = 1
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: ((event: { code: number }) => void) | null = null
  onerror: (() => void) | null = null
  readonly endpoint: string
  constructor(url: string) { this.endpoint = new URL(url).searchParams.get('ticket')!; socket = this; queueMicrotask(() => this.deliver({ method: 'bridge/ready' })) }
  deliver(message: object) { if (this.readyState === 1) this.onmessage?.({ data: JSON.stringify(message) }) }
  emit(method: string, params: object) { this.deliver({ method, params }) }
  close() { this.readyState = 3; this.onclose?.({ code: 1000 }) }
  send(raw: string) {
    const message = JSON.parse(raw), p = message.params || {}, method = message.method
    if (message.id === undefined || !method) return
    requests.push({ method, params: p, endpoint: this.endpoint })
    let result: unknown = {}
    const thread = store.get(p.threadId)
    const fail = (code: number, reason: string) => queueMicrotask(() => this.deliver({ id: message.id, error: { code, message: reason } }))
    if (archiveTransport?.(method, p, result => queueMicrotask(() => this.deliver({ id: message.id, result })), fail)) return
    if (nativeQueueEnabled && nativeFailure && nativeFailure.method === method) { fail(nativeFailure.code, nativeFailure.message); return }
    if (method === 'initialize') result = { userAgent: 'memory-test' }
    else if (method.startsWith('thread/queue/')) {
      if (!nativeQueueEnabled) { fail(-32601, 'Unknown method: ' + method); return }
      const queue = pendingOnServer(p.threadId, this.endpoint)
      if (method === 'thread/queue/list') {
        const offset = Number(p.cursor || 0), limit = Number(p.limit || 100)
        result = { data: structuredClone(queue.slice(offset, offset + limit)), nextCursor: offset + limit < queue.length ? String(offset + limit) : null }
        if (holdQueueList) {
          releaseQueueList = () => { releaseQueueList = undefined; this.deliver({ id: message.id, result }) }
          return
        }
      } else {
        if (method === 'thread/queue/add') {
          const submission = { id: 'queued-' + ++queueSequence, input: structuredClone(p.input), clientUserMessageId: p.clientUserMessageId }
          queue.push(submission); result = { queuedSubmission: submission }
        } else if (method === 'thread/queue/update' || method === 'thread/queue/delete') {
          const index = queue.findIndex(job => job.id === p.queuedSubmissionId)
          if (index < 0) { fail(-32602, 'Queued submission not found'); return }
          if (method === 'thread/queue/update') queue[index] = { ...queue[index]!, input: structuredClone(p.input) }
          else queue.splice(index, 1)
        } else { fail(-32601, 'Unknown method: ' + method); return }
        queueMicrotask(() => this.emit('thread/queue/changed', { threadId: p.threadId }))
      }
    } else if (method === 'thread/settings/update') {
      if (!nativeQueueEnabled) { fail(-32601, 'Unknown method: ' + method); return }
      const acknowledge = () => {
        const { threadId, ...settings } = p
        nativeServer(this.endpoint).settings.set(threadId, structuredClone(settings))
        this.deliver({ id: message.id, result: {} })
      }
      if (holdSettings) releaseSettings = () => { releaseSettings = undefined; acknowledge() }; else queueMicrotask(acknowledge)
      return
    }
    else if (method === 'thread/goal/get') result = { goal: nativeServer(this.endpoint).goals.get(p.threadId) || null }
    else if (method === 'thread/goal/set') {
      const goals = nativeServer(this.endpoint).goals, previous = goals.get(p.threadId)
      const goal = { ...goalFixture(p.threadId), ...previous, ...p }
      goals.set(p.threadId, goal); result = { goal }
    }
    else if (method === 'thread/goal/clear') result = { cleared: nativeServer(this.endpoint).goals.delete(p.threadId) }
    else if (method === 'model/list') result = { data: [{ id: 'm', model: 'm', displayName: 'Model', isDefault: true, defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'medium' }] }], nextCursor: null }
    else if (method === 'config/read') result = { config: { approvals_reviewer: 'user' } }
    else if (method === 'configRequirements/read') result = { requirements: null }
    else if (method === 'thread/list') {
      const offset = Number(p.cursor || 0), limit = Number(p.limit ?? 100)
      const activity = (thread: Thread) => p.sortKey === 'updated_at' ? thread.updatedAt : thread.recencyAt ?? thread.updatedAt
      const data = [...store.values()].filter(thread => archivedIds.has(thread.id) === (p.archived === true) && (!p.searchTerm || (thread.name || thread.preview).includes(p.searchTerm))).sort((a, b) => activity(b) - activity(a))
      result = { data: data.slice(offset, offset + limit).map(thread => ({ ...thread, turns: [] })), nextCursor: offset + limit < data.length ? String(offset + limit) : null }
    }
    else if (method === 'thread/resume') {
      const saved = nativeQueueEnabled ? nativeServer(this.endpoint).settings.get(p.threadId) : undefined
      result = { thread: { ...thread!, turns: [] }, model: saved?.model ?? 'm', reasoningEffort: saved?.effort ?? 'medium', approvalPolicy: saved?.approvalPolicy ?? 'on-request', approvalsReviewer: saved?.approvalsReviewer ?? 'user', sandbox: saved?.sandboxPolicy ?? { type: 'workspaceWrite', networkAccess: false, writableRoots: [] } }
    }
    else if (method === 'thread/turns/list') result = { data: thread!.turns.map(turn => ({ ...turn, items: [] })).reverse(), nextCursor: null }
    else if (method === 'thread/items/list') { const data = thread!.turns.filter(turn => !p.turnId || p.turnId === turn.id).flatMap(turn => turn.items.map(item => ({ turnId: turn.id, item, startedAtMs: item.startedAtMs, completedAtMs: item.completedAtMs }))); result = { data: (p.sortDirection === 'asc' ? data : data.reverse()).slice(0, p.limit || 60), nextCursor: null } }
    else if (method === 'thread/revert') {
      if (revertFailure) { queueMicrotask(() => this.deliver({ id: message.id, error: { code: -32601, message: 'Not supported' } })); return }
      const index = thread!.turns.findIndex(turn => turn.id === p.beforeTurnId)
      thread!.turns = thread!.turns.slice(0, index); thread!.status = { type: 'idle' }; result = { thread: { ...thread!, turns: [] } }
    } else if (method === 'turn/interrupt') {
      const turn = thread!.turns.find(turn => turn.id === p.turnId)!; turn.status = 'interrupted'; queueMicrotask(() => this.emit('turn/completed', { threadId: p.threadId, turn }))
    } else if (method === 'thread/start') {
      const now = Math.floor(Date.now() / 1000)
      const created: Thread = { id: 'created', preview: '', cwd: p.cwd || '/default', createdAt: now, updatedAt: now, status: { type: 'idle' }, turns: [] }
      store.set(created.id, created); result = { thread: created, model: 'm' }
      queueMicrotask(() => this.emit('thread/started', { thread: created }))
    } else if (method === 'turn/start') {
      if (sendFailure) { queueMicrotask(() => this.deliver({ id: message.id, error: { code: -32603, message: 'Send failed' } })); return }
      const turn: Turn = { id: 'running-' + ++turnSequence, status: 'inProgress', items: [{ id: 'user-' + turnSequence, type: 'userMessage', content: p.input }] }
      thread!.turns.push(turn); result = { turn }
      queueMicrotask(() => this.emit('turn/started', { threadId: p.threadId, turn }))
    } else if (method === 'thread/archive') archivedIds.add(p.threadId)
    else if (method === 'thread/unarchive') { archivedIds.delete(p.threadId); result = { thread: { ...thread!, turns: [] } } }
    else if (method === 'thread/read') result = { thread: { ...thread!, turns: [] } }
    queueMicrotask(() => this.deliver({ id: message.id, result }))
  }
}
let profileApi: Awaited<ReturnType<typeof createProfileApi>>
let app: App<HostNode>, state: ReturnType<typeof useCodex>
const originals = new Map<string, PropertyDescriptor | undefined>()
function installGlobal(name: string, value: unknown) { originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, writable: true, value }) }
async function settle() { await profileApi?.idle(); for (let i = 0; i < 8; i++) await Promise.resolve(); await nextTick() }
async function eventually(check: () => boolean, message: string) {
  for (let i = 0; i < 50 && !check(); i++) await settle()
  expect(check(), message).toBe(true)
}
function mountRuntime() { app = renderer.createApp({ setup() { state = useCodex(); return () => null } }); app.mount({ children: [] }) }
beforeEach(async () => {
  const now = Math.floor(Date.now() / 1000)
  store = new Map(['a', 'b'].map(id => [id, { id, name: id, preview: '', cwd: '/projects/' + id, createdAt: now, updatedAt: now, turns: [], status: { type: 'idle' } }]))
  requests = []; revertFailure = false; sendFailure = false; turnSequence = 0
  archivedIds = new Set(); archiveTransport = undefined
  nativeQueueEnabled = false; nativeServers = new Map(); queueSequence = 0; nativeFailure = undefined; holdSettings = false; releaseSettings = undefined
  holdQueueList = false; releaseQueueList = undefined
  installGlobal('window', new EventTarget()); installGlobal('navigator', { onLine: true }); installGlobal('location', { protocol: 'http:', host: 'memory.test' })
  installGlobal('localStorage', new MemoryStorage()); installGlobal('WebSocket', MemorySocket)
  profileApi = await createProfileApi([primaryDevice])
  installGlobal('fetch', async (url: string, init?: RequestInit) => url === '/api/profiles' ? profileApi.handle(init) : Response.json(url.includes('/api/connect') ? { ticket: JSON.parse(String(init?.body)).endpoint } : { authenticated: true, requiresKey: false }))
  mountRuntime(); await state.start()
  await state.connect(primaryDevice); await settle()
  await state.openThread('a'); await settle()
})
afterEach(async () => {
  app?.unmount(); await profileApi.dispose(); setSystemTime()
  for (const [name, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name) }
  originals.clear()
})

describe('native conversation menu actions', () => {
  test('rename updates metadata only after the server acknowledgement', async () => {
    let release: (() => void) | undefined
    archiveTransport = (method, params, reply) => { if (method !== 'thread/name/set') return false; expect(params).toEqual({ threadId: 'a', name: 'New name' }); release = () => reply({}); return true }
    const pending = state.renameThread('a', ' New name ')
    await eventually(() => !!release, 'rename request should arrive')
    expect(state.active.value?.name).toBe('a')
    release!(); await pending
    expect(state.active.value?.name).toBe('New name')
  })
  test('fork asks the native server to defer goals and does not start another model turn', async () => {
    const fork = { ...store.get('a')!, id: 'forked', turns: [] }
    archiveTransport = (method, params, reply) => { if (method !== 'thread/fork') return false; expect(params).toEqual({ threadId: 'a', lastTurnId: 'last', excludeTurns: true, deferGoalContinuation: true }); reply({ thread: fork }); return true }
    const result = await state.forkThread('a', 'last')
    expect(result.id).toBe('forked'); expect(state.active.value?.id).toBe('a')
    expect(requests.some(call => call.method === 'turn/start')).toBe(false)
  })
  test('late fork results from a disconnected device are not inserted into another device', async () => {
    let release: (() => void) | undefined
    archiveTransport = (method, _params, reply) => { if (method !== 'thread/fork') return false; release = () => reply({ thread: { ...store.get('a')!, id: 'old-fork' } }); return true }
    const pending = state.forkThread('a')
    const rejected = pending.catch(cause => cause)
    await eventually(() => !!release, 'fork request should arrive')
    await state.connect({ ...primaryDevice, id: 'different', endpoint: 'ws://different.test' })
    release!(); expect(await rejected).toBeInstanceOf(Error)
    expect(state.threads.value.some(thread => thread.id === 'old-fork')).toBe(false)
  })
})

function beginReasoning() {
  const turn: Turn = { id: 'thought-turn', status: 'inProgress', items: [] }
  socket.emit('turn/started', { threadId: 'a', turn })
  socket.emit('item/started', { threadId: 'a', turnId: turn.id, item: { id: 'thought', type: 'reasoning', summary: [], content: [] } })
  socket.emit('item/reasoning/textDelta', { threadId: 'a', turnId: turn.id, itemId: 'thought', contentIndex: 0, delta: 'Checking the task.' })
  return turn
}

describe('archived thread service through the real RPC pipeline', () => {
  test('an earlier archive notification does not override a later successful restore ack', async () => {
    await state.archive('b')
    let release!: () => void
    archiveTransport = (method, _params, reply) => {
      if (method !== 'thread/unarchive') return false
      release = () => { archivedIds.delete('b'); reply({ thread: store.get('b') }) }; return true
    }
    const restoring = state.unarchive('b')
    socket.emit('thread/archived', { threadId: 'b' })
    release()
    expect(await restoring).toBe(true)
    expect(state.projectThreads.value.some(thread => thread.id === 'b')).toBe(true)
  })
  test('a failed restore keeps the archived row, tombstone and current conversation available for retry', async () => {
    await state.archive('b')
    const archived = await state.readArchivedThreads({}), active = state.active.value
    archiveTransport = (method, _params, _reply, fail) => { if (method !== 'thread/unarchive') return false; fail(-32603, 'Restore denied'); return true }
    expect(await state.unarchive('b')).toBe(false)
    expect(state.error.value).toContain('Restore denied')
    expect(await state.readArchivedThreads({})).toEqual(archived)
    expect(state.projectThreads.value.some(thread => thread.id === 'b')).toBe(false)
    expect(state.active.value).toBe(active)
    archiveTransport = undefined
    expect(await state.unarchive('b')).toBe(true)
    expect(state.projectThreads.value.some(thread => thread.id === 'b')).toBe(true)
  })

  test('restores old history without moving the recent cutoff and opens it only on explicit request', async () => {
    Object.assign(store.get('b')!, { createdAt: 1, updatedAt: 1, recencyAt: 1 })
    await state.archive('b')
    const recent = [...state.projectThreads.value], active = state.active.value
    expect(await state.unarchive('b')).toBe(true)
    expect((await state.readArchivedThreads({})).data).toEqual([])
    expect(state.projectThreads.value).toEqual(recent); expect(state.active.value).toBe(active)
    await state.openThread('b')
    expect(state.active.value?.id).toBe('b'); expect(state.projectThreads.value).toEqual(recent)
  })

  test('a failed archived read rejects without clearing the last page or the normal snapshot', async () => {
    await state.archive('b')
    const previous = await state.readArchivedThreads({}), recent = [...state.projectThreads.value]
    archiveTransport = (method, params, _reply, fail) => { if (method !== 'thread/list' || !params.archived) return false; fail(-32603, 'Archive list unavailable'); return true }
    await expect(state.readArchivedThreads({ searchTerm: 'b' })).rejects.toThrow('Archive list unavailable')
    expect(previous.data.map(thread => thread.id)).toEqual(['b'])
    expect(state.error.value).toContain('Archive list unavailable'); expect(state.projectThreads.value).toEqual(recent)
  })

  test.each(['bad-data', 'oversize', 'missing-cursor', 'repeated-cursor'] as const)('rejects %s archived pages without fetching more or changing the recent snapshot', async kind => {
    const recent = [...state.projectThreads.value], mark = requests.length
    const result = kind === 'bad-data' ? { data: [null], nextCursor: null }
      : kind === 'oversize' ? { data: Array(31).fill(store.get('b')), nextCursor: null }
      : kind === 'missing-cursor' ? { data: [] } : { data: [], nextCursor: 'same-cursor' }
    archiveTransport = (method, params, reply) => { if (method !== 'thread/list' || !params.archived) return false; reply(result); return true }
    await expect(state.readArchivedThreads({ cursor: 'same-cursor' })).rejects.toThrow('归档列表响应')
    expect(requests.slice(mark)).toHaveLength(1); expect(state.projectThreads.value).toEqual(recent)
  })

  test('cancels an archived read without an error banner or publishing its late result', async () => {
    const controller = new AbortController(), recent = [...state.projectThreads.value]
    let release!: () => void
    archiveTransport = (method, params, reply) => { if (method !== 'thread/list' || !params.archived) return false; release = () => reply({ data: [store.get('b')], nextCursor: null }); return true }
    state.error.value = 'Existing notice'
    const reading = state.readArchivedThreads({}, { signal: controller.signal })
    controller.abort()
    await expect(reading).rejects.toMatchObject({ name: 'AbortError' })
    release(); await settle()
    expect(state.error.value).toBe('Existing notice'); expect(state.projectThreads.value).toEqual(recent)
  })

  test('honors the archived read timeout and never automatically retries it', async () => {
    const mark = requests.length
    archiveTransport = (method, params) => method === 'thread/list' && params.archived === true
    await expect(state.readArchivedThreads({}, { timeoutMs: 5 })).rejects.toThrow('请求超时')
    expect(requests.slice(mark)).toHaveLength(1); expect(state.error.value).toContain('归档列表加载失败')
  })

  test.each(['disconnect', 'device'] as const)('%s rejects a pending archive read and isolates a late restore callback', async action => {
    await state.archive('b')
    const releases: (() => void)[] = []
    archiveTransport = (method, params, reply) => {
      if (method === 'thread/list' && params.archived) { releases.push(() => reply({ data: [store.get('b')], nextCursor: null })); return true }
      if (method === 'thread/unarchive') { releases.push(() => reply({ thread: store.get('b') })); return true }
      return false
    }
    const oldSocket = socket
    const reading = state.readArchivedThreads({}).then(() => null, cause => cause)
    const restoring = state.unarchive('b')
    if (action === 'device') await state.connect({ ...primaryDevice, id: 'other', endpoint: 'ws://other-memory.test' })
    else state.disconnect()
    await settle()
    const recent = [...state.projectThreads.value], active = state.active.value
    state.error.value = 'New connection notice'
    for (const release of releases) release()
    oldSocket.onmessage?.({ data: JSON.stringify({ method: 'thread/unarchived', params: { threadId: 'b' } }) })
    expect(await reading).toMatchObject({ name: 'AbortError' }); expect(await restoring).toBe(false)
    await settle()
    expect(state.error.value).toBe('New connection notice'); expect(state.projectThreads.value).toEqual(recent); expect(state.active.value).toBe(active)
  })

  test('a later archive notification wins over an older unarchive metadata response', async () => {
    await state.archive('b')
    let release!: () => void
    archiveTransport = (method, _params, reply) => { if (method !== 'thread/read') return false; release = () => reply({ thread: store.get('b') }); return true }
    archivedIds.delete('b'); socket.emit('thread/unarchived', { threadId: 'b' })
    archivedIds.add('b'); socket.emit('thread/archived', { threadId: 'b' })
    release(); await settle()
    expect(state.projectThreads.value.some(thread => thread.id === 'b')).toBe(false)
    expect((await state.readArchivedThreads({})).data.map(thread => thread.id)).toEqual(['b'])
  })

  test('a failed notification metadata read keeps the confirmed restoration recoverable by list refresh', async () => {
    await state.archive('b')
    archiveTransport = (method, _params, _reply, fail) => { if (method !== 'thread/read') return false; fail(-32603, 'Metadata unavailable'); return true }
    archivedIds.delete('b'); socket.emit('thread/unarchived', { threadId: 'b' }); await settle()
    expect(state.notice.value).toContain('Metadata unavailable')
    archiveTransport = undefined
    await state.refreshThreads()
    expect(state.projectThreads.value.some(thread => thread.id === 'b')).toBe(true)
  })

  test('restoration survives an in-flight recent list snapshot that still omits the archived thread', async () => {
    await state.archive('b')
    let release!: () => void
    archiveTransport = (method, params, reply) => {
      if (method !== 'thread/list' || params.archived) return false
      const snapshot = { data: [{ ...store.get('a')!, turns: [] }], nextCursor: null }
      release = () => reply(snapshot); return true
    }
    const refreshing = state.refreshThreads()
    expect(await state.unarchive('b')).toBe(true)
    release(); await refreshing
    expect(state.projectThreads.value.map(thread => thread.id).sort()).toEqual(['a', 'b'])
  })

  test('an acknowledged restore is not retried or reported failed when only its metadata is invalid', async () => {
    await state.archive('b')
    archiveTransport = (method, _params, reply) => { if (method !== 'thread/unarchive') return false; archivedIds.delete('b'); reply({ thread: { ...store.get('b')!, id: 'wrong-thread' } }); return true }
    const mark = requests.length
    expect(await state.unarchive('b')).toBe(true)
    expect(state.notice.value).toContain('服务端已确认恢复归档')
    expect(state.projectThreads.value.some(thread => thread.id === 'wrong-thread')).toBe(false)
    expect(requests.slice(mark).filter(request => request.method === 'thread/unarchive')).toHaveLength(1)
    archiveTransport = undefined
    await state.refreshThreads()
    expect(state.projectThreads.value.some(thread => thread.id === 'b')).toBe(true)
  })

  test('a remote unarchive notification clears the tombstone and reads metadata without resuming', async () => {
    await state.archive('b')
    const mark = requests.length, active = state.active.value
    archivedIds.delete('b')
    socket.emit('thread/unarchived', { threadId: 'b' })
    await eventually(() => state.projectThreads.value.some(thread => thread.id === 'b'), 'the remotely restored thread should return to the recent snapshot')
    expect(state.active.value).toBe(active)
    expect(requests.slice(mark).map(({ method, params }) => ({ method, params }))).toEqual([{ method: 'thread/read', params: { threadId: 'b', includeTurns: false } }])
  })
  test('restores an archived conversation only after its ack without opening or deleting it', async () => {
    const active = state.active.value
    await state.archive('b')
    expect((await state.readArchivedThreads({})).data.map(thread => thread.id)).toEqual(['b'])
    expect(state.projectThreads.value.some(thread => thread.id === 'b')).toBe(false)
    let release!: () => void
    archiveTransport = (method, params, reply) => {
      if (method !== 'thread/unarchive') return false
      release = () => { archivedIds.delete(params.threadId); reply({ thread: { ...store.get(params.threadId)!, turns: [] } }) }
      return true
    }
    const mark = requests.length
    let finished = false
    const restoring = state.unarchive('b').then(result => { finished = true; return result })
    await settle()
    expect(finished).toBe(false); expect(state.projectThreads.value.some(thread => thread.id === 'b')).toBe(false)
    expect((await state.readArchivedThreads({})).data.map(thread => thread.id)).toEqual(['b'])
    release()
    expect(await restoring).toBe(true)
    expect(state.projectThreads.value.some(thread => thread.id === 'b')).toBe(true)
    expect((await state.readArchivedThreads({})).data).toEqual([])
    expect(state.active.value).toBe(active)
    expect(requests.slice(mark).filter(request => request.method !== 'thread/list').map(({ method, params }) => ({ method, params }))).toEqual([{ method: 'thread/unarchive', params: { threadId: 'b' } }])
  })
  test('reads bounded archived pages with server-side title search outside the recent window', async () => {
    for (let index = 0; index < 35; index++) {
      const id = 'archived-' + index
      store.set(id, { id, name: 'Old task ' + index, preview: '', cwd: '/old', createdAt: 1, updatedAt: index + 1, turns: [] })
      archivedIds.add(id)
    }
    const mark = requests.length, active = state.active.value, recent = [...state.projectThreads.value]
    const first = await state.readArchivedThreads({})
    expect(first.data).toHaveLength(30); expect(first.data[0]!.id).toBe('archived-34'); expect(first.nextCursor).toBe('30')
    expect(requests.slice(mark).map(({ method, params }) => ({ method, params }))).toEqual([{ method: 'thread/list', params: { archived: true, limit: 30, cursor: null, sortKey: 'updated_at', sortDirection: 'desc', modelProviders: [] } }])
    const last = await state.readArchivedThreads({ cursor: first.nextCursor })
    expect(last.data.map(thread => thread.id)).toEqual(['archived-4', 'archived-3', 'archived-2', 'archived-1', 'archived-0'])
    expect(last.nextCursor).toBeNull()
    const found = await state.readArchivedThreads({ searchTerm: 'Old task 17' })
    expect(found.data.map(thread => thread.id)).toEqual(['archived-17'])
    expect(requests.at(-1)?.params.searchTerm).toBe('Old task 17')
    expect(state.active.value).toBe(active); expect(state.projectThreads.value).toEqual(recent)
  })
})
describe('runtime retry, timing, and projects without network ports', () => {
  test.each(['summaryTextDelta', 'textDelta'])('moves live %s reasoning to completed history without losing streamed text', async deltaType => {
    const turn: Turn = { id: 'reasoning-lifecycle', status: 'inProgress', items: [] }
    socket.emit('turn/started', { threadId: 'a', turn })
    socket.emit('item/started', { threadId: 'a', turnId: turn.id, item: { id: 'thought-move', type: 'reasoning', summary: [], content: [] } })
    await settle()
    expect(state.liveReasoning.value).toBe('')
    socket.emit('item/reasoning/' + deltaType, { threadId: 'a', turnId: turn.id, itemId: 'thought-move', summaryIndex: 0, contentIndex: 0, delta: '实际思考正文' })
    await settle()
    expect(state.liveReasoning.value).toBe('实际思考正文')
    socket.emit('item/completed', { threadId: 'a', turnId: turn.id, item: { id: 'thought-move', type: 'reasoning', summary: [], content: [] } })
    await settle()
    expect(state.liveReasoning.value).toBe('')
    expect(state.thinkingElapsed.value).toBeUndefined()
    const items = state.items.value.filter(item => item.id === 'thought-move')
    expect(items).toHaveLength(1)
    expect(items[0]?.status).toBe('completed')
    expect(JSON.stringify(items[0])).toContain('实际思考正文')
    expect(state.activeTurn.value?.id).toBe(turn.id)
  })
  test('live reasoning never leaks into another selected conversation', async () => {
    beginReasoning(); await settle()
    expect(state.liveReasoning.value).not.toBe('')
    await state.openThread('b'); await settle()
    expect(state.liveReasoning.value).toBe('')
    expect(state.thinkingElapsed.value).toBeUndefined()
  })
  test.each([false, true])('old unfinished history never becomes the live turn after a newer completion (legacy=%s)', async legacy => {
    const now = Math.floor(Date.now() / 1000)
    const old: Turn = { id: 'old-orphan', status: 'inProgress', startedAt: now - 82422, items: [{ id: 'old-output', type: 'agentMessage', text: 'old partial reply' }] }
    const completed: Turn = { id: 'latest-completed', status: 'completed', startedAt: now - 612, completedAt: now, durationMs: 612000, items: [{ id: 'latest-answer', type: 'agentMessage', text: 'finished', phase: 'final_answer' }] }
    store.get('a')!.turns = [old, { id: 'empty-orphan', status: 'inProgress', startedAt: now - 80000, items: [] }, completed]
    if (legacy) archiveTransport = (method, params, reply, fail) => {
      if (method === 'thread/turns/list') { fail(-32601, 'Unknown method'); return true }
      if (method === 'thread/resume' && !params.excludeTurns) { reply({ thread: structuredClone(store.get('a')!), model: 'm', approvalPolicy: 'on-request', sandbox: { type: 'workspaceWrite' } }); return true }
      return false
    }
    await state.openThread('a'); await settle()
    expect(state.busy.value).toBe(false)
    expect(state.activeTurn.value).toBeUndefined(); expect(state.workingElapsed.value).toBeUndefined()
    expect(state.items.value.some(item => item.id === 'old-output')).toBe(true)
    expect(completedTurnDurations(state.displayTurns.value).get('latest-answer')).toBe(612)
    expect(await state.send([{ type: 'text', text: 'next question' }])).toBe(true)
    const started = requests.filter(request => request.method === 'turn/start')
    expect(started).toHaveLength(1); expect(started[0]!.params.input[0].text).toBe('next question')
    expect(requests.some(request => request.method === 'turn/steer' || request.method === 'thread/queue/add')).toBe(false)
    const live = state.activeTurn.value!
    expect(live.id).not.toBe(old.id); expect(state.workingElapsed.value).toBe(0)
    socket.emit('turn/completed', { threadId: 'a', turn: { ...live, status: 'completed' } }); await settle()
    expect(state.busy.value).toBe(false); expect(state.workingElapsed.value).toBeUndefined()
    socket.emit('item/completed', { threadId: 'a', turnId: 'older-unloaded', item: { id: 'late-history', type: 'agentMessage', text: 'delayed historical event' } }); await settle()
    expect(state.activeTurn.value).toBeUndefined(); expect(state.busy.value).toBe(false)
  })
  test('an empty latest live turn wins over older unfinished items and remains live for long-running work', async () => {
    const now = Math.floor(Date.now() / 1000)
    store.get('a')!.turns = [
      { id: 'orphan-with-items', status: 'inProgress', startedAt: now - 200000, items: [{ id: 'old-reasoning', type: 'reasoning', status: 'inProgress', summary: ['old thought'] }] },
      { id: 'done', status: 'completed', items: [{ id: 'done-answer', type: 'agentMessage', text: 'done' }] },
      { id: 'current-empty', status: 'inProgress', startedAt: now - 90000, items: [] },
    ]
    await state.openThread('a'); await settle()
    expect(state.activeTurn.value?.id).toBe('current-empty'); expect(state.busy.value).toBe(true)
    expect(state.workingElapsed.value).toBe(90000); expect(state.liveReasoning.value).toBe('')
    socket.emit('turn/completed', { threadId: 'a', turn: { id: 'orphan-with-items', status: 'completed', items: [] } }); await settle()
    expect(state.activeTurn.value?.id).toBe('current-empty'); expect(state.busy.value).toBe(true)
    socket.emit('turn/completed', { threadId: 'a', turn: { id: 'current-empty', status: 'completed', items: [] } }); await settle()
    expect(state.activeTurn.value).toBeUndefined(); expect(state.busy.value).toBe(false)
  })
  test('work time advances without reasoning and resets for a new turn', async () => {
    const turn: Turn = { id: 'working-turn', status: 'inProgress', items: [] }
    store.get('a')!.turns = [turn]
    socket.emit('turn/started', { threadId: 'a', turn }); await settle()
    expect(state.workingElapsed.value).toBe(0)
    expect(state.thinkingElapsed.value).toBeUndefined()
    setSystemTime(Date.now() + 4500); await Bun.sleep(1100)
    expect(state.workingElapsed.value!).toBeGreaterThanOrEqual(4)
    const elapsed = state.workingElapsed.value!
    await state.openThread('b'); await settle()
    expect(state.workingElapsed.value).toBeUndefined()
    await state.openThread('a'); await settle()
    expect(state.workingElapsed.value!).toBeGreaterThanOrEqual(elapsed)
    socket.emit('turn/completed', { threadId: 'a', turn: { ...turn, status: 'completed' } }); await settle()
    expect(state.workingElapsed.value).toBeUndefined()
    socket.emit('turn/started', { threadId: 'a', turn: { id: 'next-work', status: 'inProgress', items: [] } }); await settle()
    expect(state.workingElapsed.value).toBe(0)
  })
  test('restores elapsed work time from server start timestamps in seconds', async () => {
    const startedAt = Math.floor(Date.now() / 1000) - 125
    store.get('b')!.turns = [{ id: 'remote-work', status: 'inProgress', startedAt, items: [] }]
    await state.openThread('b'); await settle()
    expect(state.workingElapsed.value).toBe(125)
    socket.emit('error', { threadId: 'b', turnId: 'remote-work', willRetry: true, error: { message: 'Reconnecting...' } })
    expect(state.workingElapsed.value).toBe(125)
  })

  test('preserves native turn start when completion omits it and freezes summary duration', async () => {
    const turn: Turn = { id: 'native-timed', status: 'inProgress', startedAt: 1000, items: [] }
    socket.emit('turn/started', { threadId: 'a', turn })
    socket.emit('item/completed', { threadId: 'a', turnId: turn.id, item: { id: 'timed-final', type: 'agentMessage', phase: 'final_answer', text: 'done' } })
    expect(completedTurnDurations(state.displayTurns.value).size).toBe(0)
    socket.emit('turn/completed', { threadId: 'a', turn: { ...turn, startedAt: null, completedAt: 1138, durationMs: null, status: 'completed' } })
    expect(state.active.value!.turns.find(item => item.id === turn.id)!.startedAt).toBe(1000)
    expect(completedTurnDurations(state.displayTurns.value).get('timed-final')).toBe(138)
    setSystemTime(new Date('2026-10-03T10:00:00Z'))
    expect(completedTurnDurations(state.displayTurns.value).get('timed-final')).toBe(138)
  })
  test('restores native completed work duration from history without using local join time', async () => {
    store.get('a')!.turns = [{ id: 'stored-timed', status: 'completed', durationMs: 138000, items: [{ id: 'stored-final', type: 'agentMessage', phase: 'final_answer', text: 'stored summary' }] }, { id: 'unknown-time', status: 'completed', items: [{ id: 'unknown-final', type: 'agentMessage', text: 'no timing' }] }]
    await state.openThread('a')
    expect(completedTurnDurations(state.displayTurns.value).get('stored-final')).toBe(138)
    expect(completedTurnDurations(state.displayTurns.value).has('unknown-final')).toBe(false)
  })
  test('tracks compaction lifecycle even when server items omit their status', async () => {
    const turn: Turn = { id: 'compact-turn', status: 'inProgress', items: [] }
    socket.emit('turn/started', { threadId: 'a', turn })
    socket.emit('item/started', { threadId: 'a', turnId: turn.id, item: { id: 'compact', type: 'contextCompaction' } })
    await settle()
    expect(state.compacting.value).toBe(true)
    socket.emit('item/completed', { threadId: 'a', turnId: turn.id, item: { id: 'compact', type: 'contextCompaction' } })
    await settle()
    expect(state.compacting.value).toBe(false)
    expect(state.items.value.find(item => item.id === 'compact')?.status).toBe('completed')
    socket.emit('item/started', { threadId: 'a', turnId: turn.id, item: { id: 'compact-next', type: 'contextCompaction' } })
    socket.emit('turn/completed', { threadId: 'a', turn: { ...turn, status: 'interrupted', items: [] } })
    await settle()
    expect(state.compacting.value).toBe(false)
    expect(state.items.value.find(item => item.id === 'compact-next')?.status).toBe('failed')
  })
  test('restores active compaction from history and clears it on completion', async () => {
    const item: Item = { id: 'saved-compaction', type: 'contextCompaction', startedAtMs: 1000 }
    const turn: Turn = { id: 'saved-turn', status: 'inProgress', items: [item] }
    store.get('b')!.turns = [turn]
    await state.openThread('b'); await settle()
    expect(state.compacting.value).toBe(true)
    socket.emit('turn/completed', { threadId: 'b', turn: { ...turn, status: 'completed' } }); await settle()
    expect(state.compacting.value).toBe(false)
    expect(state.items.value[0]?.status).toBe('completed')
  })
  test('keeps queued input local until the active turn completes', async () => {
    await state.send([{ type: 'text', text: 'First request' }]); await settle()
    const turn = state.activeTurn.value!
    await state.send([{ type: 'text', text: 'Next request' }]); await settle()
    expect(state.currentQueue.value).toHaveLength(1)
    expect(requests.filter(request => request.method === 'turn/start')).toHaveLength(1)
    expect(requests.filter(request => request.method === 'turn/steer')).toHaveLength(0)
    socket.emit('turn/completed', { threadId: 'a', turn: { ...turn, status: 'completed' } }); await settle()
    expect(state.currentQueue.value).toHaveLength(0)
    const starts = requests.filter(request => request.method === 'turn/start')
    expect(starts).toHaveLength(2)
    expect(starts[1]!.params.input[0].text).toBe('Next request')
  })

  test('shows a sent user message before turn/start is acknowledged and removes the optimistic copy on ack', async () => {
    let release: (() => void) | undefined
    archiveTransport = (method, _params, reply) => {
      if (method !== 'turn/start') return false
      release = () => reply({ turn: { id: 'held-turn', status: 'inProgress', items: [{ id: 'remote-user', type: 'userMessage', content: [{ type: 'text', text: 'waiting for reply', text_elements: [] }] }] } })
      return true
    }
    const sending = state.send([{ type: 'text', text: 'waiting for reply' }])
    await eventually(() => !!release, 'turn/start should be waiting for its acknowledgement')
    expect(state.items.value.filter(item => item.type === 'userMessage').map(item => item.content?.[0])).toEqual([{ type: 'text', text: 'waiting for reply', text_elements: [] }])
    release!()
    expect(await sending).toBe(true)
    await settle()
    expect(state.items.value.filter(item => item.type === 'userMessage')).toHaveLength(1)
  })

  test('shows a sent user message before a new thread/start is acknowledged', async () => {
    let release: (() => void) | undefined
    archiveTransport = (method, _params, reply) => {
      if (method !== 'thread/start') return false
      release = () => {
        const created: Thread = { ...store.get('a')!, id: 'created', preview: '', turns: [] }
        store.set(created.id, created)
        reply({ thread: created, model: 'm' })
      }
      return true
    }
    state.newThread()
    const sending = state.send([{ type: 'text', text: 'new conversation message' }])
    await eventually(() => !!release, 'thread/start should be waiting for its acknowledgement')
    expect(state.active.value?.id).toStartWith('pending-thread-')
    expect(state.items.value.filter(item => item.type === 'userMessage').map(item => item.content?.[0])).toEqual([{ type: 'text', text: 'new conversation message', text_elements: [] }])
    release!()
    expect(await sending).toBe(true)
    await settle()
    expect(state.active.value?.id).toBe('created')
    expect(state.items.value.filter(item => item.type === 'userMessage')).toHaveLength(1)
  })

  test('retryable errors use the working status and recover without a banner', async () => {
    const turn = beginReasoning(); await settle()
    socket.emit('error', { threadId: 'a', turnId: turn.id, willRetry: true, error: { message: 'Reconnecting... 1/5' } }); await settle()
    expect(state.reconnectStatus.value).toBe('Reconnecting... 1/5'); expect(state.error.value).toBe('')
    socket.emit('item/reasoning/textDelta', { threadId: 'a', turnId: turn.id, itemId: 'thought', contentIndex: 0, delta: ' Resumed.' }); await settle()
    expect(state.reconnectStatus.value).toBe(''); expect(state.liveReasoning.value).toContain('Resumed.'); expect(state.error.value).toBe('')
    socket.emit('error', { threadId: 'a', turnId: turn.id, willRetry: false, error: { message: 'Final failure' } })
    expect(state.error.value).toBe(''); expect(state.currentTurnFailure.value).toBe('Final failure')
  })

  test('uses selected cwd for a new thread and keeps the project catalog updated', async () => {
    expect(state.projectThreads.value).toHaveLength(2)
    state.newThread(); state.workingDirectory.value = '/chosen/project'
    expect(await state.send([{ type: 'text', text: 'New project task' }])).toBe(true); await settle()
    expect(requests.find(request => request.method === 'thread/start')?.params.cwd).toBe('/chosen/project')
    expect(state.projectThreads.value.find(thread => thread.id === 'created')).toMatchObject({ cwd: '/chosen/project', preview: 'New project task' })
    socket.emit('thread/name/updated', { threadId: 'created', threadName: 'Renamed task' })
    expect(state.projectThreads.value.find(thread => thread.id === 'created')?.name).toBe('Renamed task')
  })
  test('shares the newest two calendar dates across project discovery, search and started events', async () => {
    const at = (day: number) => new Date(2026, 8, day, 12).getTime() / 1000
    const makeThread = (id: string, project: string, updatedAt: number, recencyAt?: number): Thread => ({
      id, name: id, preview: '', cwd: '/projects/' + project, createdAt: at(27), updatedAt, recencyAt, status: { type: 'idle' }, turns: [],
    })
    setSystemTime(at(30) * 1000)
    // Insert old threads first and give them newer updatedAt values: recencyAt must win.
    const old = Array.from({ length: 100 }, (_, i) => makeThread('old-' + i, 'old27', at(29), at(27)))
    const previous = makeThread('previous', 'previous28', at(28))
    const newest = Array.from({ length: 100 }, (_, i) => makeThread('newest-' + i, 'newest29', at(27), at(29) + i))
    store = new Map([...old, previous, ...newest].map(thread => [thread.id, thread]))
    requests = []
    await state.connect(primaryDevice)
    await eventually(() => !state.loading.value && !state.projectsLoading.value, 'the shared recent window finishes loading')
    const listRequests = () => requests.filter(request => request.method === 'thread/list')
    const expectedIds = [...newest].reverse().map(thread => thread.id).concat(previous.id)
    expect(state.projectPaths.value).toEqual(['/projects/newest29', '/projects/previous28'])
    expect(state.projectThreads.value.map(thread => thread.id)).toEqual(expectedIds)
    expect(state.threads.value.map(thread => thread.id)).toEqual(expectedIds)
    expect(state.threadCursor.value).toBeNull()
    // The second page crosses into the 27th; its remaining cursor must not scan all history.
    expect(listRequests().map(request => request.params)).toEqual([
      { limit: 100, cursor: null, sortKey: 'recency_at', sortDirection: 'desc', archived: false, useStateDbOnly: true },
      { limit: 100, cursor: '100', sortKey: 'recency_at', sortDirection: 'desc', archived: false, useStateDbOnly: true },
    ])
    const initialLists = listRequests()
    await state.refreshThreads('old')
    await settle()
    expect(state.threads.value).toEqual([])
    expect(state.projectPaths.value).toEqual(['/projects/newest29', '/projects/previous28'])
    expect(state.projectThreads.value.map(thread => thread.id)).toEqual(expectedIds)
    expect(listRequests()).toEqual(initialLists)
    await state.refreshThreads('')
    expect(state.threads.value.map(thread => thread.id)).toEqual(expectedIds)
    expect(listRequests()).toEqual(initialLists)

    const started = makeThread('started-30', 'new30', at(30))
    store.set(started.id, started)
    socket.emit('thread/started', { thread: started })
    await settle()
    const advancedIds = [started.id, ...newest.slice().reverse().map(thread => thread.id)]
    expect(state.projectPaths.value).toEqual(['/projects/new30', '/projects/newest29'])
    expect(state.projectThreads.value.map(thread => thread.id)).toEqual(advancedIds)
    expect(state.threads.value.map(thread => thread.id)).toEqual(advancedIds)
    expect(state.threadCursor.value).toBeNull()
    expect(listRequests()).toEqual(initialLists)
  })
})

async function seedMessages(running = false) {
  store.get('a')!.turns = [
    { id: 't1', status: 'completed', items: [{ id: 'u1', type: 'userMessage', content: [{ type: 'text', text: 'Original first' }] }, { id: 'a1', type: 'agentMessage', text: 'First reply' }] },
    { id: 't2', status: running ? 'inProgress' : 'completed', items: [{ id: 'u2', type: 'userMessage', content: [{ type: 'text', text: 'Original second' }] }, { id: 'a2', type: 'agentMessage', text: 'Second reply' }] },
  ]
  await state.openThread('a'); await settle()
}
describe('message revisions use durable server history', () => {
  test('withdraws one turn while retaining earlier conversation', async () => {
    await seedMessages()
    const result = await state.withdrawMessage('u2')
    expect(result.ok).toBe(true); expect(store.get('a')!.turns.map(turn => turn.id)).toEqual(['t1'])
    expect(state.items.value.map(item => item.id)).toEqual(['u1', 'a1'])
    expect(requests.find(request => request.method === 'thread/revert')?.params).toEqual({ threadId: 'a', beforeTurnId: 't2' })
    expect(state.revising.value).toBe(false)
  })
  test('edits an earlier turn by reverting before it and sending revised content', async () => {
    await seedMessages()
    const result = await state.editMessage('u1', [{ type: 'text', text: 'Edited first' }])
    expect(result.ok).toBe(true)
    expect(store.get('a')!.turns).toHaveLength(1)
    expect(state.items.value.find(item => item.type === 'userMessage')?.content?.map(part => typeof part === 'string' ? part : part.text)).toEqual(['Edited first'])
    expect(requests.findLast(request => request.method === 'turn/start')?.params.input).toEqual([{ type: 'text', text: 'Edited first', text_elements: [] }])
    expect(requests.findIndex(request => request.method === 'thread/revert')).toBeLessThan(requests.findIndex(request => request.method === 'turn/start'))
    expect(state.queuePaused.value).toBe(false)
  })
  test('does not hide messages when the server cannot revert', async () => {
    await seedMessages(); revertFailure = true
    const result = await state.withdrawMessage('u2')
    expect(result).toMatchObject({ ok: false, reverted: false }); expect(result.error).toContain('不支持')
    expect(state.items.value.map(item => item.id)).toEqual(['u1', 'a1', 'u2', 'a2'])
    expect(store.get('a')!.turns).toHaveLength(2)
  })
  test('stops a running turn before reverting and preserves the paused queue', async () => {
    await seedMessages(true)
    await state.send([{ type: 'text', text: 'Queued after original' }])
    const result = await state.withdrawMessage('u2')
    expect(result.ok).toBe(true)
    expect(requests.findIndex(request => request.method === 'turn/interrupt')).toBeLessThan(requests.findIndex(request => request.method === 'thread/revert'))
    expect(state.currentQueue.value).toHaveLength(1); expect(state.queuePaused.value).toBe(true)
    expect(requests.filter(request => request.method === 'turn/start')).toHaveLength(0)
  })
  test('does not erase earlier input when a turn contains multiple user messages', async () => {
    await seedMessages()
    store.get('a')!.turns[1].items.push({ id: 'steered', type: 'userMessage', content: [{ type: 'text', text: 'Follow-up within this turn' }] })
    await state.openThread('a')
    const result = await state.withdrawMessage('steered')
    expect(result.ok).toBe(false); expect(result.error).toContain('首条消息')
    expect(requests.filter(request => request.method === 'thread/revert')).toHaveLength(0)
  })
  test('reports a committed revert separately when resending fails', async () => {
    await seedMessages(); sendFailure = true
    const result = await state.editMessage('u2', [{ type: 'text', text: 'Keep this edited draft' }])
    expect(result).toMatchObject({ ok: false, reverted: true })
    expect(result.error).toContain('Send failed'); expect(state.revising.value).toBe(false)
    expect(store.get('a')!.turns.map(turn => turn.id)).toEqual(['t1'])
  })
})

describe('native queues through the real RPC pipeline without network ports', () => {
  beforeEach(async () => {
    nativeQueueEnabled = true
    state.profiles.value = [primaryDevice]
    // Reconnect after the outer legacy setup so capability is probed afresh.
    await state.connect(primaryDevice, true)
    await eventually(() => state.serverQueueSupported.value, 'native queue capability should be detected')
  })
  function startRemoteTurn() {
    const turn: Turn = { id: 'remote-running', status: 'inProgress', items: [] }
    store.get('a')!.turns.push(turn); store.get('a')!.status = { type: 'active' }
    socket.emit('turn/started', { threadId: 'a', turn })
    expect(state.busy.value).toBe(true)
    return turn
  }
  const texts = () => state.currentQueue.value.map(job => promptText(job.parts))
  const controls = () => ({ model: state.model.value, effort: state.effort.value, permission: state.permission.value })

  test.each(['thread/resume', 'thread/items/list'] as const)('settings notifications received during %s survive the older open snapshot without echo writes', async heldMethod => {
    const old = { model: 'old-model', effort: 'high', approvalPolicy: 'never', approvalsReviewer: 'user', sandboxPolicy: { type: 'dangerFullAccess' } }
    nativeServer().settings.set('a', old)
    let release: (() => void) | undefined
    archiveTransport = (method, params, reply) => {
      if (method !== heldMethod || params.threadId !== 'a') return false
      release = () => reply(method === 'thread/resume' ? { thread: { ...store.get('a')!, turns: [] }, model: old.model, reasoningEffort: old.effort, approvalPolicy: old.approvalPolicy, approvalsReviewer: old.approvalsReviewer, sandbox: old.sandboxPolicy } : { data: [], nextCursor: null })
      return true
    }
    const mark = requests.length, opening = state.openThread('a')
    await eventually(() => !!release, 'the older open snapshot should be held')
    const fresh = { model: 'notification-model', effort: 'low', approvalPolicy: 'on-request', approvalsReviewer: 'user', sandboxPolicy: { type: 'readOnly', networkAccess: false } }
    nativeServer().settings.set('a', fresh)
    socket.emit('thread/settings/updated', { threadId: 'a', threadSettings: fresh })
    release!(); await opening
    expect(controls()).toEqual({ model: 'notification-model', effort: 'low', permission: 'readOnly' })
    await Bun.sleep(150)
    expect(requests.slice(mark).some(request => request.method === 'thread/settings/update')).toBe(false)
  })

  test('a settings ack received during resume protects the confirmed edit after its pending write is cleared', async () => {
    holdSettings = true
    state.model.value = 'acknowledged-model'; state.effort.value = 'high'; state.permission.value = 'readOnly'
    await Bun.sleep(150); await eventually(() => !!releaseSettings, 'the edit should await its ack')
    let releaseResume!: () => void
    archiveTransport = (method, _params, reply) => {
      if (method !== 'thread/resume') return false
      releaseResume = () => reply({ thread: { ...store.get('a')!, turns: [] }, model: 'stale-model', reasoningEffort: 'low', approvalPolicy: 'never', sandbox: { type: 'dangerFullAccess' } }); return true
    }
    const opening = state.openThread('a')
    holdSettings = false; releaseSettings!(); await settle()
    releaseResume(); await opening
    expect(controls()).toEqual({ model: 'acknowledged-model', effort: 'high', permission: 'readOnly' })
    expect(nativeServer().settings.get('a')?.model).toBe('acknowledged-model')
  })

  test.each(['debounced', 'failed', 'legacy'] as const)('reopening preserves legitimate %s settings edits until a successful submission', async mode => {
    if (mode === 'legacy') { nativeQueueEnabled = false; await state.connect(primaryDevice, true); await settle() }
    if (mode === 'failed') nativeFailure = { method: 'thread/settings/update', code: -32603, message: 'Settings write rejected' }
    const mark = requests.length
    state.model.value = 'draft-model'; state.effort.value = 'high'; state.permission.value = 'readOnly'
    if (mode === 'failed') { await Bun.sleep(150); await settle(); expect(state.error.value).toContain('Settings write rejected') }
    await state.openThread('b'); await state.openThread('a')
    expect(controls()).toEqual({ model: 'draft-model', effort: 'high', permission: 'readOnly' })
    if (mode === 'legacy') expect(requests.slice(mark).some(request => request.method === 'thread/settings/update')).toBe(false)
    nativeFailure = undefined
    expect(await state.send([{ type: 'text', text: 'Commit the selected settings' }])).toBe(true)
    nativeServer().settings.set('a', { model: 'server-after-send', effort: 'low', approvalPolicy: 'never', sandboxPolicy: { type: 'dangerFullAccess' } })
    nativeQueueEnabled = true
    await state.openThread('a')
    expect(controls()).toEqual({ model: 'server-after-send', effort: 'low', permission: 'full' })
    await Bun.sleep(150); await settle()
    expect(nativeServer().settings.get('a')?.model).toBe('server-after-send')
    expect(controls()).toEqual({ model: 'server-after-send', effort: 'low', permission: 'full' })
  })

  test.each(['missing', 'null'] as const)('resume preserves missing legacy fields but treats %s effort distinctly', async effortValue => {
    const known = { model: 'known-model', effort: 'high', approvalPolicy: 'on-request', approvalsReviewer: 'user', sandboxPolicy: { type: 'readOnly', networkAccess: false } }
    socket.emit('thread/settings/updated', { threadId: 'a', threadSettings: known })
    archiveTransport = (method, _params, reply) => {
      if (method !== 'thread/resume') return false
      reply({ thread: { ...store.get('a')!, turns: [] }, ...(effortValue === 'null' ? { reasoningEffort: null } : {}) }); return true
    }
    await state.openThread('a')
    expect(controls()).toEqual({ model: 'known-model', effort: effortValue === 'null' ? '' : 'high', permission: 'readOnly' })
  })

  test('legacy pagination fallback restores settings from its newer full resume response', async () => {
    archiveTransport = (method, params, reply, fail) => {
      if (method === 'thread/items/list') { fail(-32601, 'Pagination unavailable'); return true }
      if (method !== 'thread/resume') return false
      reply({ thread: { ...store.get('a')!, turns: [] }, model: params.excludeTurns ? 'first-snapshot' : 'legacy-current', reasoningEffort: 'low', approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: { type: 'readOnly', networkAccess: false } }); return true
    }
    await state.openThread('a')
    expect(controls()).toEqual({ model: 'legacy-current', effort: 'low', permission: 'readOnly' })
    expect(state.threadLoadError.value).toBe('')
  })

  test.each(['reopen', 'reconnect'] as const)('%s replaces acknowledged cached settings with current server settings and uses them for the next queue add', async action => {
    state.model.value = 'previous-model'; state.effort.value = 'high'; state.permission.value = 'full'
    await Bun.sleep(150); await settle()
    expect(nativeServer().settings.get('a')?.model).toBe('previous-model')
    const current = { model: 'remote-model', effort: 'low', approvalPolicy: 'on-request', approvalsReviewer: 'user', sandboxPolicy: { type: 'readOnly', networkAccess: false } }
    nativeServer().settings.set('a', current)
    if (action === 'reconnect') await state.connect(primaryDevice, true)
    else { await state.openThread('b'); await state.openThread('a') }
    expect(controls()).toEqual({ model: 'remote-model', effort: 'low', permission: 'readOnly' })
    startRemoteTurn()
    expect(await state.send([{ type: 'text', text: 'Use current server settings' }])).toBe(true)
    expect(nativeServer().settings.get('a')).toEqual(current)
  })

  test('opening a thread fetches pending submissions owned by the server', async () => {
    pendingOnServer('b').push(remoteSubmission('from-cli', 'Queued from the CLI'), remoteSubmission('from-phone', 'Queued from another browser'))
    expect(state.currentQueue.value).toHaveLength(0)
    await state.openThread('b')
    await eventually(() => state.currentQueue.value.length === 2, 'opening should load the shared queue')
    expect(texts()).toEqual(['Queued from the CLI', 'Queued from another browser'])
    expect(state.currentQueue.value).toMatchObject([
      { id: 'from-cli', deviceId: 'device', threadId: 'b', source: 'server', state: 'queued' },
      { id: 'from-phone', deviceId: 'device', threadId: 'b', source: 'server', state: 'queued' },
    ])
    expect(requests.findLast(request => request.method === 'thread/queue/list')?.params).toEqual({ threadId: 'b', limit: 100, cursor: null })
    expect(requests.filter(request => request.method === 'turn/start')).toHaveLength(0)
  })

  test('busy send adds a native submission and never dispatches it from the browser', async () => {
    const turn = startRemoteTurn()
    expect(await state.send([{ type: 'text', text: 'Native follow-up' }])).toBe(true)
    expect(texts()).toEqual(['Native follow-up'])
    expect(state.currentQueue.value[0]).toMatchObject({ source: 'server', state: 'queued', deviceId: 'device', threadId: 'a' })
    const add = requests.filter(request => request.method === 'thread/queue/add')
    expect(add).toHaveLength(1)
    expect(add[0]!.params).toEqual({ threadId: 'a', input: [{ type: 'text', text: 'Native follow-up', text_elements: [] }], clientUserMessageId: expect.any(String) })
    expect(add[0]!.params.clientUserMessageId).not.toBe('')
    expect(pendingOnServer()[0]!.clientUserMessageId).toBe(add[0]!.params.clientUserMessageId)
    turn.status = 'completed'; store.get('a')!.status = { type: 'idle' }
    socket.emit('turn/completed', { threadId: 'a', turn }); await settle()
    state.resumeQueue(); await settle()
    expect(texts()).toEqual(['Native follow-up'])
    expect(requests.filter(request => request.method === 'turn/start' || request.method === 'turn/steer')).toHaveLength(0)
    pendingOnServer().splice(0)
    socket.emit('thread/queue/changed', { threadId: 'a' })
    await eventually(() => state.currentQueue.value.length === 0, 'server consumption should clear the browser snapshot')
    expect(requests.filter(request => request.method === 'turn/start')).toHaveLength(0)
  })

  test('queue change events reload remote additions, edits and deletions without local mutations', async () => {
    const mark = requests.length, queue = pendingOnServer()
    queue.push(remoteSubmission('remote-1', 'Remote original'))
    socket.emit('thread/queue/changed', { threadId: 'a' })
    await eventually(() => texts()[0] === 'Remote original', 'remote addition should become visible')
    queue[0] = remoteSubmission('remote-1', 'Remote edited'); queue.push(remoteSubmission('remote-2', 'Remote second'))
    socket.emit('thread/queue/changed', { threadId: 'a' })
    await eventually(() => texts().join('|') === 'Remote edited|Remote second', 'remote changes should replace the previous snapshot')
    queue.splice(0, 1)
    socket.emit('thread/queue/changed', { threadId: 'a' })
    await eventually(() => texts().join('|') === 'Remote second', 'remote deletion should remove the corresponding row')
    queue.splice(0)
    socket.emit('thread/queue/changed', { threadId: 'a' })
    await eventually(() => state.currentQueue.value.length === 0, 'an empty server snapshot should clear the queue')
    expect(requests.slice(mark).filter(request => request.method === 'thread/queue/list').length).toBeGreaterThanOrEqual(4)
    expect(requests.slice(mark).filter(request => ['thread/queue/add', 'thread/queue/update', 'thread/queue/delete', 'turn/start'].includes(request.method))).toHaveLength(0)
  })

  test('editing and deleting native rows use queue RPCs and server IDs', async () => {
    pendingOnServer().push(remoteSubmission('native-id', 'Before edit'))
    socket.emit('thread/queue/changed', { threadId: 'a' })
    await eventually(() => state.currentQueue.value.length === 1, 'the native row should load before editing')
    expect(await state.updateQueued('native-id', [{ type: 'text', text: 'After edit' }])).toBe(true)
    expect(texts()).toEqual(['After edit'])
    expect(pendingOnServer()).toEqual([remoteSubmission('native-id', 'After edit')])
    expect(requests.findLast(request => request.method === 'thread/queue/update')?.params).toEqual({ threadId: 'a', queuedSubmissionId: 'native-id', input: [{ type: 'text', text: 'After edit', text_elements: [] }] })
    await state.removeQueued('native-id')
    expect(state.currentQueue.value).toHaveLength(0); expect(pendingOnServer()).toHaveLength(0)
    expect(requests.findLast(request => request.method === 'thread/queue/delete')?.params).toEqual({ threadId: 'a', queuedSubmissionId: 'native-id' })
    expect(requests.filter(request => request.method === 'turn/start')).toHaveLength(0)
  })

  test('a fresh browser runtime restores the queue without any browser storage', async () => {
    startRemoteTurn()
    expect(await state.send([{ type: 'text', text: 'Survives page refresh' }])).toBe(true)
    const id = state.currentQueue.value[0]!.id
    app.unmount(); localStorage.clear(); mountRuntime()
    expect(state.queuedMessages.value).toHaveLength(0)
    expect(pendingOnServer()[0]!.id).toBe(id)
    await state.connect(primaryDevice); await state.openThread('a')
    await eventually(() => state.currentQueue.value.length === 1, 'the new runtime should restore the native submission')
    expect(texts()).toEqual(['Survives page refresh'])
    expect(state.currentQueue.value[0]).toMatchObject({ id, source: 'server' })
    expect(requests.filter(request => request.method === 'thread/queue/add')).toHaveLength(1)
    expect(requests.filter(request => request.method === 'turn/start')).toHaveLength(0)
  })

  test('an automatic reconnect restores changes made while the browser was disconnected', async () => {
    pendingOnServer().push(remoteSubmission('remote-pending', 'Before disconnect'))
    socket.emit('thread/queue/changed', { threadId: 'a' })
    await eventually(() => texts()[0] === 'Before disconnect', 'the original queue should load')
    const previousSocket = socket, mark = requests.length
    previousSocket.close()
    expect(state.status.value).toBe('reconnecting')
    nativeServer().queues.set('a', [remoteSubmission('remote-replacement', 'Changed while offline')])
    await Bun.sleep(1300)
    await eventually(() => state.connected.value && texts()[0] === 'Changed while offline', 'reconnect should fetch the latest shared queue')
    expect(socket).not.toBe(previousSocket)
    expect(state.currentQueue.value[0]).toMatchObject({ id: 'remote-replacement', source: 'server' })
    expect(requests.slice(mark).some(request => request.method === 'thread/queue/list')).toBe(true)
    expect(requests.slice(mark).filter(request => request.method === 'thread/queue/add' || request.method === 'turn/start')).toHaveLength(0)
  })

  test('identical thread and queue IDs remain isolated by device', async () => {
    const other: ConnectionProfile = { ...primaryDevice, id: 'other-device', name: 'Other device', endpoint: 'ws://other-memory.test' }
    pendingOnServer().push(remoteSubmission('same-id', 'Primary device queue'))
    pendingOnServer('a', other.endpoint).push(remoteSubmission('same-id', 'Other device queue'))
    socket.emit('thread/queue/changed', { threadId: 'a' })
    await eventually(() => texts()[0] === 'Primary device queue', 'the primary queue should load')
    const previousSocket = socket
    await state.connect(other); await state.openThread('a')
    await eventually(() => texts()[0] === 'Other device queue', 'switching devices should fetch only that device queue')
    expect(state.currentQueue.value).toHaveLength(1)
    expect(state.currentQueue.value[0]).toMatchObject({ id: 'same-id', deviceId: 'other-device', source: 'server' })
    // Simulate an already-delivered callback from the disposed connection.
    previousSocket.onmessage?.({ data: JSON.stringify({ method: 'thread/queue/changed', params: { threadId: 'a' } }) })
    await settle()
    expect(texts()).toEqual(['Other device queue'])
    await state.removeQueued('same-id')
    expect(pendingOnServer('a', other.endpoint)).toHaveLength(0)
    expect(pendingOnServer()).toEqual([remoteSubmission('same-id', 'Primary device queue')])
    expect(requests.findLast(request => request.method === 'thread/queue/delete')?.endpoint).toBe(other.endpoint)
    await state.connect(primaryDevice); await state.openThread('a')
    await eventually(() => texts()[0] === 'Primary device queue', 'returning should restore the original device queue')
    expect(state.currentQueue.value[0]!.deviceId).toBe('device')
  })

  test('settings must be acknowledged before native add uses the current composer controls', async () => {
    startRemoteTurn()
    const mark = requests.length
    state.model.value = 'm'; state.effort.value = 'high'; state.permission.value = 'readOnly'
    holdSettings = true
    const sending = state.send([{ type: 'text', text: 'Use the updated controls' }])
    try {
      await eventually(() => !!releaseSettings, 'settings update should wait for a server acknowledgment')
      expect(requests.slice(mark).filter(request => request.method === 'thread/queue/add')).toHaveLength(0)
      expect(pendingOnServer()).toHaveLength(0)
    } finally { holdSettings = false; releaseSettings?.() }
    expect(await sending).toBe(true)
    const calls = requests.slice(mark), settingsIndex = calls.findIndex(request => request.method === 'thread/settings/update')
    expect(calls.findIndex(request => request.method === 'thread/queue/list')).toBeLessThan(settingsIndex)
    expect(settingsIndex).toBeLessThan(calls.findIndex(request => request.method === 'thread/queue/add'))
    expect(calls[settingsIndex]!.params).toEqual({ threadId: 'a', model: 'm', effort: 'high', approvalPolicy: 'on-request', approvalsReviewer: 'user', sandboxPolicy: { type: 'readOnly', networkAccess: false } })
    expect(nativeServer().settings.get('a')).toEqual({ model: 'm', effort: 'high', approvalPolicy: 'on-request', approvalsReviewer: 'user', sandboxPolicy: { type: 'readOnly', networkAccess: false } })
    expect(texts()).toEqual(['Use the updated controls'])
  })

  test('tightening full access during queue/list never overwrites readonly before native add', async () => {
    startRemoteTurn()
    const mark = requests.length
    state.permission.value = 'full'
    holdQueueList = true
    let completed = false
    const sending = state.send([{ type: 'text', text: 'Keep tightened permissions after listing' }]).then(result => { completed = true; return result })
    try {
      await eventually(() => !!releaseQueueList, 'send should be waiting for the native queue snapshot')
      expect(requests.slice(mark).filter(request => request.method === 'thread/settings/update')).toHaveLength(0)
      state.permission.value = 'readOnly'
      // Let the normal settings debounce persist the tightened policy while list is still blocked.
      await Bun.sleep(150)
      await eventually(() => nativeServer().settings.get('a')?.sandboxPolicy?.type === 'readOnly', 'readonly should be acknowledged before the pending list completes')
      expect(completed).toBe(false)
      expect(requests.slice(mark).filter(request => request.method === 'thread/queue/add')).toHaveLength(0)
      expect(pendingOnServer()).toHaveLength(0)
      holdQueueList = false; releaseQueueList?.()
      expect(await sending).toBe(true)
      // Include any remaining debounced writes, not just the immediate send result.
      await Bun.sleep(150)
      const calls = requests.slice(mark), addIndex = calls.findIndex(request => request.method === 'thread/queue/add')
      expect(addIndex).toBeGreaterThan(0)
      const settingsBeforeAdd = calls.slice(0, addIndex).filter(request => request.method === 'thread/settings/update')
      expect(settingsBeforeAdd.length).toBeGreaterThan(0)
      expect(settingsBeforeAdd.at(-1)!.params).toMatchObject({ threadId: 'a', approvalPolicy: 'on-request', approvalsReviewer: 'user', sandboxPolicy: { type: 'readOnly', networkAccess: false } })
      for (const write of calls.filter(request => request.method === 'thread/settings/update')) {
        expect(write.params).toMatchObject({ approvalPolicy: 'on-request', sandboxPolicy: { type: 'readOnly', networkAccess: false } })
      }
      expect(nativeServer().settings.get('a')).toMatchObject({ approvalPolicy: 'on-request', sandboxPolicy: { type: 'readOnly', networkAccess: false } })
      expect(state.permission.value).toBe('readOnly')
      expect(texts()).toEqual(['Keep tightened permissions after listing'])
      expect(calls.filter(request => request.method === 'thread/queue/add')).toHaveLength(1)
      expect(calls.filter(request => request.method === 'turn/start')).toHaveLength(0)
    } finally { holdQueueList = false; releaseQueueList?.(); await sending }
  })

  test('tightening full access during settings ack waits for a readonly ack before native add', async () => {
    startRemoteTurn()
    const mark = requests.length
    state.permission.value = 'full'
    holdSettings = true
    let completed = false
    const sending = state.send([{ type: 'text', text: 'Wait for the tightened policy acknowledgment' }]).then(result => { completed = true; return result })
    try {
      await eventually(() => !!releaseSettings, 'the full-access settings request should be waiting for its ack')
      const fullAck = releaseSettings!
      expect(requests.slice(mark).filter(request => request.method === 'thread/settings/update').map(request => request.params.sandboxPolicy.type)).toEqual(['dangerFullAccess'])
      expect(requests.slice(mark).filter(request => request.method === 'thread/queue/add')).toHaveLength(0)
      state.permission.value = 'readOnly'
      fullAck()
      await eventually(() => !!releaseSettings || requests.slice(mark).some(request => request.method === 'thread/queue/add'), 'send should issue a follow-up settings write after the stale ack')
      expect(requests.slice(mark).filter(request => request.method === 'thread/queue/add')).toHaveLength(0)
      expect(completed).toBe(false)
      expect(pendingOnServer()).toHaveLength(0)
      expect(releaseSettings).toBeDefined()
      expect(releaseSettings).not.toBe(fullAck)
      const writes = requests.slice(mark).filter(request => request.method === 'thread/settings/update')
      expect(writes.map(request => request.params.sandboxPolicy.type)).toEqual(['dangerFullAccess', 'readOnly'])
      expect(writes.at(-1)!.params).toMatchObject({ threadId: 'a', approvalPolicy: 'on-request', approvalsReviewer: 'user', sandboxPolicy: { type: 'readOnly', networkAccess: false } })
      // Only the earlier full-access request has been acknowledged so far.
      expect(nativeServer().settings.get('a')?.sandboxPolicy).toEqual({ type: 'dangerFullAccess' })
      releaseSettings!()
      expect(await sending).toBe(true)
      await Bun.sleep(150)
      const calls = requests.slice(mark), addIndex = calls.findIndex(request => request.method === 'thread/queue/add')
      expect(addIndex).toBeGreaterThan(calls.findIndex(request => request.method === 'thread/settings/update' && request.params.sandboxPolicy.type === 'readOnly'))
      expect(calls.filter(request => request.method === 'thread/settings/update').map(request => request.params.sandboxPolicy.type)).toEqual(['dangerFullAccess', 'readOnly'])
      expect(nativeServer().settings.get('a')).toMatchObject({ approvalPolicy: 'on-request', sandboxPolicy: { type: 'readOnly', networkAccess: false } })
      expect(state.permission.value).toBe('readOnly')
      expect(texts()).toEqual(['Wait for the tightened policy acknowledgment'])
      expect(calls.filter(request => request.method === 'thread/queue/add')).toHaveLength(1)
      expect(calls.filter(request => request.method === 'turn/start')).toHaveLength(0)
    } finally { holdSettings = false; releaseSettings?.(); await sending }
  })

  test('external settings events restore active controls without echoing a write and remember inactive threads', async () => {
    const mark = requests.length
    const remote = { model: 'remote-model', effort: 'high', approvalPolicy: 'on-request', approvalsReviewer: 'auto_review', sandboxPolicy: { type: 'workspaceWrite', networkAccess: false, writableRoots: [] } }
    nativeServer().settings.set('a', remote)
    socket.emit('thread/settings/updated', { threadId: 'a', threadSettings: remote })
    await settle()
    expect({ model: state.model.value, effort: state.effort.value, permission: state.permission.value }).toEqual({ model: 'remote-model', effort: 'high', permission: 'auto' })
    const inactive = { model: 'other-model', effort: 'low', approvalPolicy: 'on-request', approvalsReviewer: 'user', sandboxPolicy: { type: 'readOnly', networkAccess: false } }
    nativeServer().settings.set('b', inactive)
    socket.emit('thread/settings/updated', { threadId: 'b', threadSettings: inactive })
    expect(state.model.value).toBe('remote-model')
    await state.openThread('b'); await settle()
    expect({ model: state.model.value, effort: state.effort.value, permission: state.permission.value }).toEqual({ model: 'other-model', effort: 'low', permission: 'readOnly' })
    await Bun.sleep(150)
    expect(requests.slice(mark).filter(request => request.method === 'thread/settings/update')).toHaveLength(0)
  })

  for (const action of ['edit', 'withdraw'] as const) {
    test(`${action} refreshes server pending work and refuses revision before thread/revert`, async () => {
      await seedMessages(true)
      expect(state.currentQueue.value).toHaveLength(0)
      pendingOnServer().push(remoteSubmission('newly-queued', 'Added on another device before revision'))
      const mark = requests.length, before = structuredClone(store.get('a')!.turns)
      const result = action === 'edit' ? await state.editMessage('u2', [{ type: 'text', text: 'Replacement' }]) : await state.withdrawMessage('u2')
      expect(result).toMatchObject({ ok: false, reverted: false })
      expect(result.error).toContain('服务端待发送消息')
      expect(store.get('a')!.turns).toEqual(before)
      expect(state.items.value.map(item => item.id)).toEqual(['u1', 'a1', 'u2', 'a2'])
      expect(state.revising.value).toBe(false)
      expect(texts()).toEqual(['Added on another device before revision'])
      expect(requests.slice(mark).some(request => request.method === 'thread/queue/list')).toBe(true)
      expect(requests.slice(mark).filter(request => ['thread/revert', 'turn/interrupt', 'turn/start', 'thread/queue/delete'].includes(request.method))).toHaveLength(0)
    })
  }

  for (const method of ['thread/queue/list', 'thread/settings/update', 'thread/queue/add']) {
    test(`${method} failures do not silently fall back to a browser-local queue`, async () => {
      startRemoteTurn()
      nativeFailure = { method, code: -32603, message: 'Transient native queue failure' }
      const mark = requests.length
      expect(await state.send([{ type: 'text', text: 'Must stay on server' }])).toBe(false)
      expect(state.currentQueue.value).toHaveLength(0); expect(pendingOnServer()).toHaveLength(0)
      expect(state.error.value).toContain('Transient native queue failure')
      expect(requests.slice(mark).filter(request => request.method === 'turn/start')).toHaveLength(0)
      expect(requests.slice(mark).filter(request => request.method === 'thread/queue/add')).toHaveLength(method === 'thread/queue/add' ? 1 : 0)
      nativeFailure = undefined
      expect(await state.send([{ type: 'text', text: 'Explicit retry' }])).toBe(true)
      expect(texts()).toEqual(['Explicit retry'])
      expect(state.currentQueue.value[0]!.source).toBe('server')
    })
  }
})

function goalFixture(threadId = 'a', patch: Partial<ThreadGoal> = {}): ThreadGoal {
  return { threadId, objective: 'Finish the task', status: 'active', tokenBudget: 10000, tokensUsed: 120, timeUsedSeconds: 45, createdAt: 1, updatedAt: 2, ...patch }
}

describe('thread goals through the real RPC pipeline', () => {
  beforeEach(() => { nativeQueueEnabled = true })
  const goalCalls = () => requests.filter(request => request.method.startsWith('thread/goal/'))
  const publish = (goal: ThreadGoal) => socket.emit('thread/goal/updated', { threadId: goal.threadId, turnId: null, goal })

  test('unknown capability is null; opening reads without setting or blocking the thread', async () => {
    await state.connect(primaryDevice)
    expect(state.goalSupported.value).toBeNull()
    let release: (() => void) | undefined
    archiveTransport = (method, p, reply) => {
      if (method !== 'thread/goal/get') return false
      release = () => reply({ goal: goalFixture(p.threadId) }); return true
    }
    await state.openThread('a')
    expect(state.loadingThread.value).toBe(false)
    expect(state.active.value?.id).toBe('a')
    expect(state.goalLoading.value).toBe(true)
    expect(state.goal.value).toBeNull()
    release!(); await settle()
    expect(state.goal.value).toEqual(goalFixture())
    expect(state.goalSupported.value).toBe(true)
    expect(goalCalls().every(call => call.method === 'thread/goal/get')).toBe(true)
  })

  test.each(['updated', 'cleared'] as const)('%s notification wins over a pending old get snapshot', async event => {
    publish(goalFixture())
    let release: (() => void) | undefined
    archiveTransport = (method, _p, reply) => {
      if (method !== 'thread/goal/get') return false
      release = () => reply({ goal: goalFixture() }); return true
    }
    const refresh = state.refreshGoal()
    if (event === 'updated') publish(goalFixture('a', { tokensUsed: 700, timeUsedSeconds: 90, status: 'budgetLimited' }))
    else socket.emit('thread/goal/cleared', { threadId: 'a' })
    release!(); expect(await refresh).toBe(true)
    expect(state.goal.value).toEqual(event === 'updated' ? goalFixture('a', { tokensUsed: 700, timeUsedSeconds: 90, status: 'budgetLimited' }) : null)
    expect(state.goalLoading.value).toBe(false)
  })

  test('newest get request wins even if the older response arrives last', async () => {
    const releases: ((result: unknown) => void)[] = []
    archiveTransport = (method, _p, reply) => { if (method !== 'thread/goal/get') return false; releases.push(reply); return true }
    const first = state.refreshGoal(), second = state.refreshGoal()
    releases[1]!({ goal: goalFixture('a', { objective: 'Latest' }) }); await second
    releases[0]!({ goal: null }); await first
    expect(state.goal.value?.objective).toBe('Latest')
  })

  test('notification during resume survives an older goal read and binds only to active', async () => {
    let release: (() => void) | undefined
    archiveTransport = (method, p, reply) => {
      if (method !== 'thread/goal/get') return false
      release = () => reply({ goal: null }); return true
    }
    const opening = state.openThread('b')
    publish(goalFixture('b', { objective: 'B goal' }))
    await opening; release!(); await settle()
    expect(state.goal.value?.objective).toBe('B goal')
    publish(goalFixture('a', { objective: 'Inactive A' }))
    expect(state.goal.value?.threadId).toBe('b')
    state.newThread()
    expect(state.goal.value).toBeNull()
  })

  test.each([
    [-32601, 'Method not found'],
    [-32600, 'goals feature is disabled']
  ])('unsupported get %s reports a goal error and does not break conversation loading', async (code, message) => {
    archiveTransport = (method, _p, _reply, fail) => {
      if (method !== 'thread/goal/get') return false
      fail(Number(code), String(message)); return true
    }
    await state.openThread('a'); await settle()
    expect(state.active.value?.id).toBe('a')
    expect(state.threadLoadError.value).toBe('')
    expect(state.error.value).toBe('')
    expect(state.goalSupported.value).toBe(false)
    expect(state.goalError.value).toContain('不支持')
    const mark = requests.length
    expect(await state.setGoal({ objective: 'Keep this draft' })).toBe(false)
    expect(await state.clearGoal()).toBe(false)
    expect(requests.slice(mark)).toHaveLength(0)
    expect(state.goal.value).toBeNull()
  })

  test('disabled config marks capability false before creating a new goal', async () => {
    archiveTransport = (method, _p, reply) => {
      if (method !== 'config/read') return false
      reply({ config: { features: { goals: false } } }); return true
    }
    await state.connect(primaryDevice); await settle()
    expect(state.goalSupported.value).toBe(false)
    const mark = requests.length
    expect(await state.setGoal({ objective: 'A goal' })).toBe(false)
    expect(requests.slice(mark)).toHaveLength(0)
  })

  test('explicit refresh retries a goal capability after it is enabled on the server', async () => {
    archiveTransport = (method, _p, _reply, fail) => {
      if (method !== 'thread/goal/get') return false
      fail(-32600, 'goals feature is disabled'); return true
    }
    await state.openThread('a'); await settle()
    expect(state.goalSupported.value).toBe(false)
    archiveTransport = undefined
    nativeServer().goals.set('a', goalFixture())
    expect(await state.refreshGoal()).toBe(true)
    expect(state.goalSupported.value).toBe(true)
    expect(state.goal.value).toEqual(goalFixture())
    expect(state.goalError.value).toBe('')
  })

  test('transient and malformed reads preserve the confirmed goal and support state', async () => {
    publish(goalFixture())
    for (const response of ['failure', {}, { goal: goalFixture('wrong-thread') }, { goal: goalFixture('a', { tokensUsed: -1 }) }]) {
      archiveTransport = (method, _p, reply, fail) => {
        if (method !== 'thread/goal/get') return false
        if (response === 'failure') fail(-32603, 'temporary failure'); else reply(response)
        return true
      }
      expect(await state.refreshGoal()).toBe(false)
      expect(state.goal.value).toEqual(goalFixture())
      expect(state.goalSupported.value).toBe(true)
      expect(state.goalError.value).not.toBe('')
    }
  })

  test('new goal starts a thread with settings and waits for their ack, without turn/start or double clicks', async () => {
    state.newThread(); state.workingDirectory.value = '/goal project'
    state.model.value = 'custom-model'; state.effort.value = 'high'; state.permission.value = 'readOnly'
    let releaseStart: (() => void) | undefined
    archiveTransport = (method, p, reply) => {
      if (method !== 'thread/start') return false
      releaseStart = () => reply({ thread: { ...store.get('a')!, id: 'created', cwd: p.cwd, turns: [] } }); return true
    }
    holdSettings = true
    const mark = requests.length, saving = state.setGoal({ objective: 'Goal first', tokenBudget: 4321 })
    expect(state.goalSaving.value).toBe(true)
    expect(await state.setGoal({ objective: 'Duplicate' })).toBe(false)
    expect(await state.send([{ type: 'text', text: 'Do not create a second thread' }])).toBe(false)
    expect(state.goal.value).toBeNull()
    releaseStart!()
    await eventually(() => !!releaseSettings, 'goal must await settings')
    expect(state.active.value?.id).toBe('created')
    expect(state.goalSaving.value).toBe(true)
    expect(await state.setGoal({ objective: 'Duplicate after active changed' })).toBe(false)
    expect(requests.slice(mark).some(call => call.method === 'thread/goal/set')).toBe(false)
    releaseSettings!(); expect(await saving).toBe(true)
    const calls = requests.slice(mark)
    expect(calls.map(call => call.method)).toEqual(['thread/start', 'thread/settings/update', 'thread/goal/set'])
    expect(calls[0]!.params).toMatchObject({ cwd: '/goal project', model: 'custom-model', config: { model_reasoning_effort: 'high' }, approvalPolicy: 'on-request', sandbox: 'read-only' })
    expect(calls[1]!.params).toMatchObject({ cwd: '/goal project', model: 'custom-model', effort: 'high', sandboxPolicy: { type: 'readOnly' } })
    expect(calls[2]!.params).toEqual({ threadId: 'created', objective: 'Goal first', tokenBudget: 4321 })
    expect(state.goal.value).toMatchObject({ threadId: 'created', objective: 'Goal first', tokenBudget: 4321 })
    expect(state.goalSaving.value).toBe(false)
    expect(state.threads.value.some(thread => thread.id === 'created')).toBe(true)
    expect(state.projectThreads.value.some(thread => thread.id === 'created')).toBe(true)
    socket.emit('thread/goal/updated', { threadId: 'created', turnId: null, goal: goalFixture('created', { objective: 'Goal first', tokensUsed: 500 }) })
    expect(state.goal.value?.tokensUsed).toBe(500)
  })

  test('permission changes during settings ack must be acknowledged before goal/set', async () => {
    state.permission.value = 'full'; holdSettings = true
    const mark = requests.length, saving = state.setGoal({ objective: 'Apply current permission' })
    await eventually(() => !!releaseSettings, 'first settings request')
    state.permission.value = 'readOnly'; state.effort.value = 'high'
    releaseSettings!()
    await eventually(() => !!releaseSettings, 'second settings request')
    expect(requests.slice(mark).some(call => call.method === 'thread/goal/set')).toBe(false)
    releaseSettings!(); expect(await saving).toBe(true)
    const calls = requests.slice(mark)
    expect(calls.filter(call => call.method === 'thread/settings/update').map(call => call.params.sandboxPolicy.type)).toEqual(['dangerFullAccess', 'readOnly'])
    expect(calls.at(-1)?.method).toBe('thread/goal/set')
    expect(calls.some(call => call.method === 'turn/start')).toBe(false)
  })

  test('settings failure prevents automatic execution and does not downgrade goal support', async () => {
    nativeFailure = { method: 'thread/settings/update', code: -32601, message: 'Method not found' }
    const mark = requests.length
    expect(await state.setGoal({ objective: 'Do not run under old permissions' })).toBe(false)
    expect(state.goalSupported.value).toBe(true)
    expect(state.goalError.value).toContain('无法确认设置')
    expect(state.goal.value).toBeNull()
    expect(requests.slice(mark).some(call => ['thread/goal/set', 'turn/start'].includes(call.method))).toBe(false)
  })

  test.each(['set', 'clear'] as const)('unsupported %s returns false without changing confirmed goal data', async method => {
    publish(goalFixture())
    archiveTransport = (rpcMethod, _p, _reply, fail) => { if (rpcMethod !== 'thread/goal/' + method) return false; fail(-32601, 'Method not found'); return true }
    const result = method === 'set' ? await state.setGoal({ status: 'paused' }) : await state.clearGoal()
    expect(result).toBe(false)
    expect(state.goal.value).toEqual(goalFixture())
    expect(state.goalSupported.value).toBe(false)
    expect(state.goalError.value).toContain('不支持')
    expect(state.goalSaving.value).toBe(false)
  })

  test('unconfirmed goal writes are never fabricated or retried', async () => {
    const realTimeout = globalThis.setTimeout
    installGlobal('setTimeout', (callback: TimerHandler, ms?: number, ...args: unknown[]) => realTimeout(callback, ms === 10_000 ? 1 : ms, ...args))
    archiveTransport = method => method === 'thread/goal/set'
    const mark = requests.length
    expect(await state.setGoal({ objective: 'Keep the draft on timeout' })).toBe(false)
    expect(state.goal.value).toBeNull()
    expect(state.goalError.value).toContain('请求超时')
    expect(state.goalSupported.value).toBe(true)
    expect(requests.slice(mark).filter(call => call.method === 'thread/goal/set')).toHaveLength(1)
    expect(requests.slice(mark).some(call => call.method === 'turn/start')).toBe(false)
  })

  test.each([
    'paused',
    'active',
    'complete'
  ] as const)('status %s is sent unchanged without synthetic turn input', async status => {
    publish(goalFixture())
    expect(await state.setGoal({ status })).toBe(true)
    expect(goalCalls().at(-1)?.params).toEqual({ threadId: 'a', status })
    expect(state.goal.value?.status).toBe(status)
    expect(requests.some(call => call.method === 'turn/start')).toBe(false)
  })

  test('pause and clear remain available when settings writes are unsupported', async () => {
    nativeQueueEnabled = false; publish(goalFixture())
    const mark = requests.length
    expect(await state.setGoal({ status: 'paused' })).toBe(true)
    expect(await state.clearGoal()).toBe(true)
    expect(requests.slice(mark).map(call => call.method)).toEqual(['thread/goal/set', 'thread/goal/clear'])
    expect(state.goal.value).toBeNull()
  })

  test.each(['set', 'clear'] as const)('newer notifications win over a late %s acknowledgment', async operation => {
    publish(goalFixture())
    let release: (() => void) | undefined
    archiveTransport = (method, _p, reply) => {
      if (method !== 'thread/goal/' + operation) return false
      release = () => reply(operation === 'set' ? { goal: goalFixture('a', { status: 'paused' }) } : { cleared: true }); return true
    }
    const saving = operation === 'set' ? state.setGoal({ status: 'paused' }) : state.clearGoal()
    await eventually(() => !!release, 'mutation dispatched')
    expect(state.goal.value).toEqual(goalFixture())
    publish(goalFixture('a', { objective: 'Changed on another client', tokensUsed: 800 }))
    release!(); expect(await saving).toBe(true)
    expect(state.goal.value?.objective).toBe('Changed on another client')
  })

  test('clear failures keep confirmed data; a false cleared response confirms absence', async () => {
    publish(goalFixture())
    archiveTransport = (method, _p, _reply, fail) => { if (method !== 'thread/goal/clear') return false; fail(-32603, 'clear failed'); return true }
    expect(await state.clearGoal()).toBe(false)
    expect(state.goal.value).toEqual(goalFixture())
    expect(state.goalError.value).toContain('clear failed')
    archiveTransport = undefined
    expect(await state.clearGoal()).toBe(true)
    expect(state.goal.value).toBeNull()
  })

  test.each(['read', 'write'] as const)('device switch isolates a pending %s and disposed socket notifications', async operation => {
    publish(goalFixture())
    const oldCallback = socket.onmessage!
    let release: (() => void) | undefined
    archiveTransport = (method, _p, reply) => {
      if (method !== 'thread/goal/' + (operation === 'read' ? 'get' : 'set')) return false
      release = () => reply({ goal: goalFixture('a', { objective: 'Old device' }) }); return true
    }
    const pending = operation === 'read' ? state.refreshGoal() : state.setGoal({ status: 'paused' })
    await eventually(() => !!release, 'pending old-device operation')
    archiveTransport = undefined
    const other = { ...primaryDevice, id: 'other', endpoint: 'ws://other.test' }
    nativeServer(other.endpoint).goals.set('a', goalFixture('a', { objective: 'Other device' }))
    await state.connect(other); await state.openThread('a'); await settle()
    release!(); expect(await pending).toBe(false)
    oldCallback({ data: JSON.stringify({ method: 'thread/goal/updated', params: { threadId: 'a', goal: goalFixture('a', { objective: 'Disposed callback' }) } }) })
    expect(state.goal.value?.objective).toBe('Other device')
    expect(state.goalSupported.value).toBe(true)
    expect(state.goalError.value).toBe('')
    expect(state.goalLoading.value).toBe(false)
    expect(state.goalSaving.value).toBe(false)
  })

  test.each(['thread/start', 'thread/settings/update'] as const)('switching thread while %s waits prevents goal dispatch', async heldMethod => {
    if (heldMethod === 'thread/start') { state.newThread(); state.permission.value = 'ask' }
    let release: (() => void) | undefined
    archiveTransport = (method, _p, reply) => {
      if (method !== heldMethod) return false
      release = () => reply(heldMethod === 'thread/start' ? { thread: { ...store.get('a')!, id: 'unused-created' } } : {}); return true
    }
    const mark = requests.length, saving = state.setGoal({ objective: 'Do not run after navigation' })
    await eventually(() => !!release, 'held request')
    await state.openThread('b'); release!()
    expect(await saving).toBe(false)
    expect(state.active.value?.id).toBe('b')
    expect(state.goalError.value).toBe('')
    expect(requests.slice(mark).some(call => call.method === 'thread/goal/set')).toBe(false)
  })

  test('late mutation ack updates only its own thread and returns false after navigation', async () => {
    let release: (() => void) | undefined
    archiveTransport = (method, _p, reply) => { if (method !== 'thread/goal/set') return false; release = () => reply({ goal: goalFixture() }); return true }
    const saving = state.setGoal({ status: 'paused' })
    await state.openThread('b'); release!()
    expect(await saving).toBe(false)
    expect(state.active.value?.id).toBe('b')
    expect(state.goal.value).toBeNull()
  })
})

describe('file search scoped to the current remote directory', () => {
  test('skills/list uses the selected directory and preserves native skill metadata', async () => {
    archiveTransport = (method, p, reply) => { if (method !== 'skills/list') return false; reply({ data: [{ cwd: p.cwds[0], skills: [{ name: 'audit', description: 'Inspect', path: '/skills/audit/SKILL.md', scope: 'user', enabled: true }], errors: [] }] }); return true }
    const catalog = await state.listSkills({ forceReload: true })
    expect(catalog.skills[0]?.path).toBe('/skills/audit/SKILL.md')
    expect(requests.findLast(request => request.method === 'skills/list')?.params).toEqual({ cwds: ['/projects/a'], forceReload: true })
    await state.send([{ type: 'skill', id: 'chosen', name: 'audit', path: '/skills/audit/SKILL.md' }])
    expect(requests.findLast(request => request.method === 'turn/start')?.params.input).toEqual([{ type: 'text', text: '$audit', text_elements: [{ byteRange: { start: 0, end: 6 }, placeholder: 'audit' }] }, { type: 'skill', name: 'audit', path: '/skills/audit/SKILL.md' }])
  })
  test('late skill results cannot overwrite a newer conversation', async () => {
    let release: (() => void) | undefined
    archiveTransport = (method, p, reply) => { if (method !== 'skills/list') return false; release = () => reply({ data: [{ cwd: p.cwds[0], skills: [], errors: [] }] }); return true }
    const loading = state.listSkills().catch(error => error as Error)
    await eventually(() => !!release, 'skill request pending')
    await state.openThread('b'); release!()
    expect(await loading).toBeInstanceOf(Error)
    const before = state.skillsRevision.value
    socket.emit('skills/changed', {}); expect(state.skillsRevision.value).toBe(before + 1)
  })
  const file = (patch: Record<string, unknown> = {}) => ({ root: '/projects/a', path: 'src/my file.ts', match_type: 'file', file_name: 'my file.ts', score: 10, indices: [0, 2], ...patch })
  test('uses only active cwd and UUID cancellation token, returning at most 50 validated results', async () => {
    archiveTransport = (method, _p, reply) => { if (method !== 'fuzzyFileSearch') return false; reply({ files: Array.from({ length: 70 }, () => file()) }); return true }
    expect(await state.searchFiles('src')).toHaveLength(50)
    expect(requests.at(-1)?.params).toMatchObject({ query: 'src', roots: ['/projects/a'], cancellationToken: expect.stringMatching(/^[0-9a-f-]{36}$/) })
    expect(state.error.value).toBe('')
  })
  test('new conversations use the current working directory and reject missing directories', async () => {
    state.newThread(); state.workingDirectory.value = '/selected on device'
    archiveTransport = (method, _p, reply) => { if (method !== 'fuzzyFileSearch') return false; reply({ files: [file({ root: '/selected on device' })] }); return true }
    expect(await state.searchFiles('src')).toHaveLength(1)
    expect(requests.at(-1)?.params.roots).toEqual(['/selected on device'])
    state.workingDirectory.value = ''
    const mark = requests.length
    await expect(state.searchFiles('src')).rejects.toThrow('工作目录')
    expect(requests.slice(mark)).toHaveLength(0)
  })
  test.each([
    { root: '/another device' },
    { path: '../secret' },
    { path: 'a\\..\\secret' },
    { indices: [-1] }
  ])('rejects invalid or escaped results %j', async patch => {
    archiveTransport = (method, _p, reply) => { if (method !== 'fuzzyFileSearch') return false; reply({ files: [file(patch)] }); return true }
    await expect(state.searchFiles('src')).rejects.toThrow('响应无效')
  })
  test.each(['abort', 'device', 'thread', 'cwd'] as const)('%s prevents publishing stale file results', async action => {
    let release: (() => void) | undefined
    archiveTransport = (method, _p, reply) => { if (method !== 'fuzzyFileSearch') return false; release = () => reply({ files: [file()] }); return true }
    const controller = new AbortController()
    const result = state.searchFiles('src', { signal: controller.signal }).then(value => value, error => error)
    if (action === 'abort') controller.abort()
    if (action === 'device') await state.connect({ ...primaryDevice, id: 'other', endpoint: 'ws://other.test' })
    if (action === 'thread') await state.openThread('b')
    if (action === 'cwd') state.active.value!.cwd = '/changed'
    release!()
    expect((await result).name).toBe('AbortError')
    expect(state.error.value).toBe('')
  })
  test('search timeout is eight seconds and never retries', async () => {
    const realTimeout = globalThis.setTimeout
    let timeout: number | undefined
    installGlobal('setTimeout', (callback: TimerHandler, ms?: number, ...args: unknown[]) => { if (ms === 8000) timeout = ms; return realTimeout(callback, ms === 8000 ? 1 : ms, ...args) })
    archiveTransport = method => method === 'fuzzyFileSearch'
    const mark = requests.length
    await expect(state.searchFiles('src')).rejects.toThrow('请求超时')
    expect(timeout).toBe(8000)
    expect(requests.slice(mark).filter(call => call.method === 'fuzzyFileSearch')).toHaveLength(1)
  })
})

describe('queue dispatch parity with installed Codex', () => {
  const starts = () => requests.filter(request => request.method === 'turn/start')
  async function queuedPair() {
    await state.send([{ type: 'text', text: 'running' }])
    const turn = state.activeTurn.value!
    await state.send([{ type: 'text', text: 'next' }])
    await state.send([{ type: 'text', text: 'last' }])
    return turn
  }

  test('an ordinary failed turn advances exactly one queued message, like TUI on_error', async () => {
    const turn = await queuedPair()
    socket.emit('error', { threadId: 'a', turnId: turn.id, willRetry: false, error: { message: 'Server failure', codexErrorInfo: 'internalServerError' } })
    socket.emit('turn/completed', { threadId: 'a', turn: { ...turn, status: 'failed' } })
    await eventually(() => starts().length === 2 && state.currentQueue.value.length === 1, 'failed turn should dispatch just the first queued input')
    expect(starts()[1]!.params.input[0].text).toBe('next')
    expect(promptText(state.currentQueue.value[0]!.parts)).toBe('last')
    expect(state.queuePaused.value).toBe(false)
  })

  test('an interrupt retains the queue across idle notifications until explicit resume', async () => {
    const turn = await queuedPair()
    socket.emit('turn/completed', { threadId: 'a', turn: { ...turn, status: 'interrupted' } })
    socket.emit('thread/status/changed', { threadId: 'a', status: { type: 'idle' } })
    await settle()
    expect(starts()).toHaveLength(1)
    expect(state.currentQueue.value).toHaveLength(2)
    expect(state.queuePaused.value).toBe(true)
    await state.resumeQueue()
    await eventually(() => starts().length === 2 && state.currentQueue.value.length === 1, 'resume should consume one queue entry')
    expect(requests.some(request => request.method === 'turn/steer')).toBe(false)
  })

  test('retry, tool completion, and user-input boundaries do not drain an active ordinary queue', async () => {
    const turn = await queuedPair()
    socket.emit('error', { threadId: 'a', turnId: turn.id, willRetry: true, error: { message: 'Retrying' } })
    socket.emit('item/completed', { threadId: 'a', turnId: turn.id, item: { id: 'cmd', type: 'commandExecution', status: 'completed' } })
    socket.emit('item/completed', { threadId: 'a', turnId: turn.id, item: { id: 'steered-elsewhere', type: 'userMessage', content: [{ type: 'text', text: 'remote steer' }] } })
    socket.emit('thread/status/changed', { threadId: 'a', status: { type: 'idle' } })
    await settle()
    expect(starts()).toHaveLength(1)
    expect(state.currentQueue.value).toHaveLength(2)
    expect(requests.some(request => request.method === 'turn/steer')).toBe(false)
  })

  test('manual pause survives an ordinary failed turn', async () => {
    const turn = await queuedPair()
    state.pauseQueue()
    socket.emit('turn/completed', { threadId: 'a', turn: { ...turn, status: 'failed' } }); await settle()
    expect(starts()).toHaveLength(1)
    expect(state.queuePaused.value).toBe(true)
  })

  test('a completion before turn/start acknowledgement cannot strand a queued follow-up', async () => {
    let release: (() => void) | undefined
    const turn: Turn = { id: 'fast-turn', status: 'inProgress', items: [] }
    archiveTransport = (method, params, reply) => {
      if (method !== 'turn/start' || release) return false
      store.get('a')!.turns.push(turn)
      release = () => reply({ turn })
      return true
    }
    const first = state.send([{ type: 'text', text: 'first' }])
    await eventually(() => !!release, 'first start ack should be held')
    await state.send([{ type: 'text', text: 'queued while start pending' }])
    socket.emit('turn/started', { threadId: 'a', turn })
    socket.emit('turn/completed', { threadId: 'a', turn: { ...turn, status: 'completed' } })
    await settle(); expect(starts()).toHaveLength(1)
    release!(); expect(await first).toBe(true)
    await eventually(() => starts().length === 2 && state.currentQueue.value.length === 0, 'ack should release the pending-start guard and drain')
    expect(starts()[1]!.params.input[0].text).toBe('queued while start pending')
  })

  test('a late completion of the previous turn cannot release a newer background turn', async () => {
    const first = await queuedPair()
    socket.emit('turn/completed', { threadId: 'a', turn: { ...first, status: 'completed' } })
    await eventually(() => starts().length === 2 && state.currentQueue.value.length === 1, 'the first follow-up should run')
    const second = state.activeTurn.value!
    await state.openThread('b')
    socket.emit('turn/completed', { threadId: 'a', turn: { ...first, status: 'failed' } }); await settle()
    expect(starts()).toHaveLength(2)
    expect(state.threads.value.find(thread => thread.id === 'a')?.status?.type).toBe('active')
    socket.emit('turn/completed', { threadId: 'a', turn: { ...second, status: 'completed' } })
    await eventually(() => starts().length === 3, 'only the current background turn completion may drain')
    expect(starts()[2]!.params.input[0].text).toBe('last')
  })

  test('an unacknowledged start holds queued work instead of inferring an idle turn', async () => {
    let reject: (() => void) | undefined
    archiveTransport = (method, _params, _reply, fail) => {
      if (method !== 'turn/start') return false
      reject = () => fail(-32603, 'start could not be confirmed'); return true
    }
    const first = state.send([{ type: 'text', text: 'first' }])
    await eventually(() => !!reject, 'first start should be held')
    await state.send([{ type: 'text', text: 'queued while awaiting ack' }])
    reject!(); expect(await first).toBe(false)
    socket.emit('thread/status/changed', { threadId: 'a', status: { type: 'idle' } }); await settle()
    expect(starts()).toHaveLength(1)
    expect(state.queuePaused.value).toBe(true)
    expect(state.currentQueue.value).toHaveLength(1)
  })

  test('server active status prevents dispatch before turn metadata arrives', async () => {
    socket.emit('thread/status/changed', { threadId: 'a', status: { type: 'active' } })
    expect(state.busy.value).toBe(true)
    await state.send([{ type: 'text', text: 'waiting for idle' }]); await settle()
    expect(starts()).toHaveLength(0)
    expect(state.currentQueue.value).toHaveLength(1)
    socket.emit('thread/status/changed', { threadId: 'a', status: { type: 'idle' } })
    await eventually(() => starts().length === 1, 'authoritative idle can release a queue with no pending turn')
  })

  test('a reconnect clears the previous pending-start guard for explicit queue recovery', async () => {
    let held = false
    archiveTransport = method => { if (method !== 'turn/start') return false; held = true; return true }
    const pending = state.send([{ type: 'text', text: 'start awaiting ack' }])
    await eventually(() => held, 'the start should be pending')
    await state.send([{ type: 'text', text: 'recover this queued input' }])
    socket.close(); await pending
    archiveTransport = undefined
    await state.connect(primaryDevice, true)
    expect(state.queuePaused.value).toBe(true)
    await state.resumeQueue()
    await eventually(() => starts().length === 2 && state.currentQueue.value.length === 0, 'explicit recovery must not retain the old connection pending-start guard')
    expect(starts()[1]!.params.input[0].text).toBe('recover this queued input')
  })

  test('a replayed start after completion cannot resurrect a terminal turn', async () => {
    const first = await queuedPair()
    socket.emit('turn/completed', { threadId: 'a', turn: { ...first, status: 'completed' } })
    await eventually(() => starts().length === 2 && state.currentQueue.value.length === 1, 'next turn should be running')
    const second = state.activeTurn.value!
    socket.emit('turn/started', { threadId: 'a', turn: first })
    expect(state.active.value!.turns.find(turn => turn.id === first.id)?.status).toBe('completed')
    expect(state.activeTurn.value?.id).toBe(second.id)
    socket.emit('turn/completed', { threadId: 'a', turn: { ...second, status: 'completed' } })
    await eventually(() => starts().length === 3, 'the next completion should still dispatch normally')
  })

  test.each([
    'completed',
    'interrupted'
  ])('native %s lifecycle never invokes browser dispatch', async status => {
    nativeQueueEnabled = true
    await state.connect(primaryDevice, true)
    await eventually(() => state.serverQueueSupported.value, 'native queue should be supported')
    const turn: Turn = { id: 'native-turn', status: 'inProgress', items: [] }
    socket.emit('turn/started', { threadId: 'a', turn })
    await state.send([{ type: 'text', text: 'server owns dispatch' }])
    const mark = requests.length
    socket.emit('turn/completed', { threadId: 'a', turn: { ...turn, status } })
    socket.emit('thread/status/changed', { threadId: 'a', status: { type: 'idle' } })
    socket.emit('thread/queue/changed', { threadId: 'a' }); await settle()
    expect(requests.slice(mark).filter(request => ['thread/queue/start', 'turn/start', 'turn/steer'].includes(request.method))).toHaveLength(0)
    expect(state.currentQueue.value).toHaveLength(1)
  })

  test('native explicit resume consumes only the server-selected item', async () => {
    nativeQueueEnabled = true
    await state.connect(primaryDevice, true)
    pendingOnServer().push(remoteSubmission('one', 'one'), remoteSubmission('two', 'two'))
    socket.emit('thread/queue/changed', { threadId: 'a' })
    await eventually(() => state.currentQueue.value.length === 2, 'shared queue should load')
    const turn: Turn = { id: 'manual-native', status: 'inProgress', items: [] }
    archiveTransport = (method, params, reply) => {
      if (method !== 'thread/queue/start') return false
      pendingOnServer(params.threadId).shift()
      socket.emit('turn/started', { threadId: params.threadId, turn })
      reply({ turn }); return true
    }
    await state.resumeQueue(); await settle()
    expect(state.currentQueue.value.map(job => job.id)).toEqual(['two'])
    expect(state.activeTurn.value?.id).toBe(turn.id)
    expect(requests.filter(request => request.method === 'thread/queue/start')).toHaveLength(1)
    await state.resumeQueue()
    expect(requests.filter(request => request.method === 'thread/queue/start')).toHaveLength(1)
    expect(starts()).toHaveLength(0)
  })
})

describe('workspace commands and native turn patches', () => {
  test('command/exec uses the current connection, forwards cancellation and can read during a turn', async () => {
    await state.send([{ type: 'text', text: 'busy' }])
    const response = { exitCode: 0, stdout: 'diff', stderr: '' }
    archiveTransport = (method, _params, reply) => { if (method !== 'command/exec') return false; reply(response); return true }
    const params = { command: ['git', 'diff'], cwd: '/work', timeoutMs: 1000 }
    expect(await state.runWorkspaceCommand<typeof response>(params)).toEqual(response)
    expect(requests.at(-1)).toMatchObject({ method: 'command/exec', params, endpoint: primaryDevice.endpoint })
    const controller = new AbortController(); controller.abort()
    const count = requests.length
    await expect(state.runWorkspaceCommand(params, { signal: controller.signal })).rejects.toBeInstanceOf(DOMException)
    expect(requests).toHaveLength(count)
  })

  test('a command cancelled by a connection switch is never replayed on the next device', async () => {
    archiveTransport = method => method === 'command/exec'
    const command = state.runWorkspaceCommand({ command: ['git', 'status'], cwd: '/work' }).catch(error => error)
    await settle()
    await state.connect({ ...primaryDevice, id: 'second', endpoint: 'ws://second.test' })
    expect(await command).toBeInstanceOf(Error)
    expect(requests.filter(request => request.method === 'command/exec').map(request => request.endpoint)).toEqual([primaryDevice.endpoint])
    state.disconnect()
    await expect(state.runWorkspaceCommand({ command: ['git', 'diff'] })).rejects.toThrow('请先连接设备')
  })

  test('native patches replace snapshots and follow device, thread and latest turn identity', async () => {
    await state.send([{ type: 'text', text: 'make a change' }])
    const first = state.active.value!.turns.at(-1)!
    store.get('a')!.turns.at(-1)!.status = 'completed'
    socket.emit('turn/completed', { threadId: 'a', turn: { ...first, status: 'completed' } })
    const diff = (threadId: string, turnId: string, value: unknown) => socket.emit('turn/diff/updated', { threadId, turnId, diff: value })
    diff('a', first.id, 'first patch'); expect(state.currentTurnDiff.value).toBe('first patch')
    diff('a', first.id, 'replacement'); expect(state.currentTurnDiff.value).toBe('replacement')
    diff('a', first.id, null); expect(state.currentTurnDiff.value).toBe('replacement')
    await state.connect(primaryDevice, true); expect(state.currentTurnDiff.value).toBe('')
    diff('a', first.id, 'replacement')
    await state.openThread('b'); expect(state.currentTurnDiff.value).toBe('')
    diff('a', first.id, 'background patch')
    await state.openThread('a'); expect(state.currentTurnDiff.value).toBe('background patch')
    const second: Turn = { id: 'next', status: 'inProgress', items: [] }
    socket.emit('turn/started', { threadId: 'a', turn: second }); expect(state.currentTurnDiff.value).toBe('')
    diff('a', first.id, 'late previous patch'); expect(state.currentTurnDiff.value).toBe('')
    diff('a', second.id, 'new patch'); expect(state.currentTurnDiff.value).toBe('new patch')
    diff('a', second.id, ''); expect(state.currentTurnDiff.value).toBe('')
    diff('a', second.id, 'new patch')
    const oldSocket = socket
    await state.connect({ ...primaryDevice, id: 'second', endpoint: 'ws://second.test' }); await state.openThread('a')
    oldSocket.onmessage?.({ data: JSON.stringify({ method: 'turn/diff/updated', params: { threadId: 'a', turnId: first.id, diff: 'wrong device' } }) })
    expect(state.currentTurnDiff.value).toBe('')
  })
})

describe('explicit steer versus queued input', () => {
  test('shows an optimistic steer before acknowledgement and keeps it until its own user item arrives', async () => {
    const turn = await running()
    let release: (() => void) | undefined
    archiveTransport = (method, _params, reply) => { if (method !== 'turn/steer') return false; release = () => reply({ turnId: turn.id }); return true }
    // Deliberately repeat the previous user text: replaying old history must not
    // consume the new optimistic message just because the content is identical.
    const repeated = [{ type: 'text' as const, text: 'original task' }]
    const sent = state.steer(repeated)
    expect(state.items.value.filter(item => item.type === 'userMessage')).toHaveLength(1)
    expect(state.pendingSteers.value).toHaveLength(1)
    await eventually(() => !!release, 'steer ack pending')
    release!(); expect(await sent).toBe(true)
    expect(state.items.value.filter(item => item.type === 'userMessage')).toHaveLength(1)
    expect(state.pendingSteers.value).toHaveLength(1)
    socket.emit('turn/started', { threadId: 'a', turn }); await settle()
    expect(state.items.value.filter(item => item.type === 'userMessage')).toHaveLength(1)
    expect(state.pendingSteers.value).toHaveLength(1)
    const item: Item = { id: 'accepted-steer', type: 'userMessage', content: [{ type: 'text', text: 'original task', text_elements: [] }] }
    socket.emit('item/started', { threadId: 'a', turnId: turn.id, item }); await settle()
    expect(state.items.value.filter(item => item.type === 'userMessage')).toHaveLength(2)
    expect(state.pendingSteers.value).toHaveLength(0)
    expect(state.items.value.some(item => item.id.startsWith('pending-'))).toBe(false)
    expect(state.currentQueue.value).toHaveLength(0)
  })
  test('rejected steer removes its temporary message and reports failure', async () => {
    await running()
    archiveTransport = (method, _params, _reply, fail) => { if (method !== 'turn/steer') return false; fail(-32602, 'steer denied'); return true }
    const notices: string[] = []; const off = state.onTaskNotice(notice => { notices.push(notice.kind) })
    expect(await state.steer(parts)).toBe(false)
    expect(state.items.value.filter(item => item.type === 'userMessage')).toHaveLength(1)
    expect(state.currentTurnFailure.value).toContain('steer denied')
    expect(notices).toEqual(['failed']); off()
  })
  test('matches native steer clientId even when the server normalizes attachment content', async () => {
    const turn = await running()
    archiveTransport = (method, p, reply) => { if (method !== 'turn/steer') return false; reply({ turnId: p.expectedTurnId }); return true }
    expect(await state.steer([{ type: 'image', id: 'picture', name: '图片.png', size: 4, url: 'data:image/png;base64,abcd' }])).toBe(true)
    expect(state.pendingSteers.value).toHaveLength(1)
    const request = requests.findLast(request => request.method === 'turn/steer')!
    const item: Item = { id: 'normalized-image', clientId: request.params.clientUserMessageId, type: 'userMessage', content: [{ type: 'localImage', path: '/device/image.png' }] }
    socket.emit('item/started', { threadId: 'a', turnId: turn.id, item }); await settle()
    expect(state.pendingSteers.value).toHaveLength(0)
    expect(state.items.value.filter(item => item.type === 'userMessage')).toHaveLength(2)
  })
  test('background acceptance clears its island placeholder before revisiting the thread', async () => {
    const turn = await running()
    archiveTransport = (method, p, reply) => { if (method !== 'turn/steer') return false; reply({ turnId: p.expectedTurnId }); return true }
    await state.steer(parts)
    const request = requests.findLast(request => request.method === 'turn/steer')!
    await state.openThread('b')
    const item: Item = { id: 'background-steer', clientId: request.params.clientUserMessageId, type: 'userMessage', content: request.params.input }
    store.get('a')!.turns[0]!.items.push(item)
    socket.emit('item/started', { threadId: 'a', turnId: turn.id, item })
    await state.openThread('a')
    expect(state.pendingSteers.value).toHaveLength(0)
    expect(state.items.value.filter(item => item.type === 'userMessage')).toHaveLength(2)
  })
  test('withdraws an unsent steer while settings are still being acknowledged', async () => {
    await running(true)
    holdSettings = true; state.permission.value = 'readOnly'
    const pending = state.steer(parts)
    await eventually(() => !!releaseSettings, 'settings should still be pending')
    const local = state.pendingSteers.value[0]!
    expect(local.cancelable).toBe(true)
    expect(state.withdrawPendingSteer(local.id)).toBe(true)
    expect(state.pendingSteers.value).toHaveLength(0)
    releaseSettings!(); expect(await pending).toBe(false)
    expect(requests.some(call => call.method === 'turn/steer')).toBe(false)
    expect(state.activeTurn.value).toBeDefined()
  })
  test('never pretends an already accepted steer was cancelled', async () => {
    await running()
    archiveTransport = (method, params, reply) => { if (method !== 'turn/steer') return false; reply({ turnId: params.expectedTurnId }); return true }
    expect(await state.steer(parts)).toBe(true)
    const local = state.pendingSteers.value[0]!
    expect(local.cancelable).toBe(false)
    expect(state.withdrawPendingSteer(local.id)).toBe(false)
    expect(state.pendingSteers.value).toHaveLength(1)
    expect(requests.some(call => call.method === 'turn/interrupt')).toBe(false)
  })
  test.each(['interrupted', 'completed', 'failed'])('recovers an unobserved steer after its turn is %s without resending', async status => {
    const turn = await running()
    archiveTransport = (method, params, reply) => { if (method !== 'turn/steer') return false; reply({ turnId: params.expectedTurnId }); return true }
    expect(await state.steer(parts)).toBe(true)
    const pending = state.pendingSteers.value[0]!, mark = requests.length
    socket.emit('turn/completed', { threadId: 'a', turn: { ...turn, status, items: [] } }); await settle()
    expect(state.pendingSteers.value[0]).toMatchObject({ ended: true, cancelable: true })
    expect(state.activeTurn.value).toBeUndefined(); expect(state.busy.value).toBe(false)
    if (status === 'interrupted') expect(state.withdrawPendingSteer(pending.id)).toBe(true)
    else expect(state.takePendingSteer(pending.id)).toEqual(parts)
    expect(state.pendingSteers.value).toHaveLength(0)
    expect(requests.slice(mark).some(call => ['turn/start', 'turn/steer', 'turn/interrupt', 'thread/revert'].includes(call.method))).toBe(false)
  })
  test('a terminal event before the steer acknowledgement stays recoverable, including late echoes', async () => {
    const turn = await running()
    let ack: (() => void) | undefined
    archiveTransport = (method, params, reply) => { if (method !== 'turn/steer') return false; ack = () => reply({ turnId: params.expectedTurnId }); return true }
    const sending = state.steer(parts); await eventually(() => !!ack, 'steer should await ack')
    socket.emit('turn/completed', { threadId: 'a', turn: { ...turn, status: 'interrupted', items: [] } }); await settle()
    ack!(); expect(await sending).toBe(true)
    expect(state.pendingSteers.value[0]).toMatchObject({ ended: true, cancelable: true, accepted: true })
    const call = requests.findLast(call => call.method === 'turn/steer')!
    socket.emit('item/completed', { threadId: 'a', turnId: turn.id, item: { id: 'late-steer', clientId: call.params.clientUserMessageId, type: 'userMessage', content: call.params.input } }); await settle()
    expect(state.pendingSteers.value).toHaveLength(0)
    expect(state.items.value.filter(item => item.id === 'late-steer')).toHaveLength(1)
    expect(state.busy.value).toBe(false)
  })
  test('only the owning turn ends a pending steer; terminal snapshots also reconcile native user input', async () => {
    const turn = await running()
    archiveTransport = (method, params, reply) => { if (method !== 'turn/steer') return false; reply({ turnId: params.expectedTurnId }); return true }
    await state.steer(parts)
    socket.emit('turn/completed', { threadId: 'a', turn: { id: 'older-turn', status: 'interrupted', items: [] } }); await settle()
    expect(state.pendingSteers.value[0]).toMatchObject({ ended: false, cancelable: false })
    const call = requests.findLast(call => call.method === 'turn/steer')!
    socket.emit('turn/completed', { threadId: 'a', turn: { ...turn, status: 'completed', items: [{ id: 'snapshot-steer', clientId: call.params.clientUserMessageId, type: 'userMessage', content: call.params.input }] } }); await settle()
    expect(state.pendingSteers.value).toHaveLength(0)
    expect(state.items.value.some(item => item.id === 'snapshot-steer')).toBe(true)
  })
  test('too many referenced threads are rejected before a steer request is emitted', async () => {
    await running()
    const mentions = Array.from({ length: 17 }, (_, i) => ({ type: 'mention' as const, id: String(i), kind: 'thread' as const, name: 'chat ' + i, path: 'thread://chat-' + i }))
    expect(await state.steer(mentions)).toBe(false)
    expect(state.steering.value).toBe(false); expect(state.pendingSteers.value).toHaveLength(0)
    expect(requests.some(call => call.method === 'turn/steer')).toBe(false)
    expect(state.currentTurnFailure.value).toContain('16')
  })
  test('invalid replacement references never interrupt or revert the original message', async () => {
    await running()
    const item = state.items.value.find(item => item.type === 'userMessage')!
    const mentions = Array.from({ length: 17 }, (_, i) => ({ type: 'mention' as const, id: String(i), kind: 'thread' as const, name: 'chat ' + i, path: 'thread://chat-' + i }))
    const mark = requests.length, result = await state.editMessage(item.id, mentions)
    expect(result.ok).toBe(false); expect(result.reverted).toBe(false)
    expect(result.error).toContain('16')
    expect(requests.slice(mark)).toHaveLength(0)
    expect(state.items.value.some(message => message.id === item.id)).toBe(true)
  })
  const parts = [{ type: 'text' as const, text: 'steer this turn' }]
  async function running(native = false) {
    if (native) { nativeQueueEnabled = true; await state.connect(primaryDevice, true); await eventually(() => state.serverQueueSupported.value, 'native capability should be ready') }
    await state.send([{ type: 'text', text: 'original task' }])
    return state.activeTurn.value!
  }
  test('steer targets only the running turn and Tab/send retains ordinary queue semantics', async () => {
    const turn = await running()
    archiveTransport = (method, params, reply) => { if (method !== 'turn/steer') return false; reply({ turnId: params.expectedTurnId }); return true }
    const mark = requests.length
    expect(await state.steer(parts)).toBe(true)
    const calls = requests.slice(mark)
    expect(calls.map(call => call.method)).toEqual(['turn/steer'])
    expect(calls[0]!.params).toEqual({ threadId: 'a', expectedTurnId: turn.id, input: [{ type: 'text', text: 'steer this turn', text_elements: [] }], clientUserMessageId: expect.any(String) })
    expect(state.currentQueue.value).toHaveLength(0)
    expect(await state.send(parts)).toBe(true)
    expect(state.currentQueue.value).toHaveLength(1)
    expect(requests.filter(call => call.method === 'turn/start')).toHaveLength(1)
  })
  test('steer cannot start an idle turn or duplicate an in-flight steer', async () => {
    expect(await state.steer(parts)).toBe(false)
    const turn = await running()
    let release: (() => void) | undefined
    archiveTransport = (method, _params, reply) => { if (method !== 'turn/steer') return false; release = () => reply({ turnId: turn.id }); return true }
    const first = state.steer(parts)
    await eventually(() => !!release, 'steer should be pending')
    expect(state.steering.value).toBe(true)
    expect(await state.steer(parts)).toBe(false)
    release!(); expect(await first).toBe(true)
    expect(state.steering.value).toBe(false)
    expect(requests.filter(call => call.method === 'turn/steer')).toHaveLength(1)
  })
  test('pending permissions are acknowledged before steer and absent from the steer payload', async () => {
    const turn = await running(true)
    state.permission.value = 'readOnly'; state.model.value = 'next-model'; state.effort.value = 'high'
    holdSettings = true
    archiveTransport = (method, _params, reply) => { if (method !== 'turn/steer') return false; reply({ turnId: turn.id }); return true }
    const mark = requests.length, pending = state.steer(parts)
    await eventually(() => !!releaseSettings, 'settings should be awaiting ack')
    expect(requests.slice(mark).some(call => call.method === 'turn/steer')).toBe(false)
    releaseSettings!(); expect(await pending).toBe(true)
    const calls = requests.slice(mark), steerCall = calls.find(call => call.method === 'turn/steer')!
    expect(calls.findIndex(call => call.method === 'thread/settings/update')).toBeLessThan(calls.indexOf(steerCall))
    expect(nativeServer().settings.get('a')?.sandboxPolicy.type).toBe('readOnly')
    expect(Object.keys(steerCall.params).sort()).toEqual(['clientUserMessageId', 'expectedTurnId', 'input', 'threadId'])
  })
  test.each(['review', 'compact'])('only structured non-steerable %s rejection falls back to native queue', async turnKind => {
    await running(true)
    const original = socket.send.bind(socket)
    socket.send = raw => {
      const request = JSON.parse(raw)
      if (request.method !== 'turn/steer') return original(raw)
      requests.push({ method: request.method, params: request.params, endpoint: socket.endpoint })
      queueMicrotask(() => socket.deliver({ id: request.id, error: { code: -32602, message: 'cannot steer', data: { message: 'cannot steer', codexErrorInfo: { activeTurnNotSteerable: { turnKind } }, additionalDetails: null } } }))
    }
    expect(await state.steer(parts)).toBe(true)
    expect(state.currentQueue.value).toHaveLength(1)
    expect(state.currentQueue.value[0]!.source).toBe('server')
    expect(requests.filter(call => call.method === 'turn/steer')).toHaveLength(1)
    expect(requests.filter(call => call.method === 'thread/queue/add')).toHaveLength(1)
    expect(requests.filter(call => call.method === 'turn/start')).toHaveLength(1)
  })
  test.each([
    'expected turn id mismatch'
  ])('unstructured rejection %s does not silently queue or retry', async message => {
    await running()
    archiveTransport = (method, _params, _reply, fail) => { if (method !== 'turn/steer') return false; fail(-32602, message); return true }
    const mark = requests.length
    expect(await state.steer(parts)).toBe(false)
    expect(requests.slice(mark).map(call => call.method)).toEqual(['turn/steer'])
    expect(state.currentQueue.value).toHaveLength(0)
    expect(state.currentTurnFailure.value).toBe(message)
    expect(state.error.value).toBe('')
  })
  test('a timeout is shown inline and never retried or added to the queue', async () => {
    await running()
    const original = RpcClient.prototype.request
    let steerCalls = 0
    const stub = spyOn(RpcClient.prototype, 'request').mockImplementation(function<T>(this: RpcClient, method: string, params?: unknown, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<T> {
      if (method === 'turn/steer') { steerCalls++; return Promise.reject(new RpcError('timeout')) }
      return original.call(this, method, params, options) as Promise<T>
    })
    try {
      expect(await state.steer(parts)).toBe(false)
      expect(steerCalls).toBe(1)
      expect(state.currentTurnFailure.value).toContain('尚未确认')
      expect(state.error.value).toBe('')
      expect(state.currentQueue.value).toHaveLength(0)
    } finally { stub.mockRestore() }
  })
  test('a connection switch discards pending steer results without replay', async () => {
    await running()
    archiveTransport = method => method === 'turn/steer'
    const pending = state.steer(parts); await settle()
    await state.connect({ ...primaryDevice, id: 'other-device', endpoint: 'ws://other.test' })
    expect(await pending).toBe(false)
    expect(state.currentTurnFailure.value).toBe('')
    expect(state.steering.value).toBe(false)
    expect(requests.filter(call => call.method === 'turn/steer').map(call => call.endpoint)).toEqual([primaryDevice.endpoint])
  })
  test('a turn completing during settings acknowledgement stops a stale steer', async () => {
    const turn = await running(true)
    holdSettings = true; state.permission.value = 'readOnly'
    const pending = state.steer(parts)
    await eventually(() => !!releaseSettings, 'hold settings ack')
    socket.emit('turn/completed', { threadId: 'a', turn: { ...turn, status: 'completed' } })
    releaseSettings!(); expect(await pending).toBe(false)
    expect(requests.some(call => call.method === 'turn/steer')).toBe(false)
    expect(state.currentTurnFailure.value).toContain('当前回合已变化')
  })
})

describe('turn failures stay with their conversation', () => {
  test('publishes actionable task events but never notifies on retry or manual interruption', async () => {
    const notices: { kind: string; threadId: string }[] = []
    const off = state.onTaskNotice(notice => { notices.push(notice) })
    const turn = await start()
    socket.deliver({ id: 99, method: 'item/tool/requestUserInput', params: { threadId: 'a', turnId: turn.id, itemId: 'question', questions: [] } })
    socket.emit('error', { threadId: 'a', turnId: turn.id, willRetry: true, error: { message: 'retry' } })
    expect(notices.map(notice => notice.kind)).toEqual(['attention'])
    socket.emit('turn/completed', { threadId: 'a', turn: { ...turn, status: 'interrupted' } })
    expect(notices.map(notice => notice.kind)).toEqual(['attention'])
    const second = await start()
    socket.emit('turn/completed', { threadId: 'a', turn: { ...second, status: 'completed' } })
    expect(notices.map(notice => notice.kind)).toEqual(['attention', 'completed'])
    off(); await state.openThread('b')
    expect(notices).toHaveLength(2)
  })
  async function start() { await state.send([{ type: 'text', text: 'task' }]); return state.activeTurn.value! }
  test.each(['usageLimitExceeded', { responseTooManyFailedAttempts: { httpStatusCode: 429 } }])('terminal quota/retry failure is inline: %p', async codexErrorInfo => {
    const turn = await start(), failure = { message: '429: retry limit exceeded', codexErrorInfo }
    socket.emit('error', { threadId: 'a', turnId: turn.id, error: failure, willRetry: true })
    expect(state.reconnectStatus.value).toBe(failure.message)
    expect(state.currentTurnFailure.value).toBe('')
    socket.emit('error', { threadId: 'a', turnId: turn.id, error: failure, willRetry: false })
    expect(state.reconnectStatus.value).toBe('')
    expect(state.currentTurnFailure.value).toBe(failure.message)
    expect(state.activeTurn.value?.error?.message).toBe(failure.message)
    socket.emit('turn/completed', { threadId: 'a', turn: { ...turn, status: 'failed', error: failure } })
    expect(state.error.value).toBe('')
    expect(state.currentTurnFailure.value).toBe(failure.message)
    expect(requests.some(call => call.method === 'turn/retry')).toBe(false)
  })
  test('completed failed turn restores the server error after reload and clears on the next turn', async () => {
    const turn = await start(), failure = { message: 'saved terminal failure' }
    Object.assign(store.get('a')!.turns.at(-1)!, { status: 'failed', error: failure })
    socket.emit('turn/completed', { threadId: 'a', turn: { ...turn, status: 'failed', error: failure } })
    expect(state.currentTurnFailure.value).toBe(failure.message)
    await state.connect(primaryDevice, true)
    expect(state.currentTurnFailure.value).toBe(failure.message)
    await state.send([{ type: 'text', text: 'continue' }])
    expect(state.currentTurnFailure.value).toBe('')
    socket.emit('error', { threadId: 'a', turnId: turn.id, error: { message: 'late old failure' }, willRetry: false })
    expect(state.currentTurnFailure.value).toBe('')
    expect(state.error.value).toBe('')
  })
  test('background and old-device failures never appear on another thread or device', async () => {
    const turn = await start()
    await state.openThread('b')
    socket.emit('error', { threadId: 'a', turnId: turn.id, error: { message: 'background failure' }, willRetry: false })
    expect(state.currentTurnFailure.value).toBe(''); expect(state.error.value).toBe('')
    await state.openThread('a'); expect(state.currentTurnFailure.value).toBe('background failure')
    const previous = socket
    await state.connect({ ...primaryDevice, id: 'other-device', endpoint: 'ws://other.test' }); await state.openThread('a')
    previous.onmessage?.({ data: JSON.stringify({ method: 'error', params: { threadId: 'a', turnId: turn.id, error: { message: 'wrong device' }, willRetry: false } }) })
    expect(state.currentTurnFailure.value).toBe(''); expect(state.error.value).toBe('')
  })
  test('a pre-ack send failure stays inline, retains the draft, and clears after accepted retry', async () => {
    sendFailure = true
    expect(await state.send([{ type: 'text', text: 'keep this draft' }])).toBe(false)
    expect(state.currentTurnFailure.value).toBe('Send failed'); expect(state.error.value).toBe('')
    await state.openThread('b'); expect(state.currentTurnFailure.value).toBe('')
    await state.openThread('a'); expect(state.currentTurnFailure.value).toBe('Send failed')
    sendFailure = false
    expect(await state.send([{ type: 'text', text: 'keep this draft' }])).toBe(true)
    expect(state.currentTurnFailure.value).toBe('')
  })
})

// Preserve completion timing separately from formatting permutations.
test('thinking time advances and stops on turn completion', async () => {
    const turn = beginReasoning(); await settle()
    const initial = state.thinkingElapsed.value
    expect(initial).toBeDefined()
    setSystemTime(Date.now() + 3500); await Bun.sleep(1100)
    expect(state.thinkingElapsed.value!).toBeGreaterThan(initial!)
    socket.emit('turn/completed', { threadId: 'a', turn: { ...turn, status: 'completed', items: [] } }); await settle()
    expect(state.thinkingElapsed.value).toBeUndefined()
    const item = state.items.value.find(item => item.id === 'thought')!
    expect(item.completedAtMs).toBeGreaterThan(item.startedAtMs!)
  })

describe('default directory preparation does not gate connectivity', () => {
  async function connectUnprepared() {
    const profile = { ...primaryDevice, cwd: '~/missing-default' }
    state.profiles.value = [profile]
    const start = requests.length
    await state.connect(profile); await settle()
    expect(state.connected.value).toBe(true)
    expect(requests.slice(start).some(request => request.method === 'command/exec' || request.method === 'fs/createDirectory')).toBe(false)
    return start
  }
  test('connects and opens existing history before creating a missing default on the first new task', async () => {
    let created = false
    archiveTransport = (method, params, reply, fail) => {
      if (method === 'command/exec' && params.command?.[3] === 'codex-remote-directory') {
        expect(params.cwd).toBe('/'); reply({ exitCode: 0, stdout: '/remote/missing-default' }); return true
      }
      if (method === 'fs/createDirectory') { expect(params).toEqual({ path: '/remote/missing-default', recursive: true }); created = true; reply({}); return true }
      if (method === 'thread/start' && params.cwd === '/remote/missing-default' && !created) { fail(-32603, 'ENOENT'); return true }
      return false
    }
    await connectUnprepared(); await state.openThread('a')
    expect(state.active.value?.id).toBe('a'); expect(created).toBe(false)
    state.newThread(); const mark = requests.length
    expect(await state.send([{ type: 'text', text: 'new task' }])).toBe(true)
    const calls = requests.slice(mark)
    expect(calls.findIndex(call => call.method === 'fs/createDirectory')).toBeLessThan(calls.findIndex(call => call.method === 'thread/start'))
    expect(calls.find(call => call.method === 'thread/start')?.params.cwd).toBe('/remote/missing-default')
    expect(state.defaultWorkingDirectory.value).toBe('/remote/missing-default')
  })
  test('directory permission errors keep the connection and history usable, without starting a turn or goal', async () => {
    archiveTransport = (method, params, reply, fail) => {
      if (method === 'command/exec' && params.command?.[3] === 'codex-remote-directory') { reply({ exitCode: 0, stdout: '/remote/missing-default' }); return true }
      if (method === 'fs/createDirectory') { fail(-32603, 'Permission denied'); return true }
      return false
    }
    const mark = await connectUnprepared()
    expect(await state.send([{ type: 'text', text: 'keep this draft' }])).toBe(false)
    expect(state.currentTurnFailure.value || state.error.value).toContain('默认工作目录')
    expect(await state.setGoal({ objective: 'must not run' })).toBe(false)
    expect(state.goalError.value).toContain('默认工作目录')
    expect(requests.slice(mark).some(call => ['thread/start', 'turn/start', 'thread/goal/set'].includes(call.method))).toBe(false)
    expect(state.connected.value).toBe(true)
    await state.openThread('a'); expect(state.active.value?.id).toBe('a')
    state.newThread(); state.workingDirectory.value = '/existing-project'
    expect(await state.send([{ type: 'text', text: 'use this project' }])).toBe(true)
    expect(requests.findLast(call => call.method === 'thread/start')?.params.cwd).toBe('/existing-project')
  })
  test('a changed project cancels delayed preparation and repeated send cannot create duplicate tasks', async () => {
    let release: (() => void) | undefined
    archiveTransport = (method, params, reply) => {
      if (method === 'command/exec' && params.command?.[3] === 'codex-remote-directory') { reply({ exitCode: 0, stdout: '/remote/missing-default' }); return true }
      if (method === 'fs/createDirectory') { release = () => reply({}); return true }
      return false
    }
    const mark = await connectUnprepared()
    const first = state.send([{ type: 'text', text: 'original' }])
    await eventually(() => !!release, 'directory creation should be awaiting its acknowledgement')
    expect(await state.send([{ type: 'text', text: 'duplicate' }])).toBe(false)
    state.workingDirectory.value = '/another-project'
    release!(); expect(await first).toBe(false)
    expect(state.workingDirectory.value).toBe('/another-project'); expect(state.connected.value).toBe(true)
    expect(requests.slice(mark).some(call => ['thread/start', 'turn/start'].includes(call.method))).toBe(false)
  })
})

test('freezes live interrupted work time and keeps the next optimistic input after its own turn boundary', async () => {
  setSystemTime(new Date('2026-10-01T00:00:00Z'))
  socket.emit('turn/started', { threadId: 'a', turn: { id: 'stopped-live', status: 'inProgress', items: [] } })
  await settle()
  setSystemTime(new Date('2026-10-01T00:00:37Z'))
  socket.emit('turn/completed', { threadId: 'a', turn: { id: 'stopped-live', status: 'interrupted', items: [] } })
  await settle()
  expect(state.displayTurns.value[0]?.durationMs).toBe(37000)
  setSystemTime(new Date('2026-10-01T00:01:37Z'))
  socket.emit('turn/completed', { threadId: 'a', turn: { id: 'stopped-live', status: 'interrupted', items: [] } })
  await settle()
  expect(state.displayTurns.value[0]?.durationMs).toBe(37000)
  let release: (() => void) | undefined
  archiveTransport = (method, _params, reply) => {
    if (method !== 'turn/start') return false
    release = () => reply({ turn: { id: 'next-turn', status: 'inProgress', items: [] } }); return true
  }
  const next = state.send([{ type: 'text', text: 'next task' }])
  await eventually(() => !!release, 'next turn should wait for its acknowledgement')
  expect(state.displayTurns.value[0]?.items).toEqual([])
  expect(state.displayTurns.value.at(-1)?.status).toBe('inProgress')
  expect(state.displayTurns.value.at(-1)?.items[0]?.type).toBe('userMessage')
  release!(); await next
})
