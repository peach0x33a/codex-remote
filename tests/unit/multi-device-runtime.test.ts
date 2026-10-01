import { createProfileApi } from '../profile-api-fixture'
// Real useCodex/RpcClient instances; every bridge and socket stays in memory.
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { createRenderer, effectScope, nextTick, type App, type EffectScope } from 'vue'
import { useCodexWorkspace } from '../../src/composables/useCodexWorkspace'
import { useCodex } from '../../src/composables/useCodex'
import { STORAGE_KEY } from '../../src/lib/profiles'
import { UI_PREFERENCES_KEY } from '../../src/lib/ui-preferences'
import type { ConnectionProfile, MessageContent, Thread, Turn } from '../../shared/protocol'
import type { ThreadGoal } from '../../src/lib/thread-goal'
import type { TaskNotice } from '../../src/lib/task-notifications'

type Host = { children: Host[]; parent?: Host }
const renderer = createRenderer<Host, Host>({
  createElement: () => ({ children: [] }), createText: () => ({ children: [] }), createComment: () => ({ children: [] }),
  insert: (node, parent) => { node.parent = parent; parent.children.push(node) },
  remove: node => { if (node.parent) node.parent.children = node.parent.children.filter(child => child !== node) },
  setText() {}, setElementText() {}, patchProp() {}, parentNode: node => node.parent || null, nextSibling: () => null,
})
class MemoryStorage implements Storage {
  entries = new Map<string, string>(); rejectWrites = false
  get length() { return this.entries.size }
  getItem(key: string) { return this.entries.get(key) ?? null }
  setItem(key: string, value: string) { if (this.rejectWrites) throw new Error('Storage full'); this.entries.set(key, value) }
  removeItem(key: string) { this.entries.delete(key) }
  clear() { this.entries.clear() }
  key(index: number) { return [...this.entries.keys()][index] ?? null }
}
const alpha: ConnectionProfile = { id: 'alpha', name: 'Alpha', endpoint: 'ws://alpha.test/', cwd: '/alpha', createdAt: 1 }
const beta: ConnectionProfile = { id: 'beta', name: 'Beta', endpoint: 'ws://beta.test/', cwd: '/beta', createdAt: 2 }
const input = (text: string) => [{ type: 'text' as const, text }]
type Submission = { id: string; clientUserMessageId: string; input: MessageContent[] }
type Server = { thread: Thread; queue: Submission[]; goal: ThreadGoal | null; settings: Record<string, unknown>; sequence: number }
let servers: Map<string, Server>, sockets: MemorySocket[], requests: { endpoint: string; method: string; params: any }[]
let apiCalls: { url: string; method: string; body: any }[], credentials: Map<string, { endpoint: string; token: string }>
let credentialSequence: number, sessionAuthenticated: boolean, failCredentialSave: boolean, failCredentialDelete: string, failLogout: boolean, nativeQueue: boolean
let heldRpc: ((socket: MemorySocket, method: string, params: any, reply: (result: unknown) => void) => boolean) | undefined
let heldConnect: ((body: any) => Promise<Response> | undefined) | undefined
function server(endpoint: string) {
  let value = servers.get(endpoint)
  if (!value) {
    const now = Math.floor(Date.now() / 1000)
    value = { thread: { id: 'same', name: endpoint, preview: '', cwd: new URL(endpoint).hostname, createdAt: now, updatedAt: now, turns: [], status: { type: 'idle' } }, queue: [], goal: null, settings: {}, sequence: 0 }
    servers.set(endpoint, value)
  }
  return value
}
class MemorySocket {
  static OPEN = 1
  readyState = 1; closes = 0
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: ((event: { code: number }) => void) | null = null
  onerror: (() => void) | null = null
  endpoint: string
  constructor(url: string) { this.endpoint = new URL(url).searchParams.get('ticket')!; sockets.push(this); queueMicrotask(() => this.deliver({ method: 'bridge/ready' })) }
  deliver(message: unknown) { if (this.readyState === 1) this.onmessage?.({ data: JSON.stringify(message) }) }
  emit(method: string, params: unknown) { this.deliver({ method, params }) }
  close() { this.closes++; this.readyState = 3; this.onclose?.({ code: 1000 }) }
  send(raw: string) {
    const message = JSON.parse(raw), method = message.method, p = message.params || {}
    if (!method || message.id === undefined) return
    requests.push({ endpoint: this.endpoint, method, params: p })
    const remote = server(this.endpoint)
    const reply = (result: unknown) => queueMicrotask(() => this.deliver({ id: message.id, result }))
    const fail = () => queueMicrotask(() => this.deliver({ id: message.id, error: { code: -32601, message: 'Unsupported' } }))
    if (heldRpc?.(this, method, p, reply)) return
    if (method === 'initialize') reply({ userAgent: 'memory' })
    else if (method === 'model/list') reply({ data: [{ id: 'm', model: 'm', displayName: 'Model', isDefault: true }], nextCursor: null })
    else if (method === 'config/read') reply({ config: { approvals_reviewer: 'user' } })
    else if (method === 'configRequirements/read') reply({ requirements: null })
    else if (method === 'thread/list') reply({ data: [{ ...remote.thread, turns: [] }], nextCursor: null })
    else if (method === 'thread/resume') reply({ thread: { ...remote.thread, turns: [] }, model: remote.settings.model || 'm', reasoningEffort: remote.settings.effort || 'medium', approvalPolicy: 'on-request', sandbox: { type: 'workspaceWrite' } })
    else if (method === 'thread/turns/list') reply({ data: remote.thread.turns.map(turn => ({ ...turn, items: [] })).reverse(), nextCursor: null })
    else if (method === 'thread/items/list') reply({ data: remote.thread.turns.flatMap(turn => turn.items.map(item => ({ turnId: turn.id, item }))).reverse(), nextCursor: null })
    else if (method === 'thread/goal/get') reply({ goal: remote.goal })
    else if (method === 'thread/goal/set') {
      remote.goal = { threadId: 'same', objective: 'Goal', status: 'active', tokenBudget: null, tokensUsed: 0, timeUsedSeconds: 0, createdAt: 1, updatedAt: 1, ...remote.goal, ...p }
      reply({ goal: remote.goal })
    } else if (method === 'thread/settings/update') { remote.settings = p; reply({}) }
    else if (method.startsWith('thread/queue/')) {
      if (!nativeQueue) { fail(); return }
      if (method === 'thread/queue/list') reply({ data: remote.queue, nextCursor: null })
      else if (method === 'thread/queue/add') {
        const submission = { id: 'queued-' + ++remote.sequence, input: p.input, clientUserMessageId: p.clientUserMessageId }
        remote.queue.push(submission); reply({ queuedSubmission: submission }); this.emit('thread/queue/changed', { threadId: 'same' })
      } else if (method === 'thread/queue/delete') { remote.queue = remote.queue.filter(job => job.id !== p.queuedSubmissionId); reply({}); this.emit('thread/queue/changed', { threadId: 'same' }) }
      else fail()
    } else if (method === 'turn/start') {
      const turn: Turn = { id: 'turn-' + ++remote.sequence, status: 'inProgress', items: [{ id: 'user-' + remote.sequence, type: 'userMessage', content: p.input }] }
      remote.thread.turns.push(turn); remote.thread.status = { type: 'active' }
      this.emit('turn/started', { threadId: 'same', turn }); reply({ turn })
    } else if (method === 'thread/fork') reply({ thread: { ...remote.thread, id: 'fork-' + remote.sequence } })
    else reply({})
  }
}
let profileApi: Awaited<ReturnType<typeof createProfileApi>>
let app: App<Host> | undefined, state: ReturnType<typeof useCodexWorkspace>, storage: MemoryStorage
const scopes: EffectScope[] = [], originals = new Map<string, PropertyDescriptor | undefined>()
function global(name: string, value: unknown) { originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, writable: true, value }) }
async function settle() { await profileApi?.idle(); for (let i = 0; i < 24; i++) await Promise.resolve(); await nextTick() }
async function eventually(check: () => boolean) { for (let i = 0; i < 30 && !check(); i++) await settle(); expect(check()).toBe(true) }
function mount(options: Parameters<typeof useCodexWorkspace>[0] = { autoConnect: false }) {
  app?.unmount()
  app = renderer.createApp({ setup() { state = useCodexWorkspace(options); return () => null } }); app.mount({ children: [] })
}
async function open(profile: ConnectionProfile) { await state.connect(profile); await state.openThread('same'); await settle() }
const socketFor = (profile: ConnectionProfile) => sockets.findLast(socket => socket.endpoint === profile.endpoint)!
const saved = () => profileApi.snapshot
const connectCalls = () => apiCalls.filter(call => call.url === '/api/connect')
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes }); return { resolve, promise } }
beforeEach(async () => {
  servers = new Map(); sockets = []; requests = []; apiCalls = []; credentials = new Map(); credentialSequence = 0
  sessionAuthenticated = true; failCredentialSave = false; failCredentialDelete = ''; failLogout = false; nativeQueue = true; heldRpc = undefined; heldConnect = undefined
  storage = new MemoryStorage(); profileApi = await createProfileApi([alpha, beta]); credentials = profileApi.credentials
  global('localStorage', storage); global('window', new EventTarget()); global('navigator', { onLine: true }); global('location', { protocol: 'http:', host: 'memory.test' }); global('WebSocket', MemorySocket)
  global('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method || 'GET', body = init?.body ? JSON.parse(String(init.body)) : {}
    apiCalls.push({ url, method, body })
    if (url === '/api/session') {
      if (method === 'POST') sessionAuthenticated = true
      if (method === 'DELETE') { if (failLogout) return Response.json({ error: 'Failed logout' }, { status: 503 }); sessionAuthenticated = false }
      return Response.json({ authenticated: sessionAuthenticated, requiresKey: true })
    }
    if (url === '/api/profiles') { profileApi.failSave = failCredentialSave; profileApi.failDelete = failCredentialDelete; return profileApi.handle(init) }
    if (url === '/api/credentials') {
      if (method === 'DELETE') {
        if (body.credentialId === failCredentialDelete) return Response.json({ error: '删除失败' }, { status: 503 })
        credentials.delete(body.credentialId); return Response.json({ ok: true })
      }
      if (failCredentialSave) return Response.json({ error: '保存失败' }, { status: 503 })
      const credentialId = (++credentialSequence).toString(16).padStart(64, '0'); credentials.set(credentialId, body); return Response.json({ credentialId })
    }
    if (url === '/api/connect') return heldConnect?.(body) || Response.json({ ticket: body.endpoint })
    throw new Error('Unexpected mock URL: ' + url)
  })
  mount(); await state.start(); await settle()
})
afterEach(async () => {
  app?.unmount(); app = undefined; await profileApi.dispose()
  for (const scope of scopes.splice(0)) scope.stop()
  for (const [name, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name) }
  originals.clear()
})

describe('multi-device workspace', () => {
  test('keeps simultaneous connections and destructured facade refs stable across switches', async () => {
    const { active, connected, model, openThread } = state
    await open(alpha); const first = socketFor(alpha), firstThread = active.value
    model.value = 'alpha-model'
    await state.connect(beta); await openThread('same'); await settle()
    expect(active).toBe(state.active); expect(connected.value).toBe(true)
    expect(active.value?.name).toBe(beta.endpoint); expect(first.readyState).toBe(1)
    model.value = 'beta-model'
    const count = connectCalls().length
    await state.connect(alpha)
    expect(active.value).toBe(firstThread); expect(model.value).toBe('alpha-model')
    expect(connectCalls()).toHaveLength(count)
    expect(state.connectionStates.value).toEqual({ alpha: { status: 'connected', busy: false, approvals: 0 }, beta: { status: 'connected', busy: false, approvals: 0 } })
    expect(sockets.every(socket => socket.readyState === 1)).toBe(true)
    await eventually(() => saved().selectedId === 'alpha')
    expect(apiCalls.filter(call => call.url === '/api/session')).toHaveLength(1)
  })

  test('keeps overlapping thread ids, goals, settings, queues, and background deltas independent', async () => {
    await open(alpha); state.model.value = 'alpha-model'; state.effort.value = 'high'; state.serviceTier.value = 'fast'
    expect(await state.setGoal({ objective: 'Alpha goal' })).toBe(true)
    expect(await state.send(input('Alpha turn'))).toBe(true)
    expect(await state.send(input('Alpha queue'))).toBe(true); await settle()
    await open(beta); state.model.value = 'beta-model'; state.effort.value = 'low'
    expect(await state.setGoal({ objective: 'Beta goal' })).toBe(true)
    expect(await state.send(input('Beta turn'))).toBe(true)
    expect(await state.send(input('Beta queue'))).toBe(true); await settle()
    expect(state.queuedMessages.value.map(job => job.deviceId).sort()).toEqual(['alpha', 'beta'])
    expect(state.currentQueue.value.map(job => job.deviceId)).toEqual(['beta'])
    const turnId = server(alpha.endpoint).thread.turns[0]!.id
    socketFor(alpha).emit('item/agentMessage/delta', { threadId: 'same', turnId, itemId: 'answer', delta: 'Alpha background reply' })
    expect(state.items.value.some(item => item.text?.includes('Alpha background'))).toBe(false)
    await state.connect(alpha)
    expect(state.items.value.some(item => item.text === 'Alpha background reply')).toBe(true)
    expect(state.goal.value?.objective).toBe('Alpha goal')
    expect(state.model.value).toBe('alpha-model'); expect(state.effort.value).toBe('high'); expect(state.serviceTier.value).toBe('fast')
    expect(state.currentQueue.value.map(job => job.deviceId)).toEqual(['alpha'])
    await state.removeQueued(state.currentQueue.value[0]!.id); await settle()
    expect(state.queuedMessages.value.map(job => job.deviceId)).toEqual(['beta'])
    await state.connect(beta); expect(state.goal.value?.objective).toBe('Beta goal'); expect(state.model.value).toBe('beta-model')
  })

  test('aggregates background activity, approvals, and notices without changing selection', async () => {
    await open(alpha); await state.send(input('work')); await open(beta)
    expect(state.busy.value).toBe(false); expect(state.anyBusy.value).toBe(true)
    expect(state.connectionStates.value.alpha?.busy).toBe(true)
    const notices: TaskNotice[] = [], off = state.onTaskNotice(notice => notices.push(notice))
    const socket = socketFor(alpha), turn = server(alpha.endpoint).thread.turns[0]!
    socket.deliver({ id: 12, method: 'item/commandExecution/requestApproval', params: { threadId: 'same', turnId: turn.id, command: 'pwd' } })
    expect(state.connectionStates.value.alpha?.approvals).toBe(1); expect(state.approvals.value).toHaveLength(0)
    expect(notices[0]?.deviceId).toBe('alpha'); expect(notices[0]?.deviceName).toBe('Alpha')
    socket.emit('turn/completed', { threadId: 'same', turn: { ...turn, status: 'completed' } }); await settle()
    expect(notices.map(notice => notice.kind)).toEqual(['attention', 'completed'])
    expect(state.selectedId.value).toBe('beta'); expect(state.anyBusy.value).toBe(false)
    off(); socket.emit('turn/completed', { threadId: 'same', turn: { ...turn, status: 'failed' } }); expect(notices).toHaveLength(2)
  })

  test('retains writable per-device state when selectedId is assigned directly', async () => {
    await open(alpha); state.projectFilter.value = '/alpha-project'
    await open(beta); state.projectFilter.value = '/beta-project'
    state.selectedId.value = alpha.id
    expect(state.projectFilter.value).toBe('/alpha-project')
    await eventually(() => saved().selectedId === 'alpha')
    state.selectedId.value = beta.id; expect(state.projectFilter.value).toBe('/beta-project')
    expect(sockets).toHaveLength(2)
  })

  test('does not persist a background runtime selectedId when its reconnect completes', async () => {
    const delayed = deferred<Response>()
    heldConnect = body => body.endpoint === alpha.endpoint ? delayed.promise : undefined
    const alphaConnection = state.connect(alpha)
    await open(beta)
    delayed.resolve(Response.json({ ticket: alpha.endpoint })); await alphaConnection; await settle()
    expect(state.selectedId.value).toBe('beta'); expect(saved().selectedId).toBe('beta')
    expect(state.connectionStates.value.alpha?.status).toBe('connected')
    expect(saved().profiles).toHaveLength(2)
  })

  test('deduplicates concurrent connect calls for the same device', async () => {
    const delayed = deferred<Response>(); heldConnect = () => delayed.promise
    const first = state.connect(alpha), second = state.connect(alpha)
    expect(connectCalls()).toHaveLength(1)
    delayed.resolve(Response.json({ ticket: alpha.endpoint })); await Promise.all([first, second])
    expect(sockets).toHaveLength(1)
  })

  test('can reconnect immediately after cancelling an unfinished device connection', async () => {
    const delayed = deferred<Response>()
    heldConnect = () => delayed.promise
    const cancelled = state.connect(alpha)
    state.disconnectDevice(alpha.id); heldConnect = undefined
    await state.connect(alpha)
    delayed.resolve(Response.json({ ticket: alpha.endpoint })); await cancelled
    expect(state.connected.value).toBe(true); expect(sockets).toHaveLength(1)
    expect(socketFor(alpha).readyState).toBe(1)
  })

  test('captures the invoking runtime for asynchronous goal writes', async () => {
    await open(alpha)
    let release: (() => void) | undefined
    heldRpc = (socket, method, p, reply) => {
      if (socket.endpoint !== alpha.endpoint || method !== 'thread/goal/set') return false
      release = () => reply({ goal: { threadId: 'same', objective: p.objective, status: 'active', tokenBudget: null, tokensUsed: 0, timeUsedSeconds: 0, createdAt: 1, updatedAt: 1 } }); return true
    }
    const write = state.setGoal({ objective: 'Delayed Alpha' }); await eventually(() => !!release)
    await open(beta); await state.setGoal({ objective: 'Beta goal' })
    release!(); expect(await write).toBe(true)
    expect(state.goal.value?.objective).toBe('Beta goal')
    await state.connect(alpha); expect(state.goal.value?.objective).toBe('Delayed Alpha')
  })

  test('retains native stale-generation guards after a background device disconnects', async () => {
    await open(alpha)
    let release: (() => void) | undefined
    heldRpc = (socket, method, _params, reply) => {
      if (socket.endpoint !== alpha.endpoint || method !== 'thread/goal/set') return false
      release = () => reply({ goal: { threadId: 'same', objective: 'Stale Alpha', status: 'active', tokenBudget: null, tokensUsed: 0, timeUsedSeconds: 0, createdAt: 1, updatedAt: 1 } }); return true
    }
    const write = state.setGoal({ objective: 'Stale Alpha' }); await eventually(() => !!release)
    await open(beta); await state.setGoal({ objective: 'Keep Beta' })
    state.disconnectDevice(alpha.id); release!()
    expect(await write).toBe(false); expect(state.goal.value?.objective).toBe('Keep Beta')
    expect(state.connectionStates.value.beta?.status).toBe('connected')
  })

  test('disconnects only the selected device and leaves its peer running', async () => {
    await open(alpha); await state.send(input('background work')); await open(beta)
    state.disconnect()
    expect(socketFor(beta).readyState).toBe(3); expect(socketFor(alpha).readyState).toBe(1)
    expect(state.connectionStates.value.alpha?.busy).toBe(true)
    await state.connect(alpha); expect(state.active.value?.id).toBe('same'); expect(state.activeTurn.value).toBeDefined()
  })

  test('logs out every device through one metadata request, including on failed logout', async () => {
    await open(alpha); await open(beta); failLogout = true
    await expect(state.logout()).rejects.toThrow('退出失败')
    expect(sockets.every(socket => socket.readyState === 3)).toBe(true)
    expect(apiCalls.filter(call => call.url === '/api/session' && call.method === 'DELETE')).toHaveLength(1)
    failLogout = false; await state.logout(); expect(state.authenticated.value).toBe(false)
  })

  test('disconnects a background device without changing the selected conversation', async () => {
    await open(alpha); await open(beta); const selectedThread = state.active.value
    state.disconnectDevice(alpha.id)
    expect(state.selectedId.value).toBe(beta.id); expect(state.active.value).toBe(selectedThread)
    expect(socketFor(alpha).readyState).toBe(3); expect(socketFor(beta).readyState).toBe(1)
    expect(state.connectionStates.value.alpha?.status).toBe('disconnected')
    state.disconnectDevice('missing'); expect(state.connected.value).toBe(true)
  })

  test('retains service tokens in memory per device and sends credential references unchanged', async () => {
    await state.connectWithToken(alpha, 'alpha-secret'); await state.connectWithToken(beta, 'beta-secret')
    expect(state.tokenFor(alpha.id)).toBe('alpha-secret'); expect(state.tokenFor(beta.id)).toBe('beta-secret')
    state.disconnect(); await state.connect(beta)
    expect(connectCalls().at(-1)?.body).toEqual({ endpoint: beta.endpoint, token: 'beta-secret' })
    const remembered = await state.saveProfile({ ...alpha, token: 'saved-secret', rememberToken: true })
    await state.connect(remembered)
    expect(connectCalls().at(-1)?.body).toEqual({ endpoint: alpha.endpoint, credentialId: remembered.credentialId })
    expect(state.tokenFor(alpha.id)).toBe('')
    expect(storage.getItem(STORAGE_KEY)).toBeNull()
    await state.logout(); expect(state.tokenFor(beta.id)).toBe('')
    await state.login('key'); await state.connect(beta, true)
    expect(connectCalls().at(-1)?.body).toEqual({ endpoint: beta.endpoint, token: '' })
  })

  test('edits only the changed connection and leaves successful metadata-only edits connected', async () => {
    await open(alpha); await open(beta)
    const first = socketFor(alpha), second = socketFor(beta)
    await state.saveProfile({ ...alpha, name: 'Renamed Alpha', token: '' })
    expect(first.readyState).toBe(1); expect(second.readyState).toBe(1)
    await state.saveProfile({ ...alpha, endpoint: 'ws://alpha-new.test', token: 'replacement' })
    expect(first.readyState).toBe(3); expect(second.readyState).toBe(1)
    expect(state.selectedId.value).toBe('beta'); expect(state.active.value?.name).toBe(beta.endpoint)
  })

  test('removes a device and its credential only after a successful metadata transaction', async () => {
    const profile = await state.saveProfile({ ...alpha, token: 'secret', rememberToken: true })
    await open(profile); await open(beta)
    const mark = apiCalls.length
    expect(await state.removeProfile(alpha.id)).toBe(true)
    expect(credentials.has(profile.credentialId!)).toBe(false)
    expect(apiCalls.slice(mark).filter(call => call.url === '/api/profiles' && call.method === 'DELETE')).toHaveLength(1)
    expect(socketFor(alpha).readyState).toBe(3); expect(socketFor(beta).readyState).toBe(1)
    expect(state.connectionStates.value.alpha).toBeUndefined(); expect(saved().selectedId).toBe('beta')
  })

  test('preserves live runtimes and saved profiles when credential rotation or removal fails', async () => {
    const profile = await state.saveProfile({ ...alpha, token: 'original', rememberToken: true })
    await open(profile); await open(beta)
    failCredentialDelete = profile.credentialId!
    await expect(state.saveProfile({ ...alpha, token: 'replacement', rememberToken: true })).rejects.toThrow('删除失败')
    expect(credentials.size).toBe(1)
    expect(saved().profiles.find((item: ConnectionProfile) => item.id === alpha.id)?.credentialId).toBe(profile.credentialId)
    await expect(state.removeProfile(alpha.id)).rejects.toThrow('删除失败')
    expect(state.profiles.value).toHaveLength(2); expect(sockets.every(socket => socket.readyState === 1)).toBe(true)
    expect(state.selectedId.value).toBe('beta'); expect(state.anyBusy.value).toBe(false)
  })

  test('saves devices successfully even when browser storage cannot write', async () => {
    await open(alpha); await open(beta); storage.rejectWrites = true
    const updated = await state.saveProfile({ ...alpha, token: 'new-secret', rememberToken: true })
    expect(updated.credentialId).toMatch(/^[a-f0-9]{64}$/)
    expect(credentials.get(updated.credentialId!)?.token).toBe('new-secret')
    expect(storage.getItem(STORAGE_KEY)).toBeNull()
    expect(socketFor(beta).readyState).toBe(1)
  })

  test('prevents removing a background device with queued work', async () => {
    await open(alpha); await state.send(input('work')); await state.send(input('queued')); await settle(); await open(beta)
    await expect(state.removeProfile(alpha.id)).rejects.toThrow('待发送消息')
    expect(state.queuedMessages.value).toHaveLength(1); expect(state.profiles.value).toHaveLength(2)
    expect(socketFor(alpha).readyState).toBe(1)
  })

  test('removing the selected device selects the live peer without reopening it', async () => {
    await open(beta); const peerThread = state.active.value
    await open(alpha); await state.removeProfile(alpha.id)
    expect(state.selectedId.value).toBe('beta'); expect(state.active.value).toBe(peerThread)
    expect(socketFor(beta).readyState).toBe(1); expect(connectCalls()).toHaveLength(2)
  })

  test('keeps a newer selection when credential deletion completes asynchronously', async () => {
    const gamma = await state.saveProfile({ name: 'Gamma', endpoint: 'ws://gamma.test/', cwd: '/gamma', token: '' })
    const profile = await state.saveProfile({ ...alpha, token: 'secret', rememberToken: true })
    await open(beta); await open(profile)
    const bridge = globalThis.fetch, deletion = deferred<void>()
    let deleting = false
    globalThis.fetch = (async (url, init) => {
      if (url === '/api/profiles' && init?.method === 'DELETE') { deleting = true; await deletion.promise }
      return bridge(url, init)
    }) as typeof fetch
    const removal = state.removeProfile(alpha.id); await eventually(() => deleting)
    await open(gamma); deletion.resolve(); await removal
    expect(state.selectedId.value).toBe(gamma.id); await eventually(() => saved().selectedId === gamma.id)
    expect(state.active.value?.name).toBe(gamma.endpoint)
    expect(socketFor(beta).readyState).toBe(1)
  })

  test('aggregates page-local queues while keeping their pause state device-scoped', async () => {
    nativeQueue = false
    await open(alpha); await state.send(input('Alpha running')); await state.send(input('Alpha local queue')); state.pauseQueue()
    await open(beta); await state.send(input('Beta running')); await state.send(input('Beta local queue'))
    expect(state.queuedMessages.value.map(job => job.deviceId).sort()).toEqual(['alpha', 'beta'])
    expect(state.currentQueue.value[0]?.source).toBeUndefined(); expect(state.queuePaused.value).toBe(false)
    await state.connect(alpha); expect(state.queuePaused.value).toBe(true)
    expect(state.currentQueue.value[0]?.parts).toEqual(input('Alpha local queue'))
  })

  test('auto-connects only the last device after authenticated startup', async () => {
    app!.unmount(); app = undefined; await profileApi.store.selectProfile(beta.id); mount({})
    await eventually(() => state.connected.value)
    expect(connectCalls()).toHaveLength(1); expect(connectCalls()[0]?.body.endpoint).toBe(beta.endpoint)
    expect(state.connectionStates.value.alpha?.status).toBe('disconnected')
  })

  test('waits for login and respects the disabled auto-connect preference', async () => {
    sessionAuthenticated = false; mount({}); await state.start(); await settle()
    expect(connectCalls()).toHaveLength(0); expect(state.authenticated.value).toBe(false)
    await state.login('key'); await eventually(() => state.connected.value)
    expect(connectCalls()).toHaveLength(1)
    app!.unmount(); app = undefined; storage.setItem(UI_PREFERENCES_KEY, JSON.stringify({ autoConnect: false })); mount({}); await state.start(); await settle()
    expect(state.connected.value).toBe(false); expect(connectCalls()).toHaveLength(1)
  })

  test('manual disconnect cancels pending startup intent before login', async () => {
    sessionAuthenticated = false; mount({}); await state.start(); await settle()
    state.disconnect(); await state.login('key'); await settle()
    expect(connectCalls()).toHaveLength(0)
  })

  test('scoped dynamic runtimes have explicit idempotent start/dispose without setup warnings', async () => {
    const warnings = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const scope = effectScope(true); scopes.push(scope)
      const child = scope.run(() => useCodex({ deferLifecycle: true, autoConnect: false, persistConnection: false }))!
      const mark = apiCalls.length
      await settle(); expect(apiCalls).toHaveLength(mark)
      await Promise.all([child.start(), child.start()])
      expect(apiCalls.slice(mark).filter(call => call.url === '/api/session')).toHaveLength(1)
      await child.connect(alpha); const socket = socketFor(alpha)
      scope.stop(); expect(socket.readyState).toBe(3)
      const count = connectCalls().length; await child.start(); await child.connect(beta)
      expect(connectCalls()).toHaveLength(count)
      await open(beta); expect(warnings).not.toHaveBeenCalled()
    } finally { warnings.mockRestore() }
  })

  test('workspace disposal closes every runtime and suppresses delayed transport completion', async () => {
    await open(alpha)
    const delayed = deferred<Response>(); heldConnect = body => body.endpoint === beta.endpoint ? delayed.promise : undefined
    const connecting = state.connect(beta)
    state.dispose(); delayed.resolve(Response.json({ ticket: beta.endpoint })); await connecting; await settle()
    expect(sockets.every(socket => socket.readyState === 3)).toBe(true)
    const count = connectCalls().length; await state.connect(alpha); await state.start()
    expect(connectCalls()).toHaveLength(count)
  })
})

describe('server metadata synchronization', () => {
  test('refreshes names and additions without switching the current device or dropping peers', async () => {
    await open(alpha); await open(beta)
    const current = state.active.value, first = socketFor(alpha), second = socketFor(beta)
    await profileApi.store.saveProfile({ ...alpha, name: 'Edited elsewhere', token: '' })
    await profileApi.store.saveProfile({ name: 'Remote addition', endpoint: 'wss://new-device.test', cwd: '/remote', token: '' })
    await profileApi.store.selectProfile(alpha.id)
    await state.refreshProfiles()
    expect(state.selectedId.value).toBe(beta.id)
    expect(state.active.value).toBe(current)
    expect(state.profiles.value).toHaveLength(3)
    expect(state.profiles.value.find(profile => profile.id === alpha.id)?.name).toBe('Edited elsewhere')
    expect(first.readyState).toBe(1); expect(second.readyState).toBe(1)
    expect(storage.getItem(STORAGE_KEY)).toBeNull()
  })
  test('closes remotely removed or reconfigured devices without closing an unchanged peer', async () => {
    await state.connectWithToken(alpha, 'old-memory-token'); await open(beta)
    await profileApi.store.saveProfile({ ...alpha, endpoint: 'wss://replacement.test', token: '' })
    await state.refreshProfiles()
    expect(socketFor(alpha).readyState).toBe(3)
    expect(state.tokenFor(alpha.id)).toBe('')
    expect(socketFor(beta).readyState).toBe(1)
    await profileApi.store.removeProfile(alpha.id); await state.refreshProfiles()
    expect(state.connectionStates.value.alpha).toBeUndefined()
    expect(state.selectedId.value).toBe(beta.id)
    expect(socketFor(beta).readyState).toBe(1)
  })
  test('ignores a stale list response that finishes after a successful save', async () => {
    const original = globalThis.fetch, response = deferred<Response>()
    const old = structuredClone(profileApi.snapshot)
    let reading = false
    globalThis.fetch = (async (url, init) => {
      if (url === '/api/profiles' && init?.method === 'GET') { reading = true; return response.promise }
      return original(url, init)
    }) as typeof fetch
    try {
      const refresh = state.refreshProfiles(); await eventually(() => reading)
      await state.saveProfile({ ...alpha, name: 'New value', token: '' })
      response.resolve(Response.json(old)); await refresh
      expect(state.profiles.value.find(profile => profile.id === alpha.id)?.name).toBe('New value')
    } finally { globalThis.fetch = original }
  })
  test('clears metadata and connections when profile polling discovers an expired session', async () => {
    await open(alpha); await open(beta)
    const original = globalThis.fetch
    globalThis.fetch = (async (url, init) => url === '/api/profiles'
      ? Response.json({ error: '请重新登录' }, { status: 401 }) : original(url, init)) as typeof fetch
    try {
      await state.refreshProfiles()
      expect(state.authenticated.value).toBe(false)
      expect(state.profiles.value).toEqual([])
      expect(sockets.every(socket => socket.readyState === 3)).toBe(true)
    } finally { globalThis.fetch = original }
  })
})

// Covers the live metadata owner instead of the retired single-device startup path.
test('imports browser-only devices once, preserves the saved selection and removes browser metadata', async () => {
  await profileApi.store.removeProfile(alpha.id); await profileApi.store.removeProfile(beta.id)
  const first = { ...alpha, id: 'legacy-a', endpoint: 'ws://legacy-a.test/', cwd: '' }
  const second = { ...beta, id: 'legacy-b', endpoint: 'ws://legacy-b.test/' }
  storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, selectedId: second.id, profiles: [first, second] }))
  await state.refreshProfiles(); await settle()
  expect(storage.getItem(STORAGE_KEY)).toBeNull()
  expect(state.profiles.value.map(profile => profile.id)).toEqual([first.id, second.id])
  expect(state.profiles.value[0]?.cwd).toBe('~/codex-remote')
  expect(state.selectedId.value).toBe(second.id)
  expect(profileApi.snapshot.selectedId).toBe(second.id)
  await state.refreshProfiles()
  expect(profileApi.snapshot.profiles).toHaveLength(2)
})
