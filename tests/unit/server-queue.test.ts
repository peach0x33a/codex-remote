import { describe, expect, spyOn, test } from 'bun:test'
import type { MessageContent } from '../../shared/protocol'
import { RpcError, type RpcClient } from '../../src/lib/rpc'
import { ServerQueueClient, type ServerQueuedSubmission } from '../../src/lib/server-queue'

const input = (text: string): MessageContent[] => [{ type: 'text', text }]
const item = (id: string, text = id): ServerQueuedSubmission => ({ id, input: input(text), clientUserMessageId: 'client-' + id })
type Call = { method: string; params: Record<string, unknown>; signal?: AbortSignal; timeoutMs?: number }
function transport(handler: (call: Call) => unknown | Promise<unknown>) {
  const calls: Call[] = []
  const rpc: Pick<RpcClient, 'request'> = {
    async request<T>(method: string, params: unknown = {}, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<T> {
      const call = { method, params: params as Record<string, unknown>, signal: options.signal, timeoutMs: options.timeoutMs }
      calls.push(call)
      return await handler(call) as T
    },
  }
  return { rpc, calls }
}
function observe(rpc: Pick<RpcClient, 'request'>) {
  const snapshots: { threadId: string; items: ServerQueuedSubmission[] }[] = []
  const errors: string[] = []
  const client = new ServerQueueClient(rpc, (threadId, items) => snapshots.push({ threadId, items }), message => errors.push(message))
  return { client, snapshots, errors }
}
async function settle() { for (let i = 0; i < 40; i++) await Promise.resolve() }
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const mutations: ('add' | 'update' | 'remove')[] = ['add', 'update', 'remove']
function mutate(client: ServerQueueClient, operation: typeof mutations[number]) {
  if (operation === 'add') return client.add('thread', input('new'), 'client-new')
  if (operation === 'update') return client.update('thread', 'entry', input('new'))
  return client.remove('thread', 'entry')
}

class QueueServer {
  private queues = new Map<string, ServerQueuedSubmission[]>()
  private sequence = 0
  readonly listeners = new Set<(threadId: string) => void>()
  readonly transport = transport(({ method, params }) => {
    const threadId = params.threadId as string
    const queue = this.queues.get(threadId) ?? []
    this.queues.set(threadId, queue)
    let response: unknown
    if (method === 'thread/queue/list') {
      const offset = Number(params.cursor ?? 0), limit = params.limit as number
      return structuredClone({ data: queue.slice(offset, offset + limit), nextCursor: offset + limit < queue.length ? String(offset + limit) : null })
    }
    if (method === 'thread/queue/add') {
      const queuedSubmission = { id: 'q-' + ++this.sequence, input: structuredClone(params.input as MessageContent[]), clientUserMessageId: params.clientUserMessageId as string }
      queue.push(queuedSubmission)
      response = { queuedSubmission }
    } else if (method === 'thread/queue/update') {
      const queuedSubmission = queue.find(entry => entry.id === params.queuedSubmissionId)
      if (!queuedSubmission) throw new RpcError('queued submission not found', -32600)
      queuedSubmission.input = structuredClone(params.input as MessageContent[])
      response = { queuedSubmission }
    } else if (method === 'thread/queue/delete') {
      const index = queue.findIndex(entry => entry.id === params.queuedSubmissionId)
      if (index >= 0) queue.splice(index, 1)
      response = { deleted: index >= 0 }
    } else throw new Error('Unexpected RPC (dispatch belongs to the server): ' + method)
    for (const listener of this.listeners) listener(threadId)
    return structuredClone(response)
  })
  connect() {
    const observed = observe(this.transport.rpc)
    this.listeners.add(threadId => observed.client.notification(threadId))
    return observed
  }
}

describe('ServerQueueClient', () => {
  test('starts only on an explicit action and refreshes after the start ack', async () => {
    const turn = { id: 'started', status: 'inProgress', items: [] }
    let started = false
    const fake = transport(({ method }) => {
      if (method === 'thread/queue/start') { started = true; return { turn } }
      return { data: started ? [] : [item('pending')], nextCursor: null }
    })
    const observed = observe(fake.rpc)
    await observed.client.refresh('thread')
    observed.client.notification('thread'); await settle()
    expect(fake.calls.every(call => call.method === 'thread/queue/list')).toBe(true)
    expect(await observed.client.start('thread')).toEqual(turn)
    expect(fake.calls.filter(call => call.method === 'thread/queue/start').map(call => call.params)).toEqual([{ threadId: 'thread' }])
    expect(observed.snapshots.at(-1)?.items).toEqual([])
    observed.client.dispose()
  })

  test('an accepted explicit start survives a failed snapshot read without retrying', async () => {
    const turn = { id: 'started', status: 'inProgress', items: [] }
    const fake = transport(({ method }) => {
      if (method === 'thread/queue/start') return { turn }
      throw new RpcError('temporary read failure')
    })
    const observed = observe(fake.rpc)
    expect(await observed.client.start('thread')).toEqual(turn)
    expect(observed.errors).toHaveLength(1)
    expect(fake.calls.map(call => call.method)).toEqual(['thread/queue/start', 'thread/queue/list'])
    observed.client.dispose()
  })

  test.each([
    ['null response', null],
    ['non-array data', { data: {}, nextCursor: null }],
    ['numeric cursor', { data: [], nextCursor: 1 }],
    ['empty ID', { data: [{ ...item('bad'), id: '' }], nextCursor: null }],
    ['non-array input', { data: [{ ...item('bad'), input: 'bad' }], nextCursor: null }],
    ['missing content type', { data: [{ ...item('bad'), input: [{ text: 'bad' }] }], nextCursor: null }],
    ['invalid text ranges', { data: [{ ...item('bad'), input: [{ type: 'text', text: 'bad', text_elements: [{ byteRange: { start: 3, end: 1 }, placeholder: null }] }] }], nextCursor: null }],
    ['oversized page', { data: Array.from({ length: 101 }, (_, i) => item(String(i))), nextCursor: null }]
  ])('rejects malformed later pages without replacing the last good snapshot: %s', async (_name, badPage) => {
    let round = 0
    const fake = transport(({ params }) => {
      if (round === 0) return { data: [item('saved')], nextCursor: null }
      return params.cursor === null ? { data: [item('partial')], nextCursor: 'later' } : badPage
    })
    const observed = observe(fake.rpc)
    await observed.client.refresh('thread')
    round++
    await expect(observed.client.refresh('thread')).rejects.toBeInstanceOf(RpcError)
    expect(observed.client.mode).toBe('supported')
    expect(observed.snapshots).toEqual([{ threadId: 'thread', items: [item('saved')] }])
    expect(observed.errors).toHaveLength(1)
    expect(fake.calls).toHaveLength(3)
    observed.client.dispose()
  })

  test('detects a cursor cycle before requesting any repeated cursor', async () => {
    const fake = transport(({ params }) => ({ data: [item('partial')], nextCursor: params.cursor === 'a' ? 'b' : 'a' }))
    const observed = observe(fake.rpc)
    await expect(observed.client.refresh('thread')).rejects.toBeInstanceOf(RpcError)
    expect(fake.calls.map(call => call.params.cursor)).toEqual([null, 'a', 'b'])
    expect(observed.snapshots).toEqual([])
    expect(observed.errors).toHaveLength(1)
    expect(observed.client.mode).toBe('unknown')
    observed.client.dispose()
  })

  test.each([['overflow', false], ['complete', true]] as const)('bounds pagination to 100 pages and only publishes a completed final page: %s', async (_name, complete) => {
    let page = 0
    const fake = transport(() => {
      page++
      return { data: [item('page-' + page)], nextCursor: complete && page === 100 ? null : String(page) }
    })
    const observed = observe(fake.rpc)
    if (complete) {
      expect(await observed.client.refresh('thread')).toBe(true)
      expect(observed.snapshots).toHaveLength(1)
      expect(observed.snapshots[0].items).toHaveLength(100)
      expect(observed.snapshots[0].items.at(-1)).toEqual(item('page-100'))
    } else {
      await expect(observed.client.refresh('thread')).rejects.toBeInstanceOf(RpcError)
      expect(observed.snapshots).toEqual([])
      expect(observed.errors).toHaveLength(1)
    }
    expect(fake.calls).toHaveLength(100)
    observed.client.dispose()
  })

  test('applies a 30-second total page budget and reduces the final request timeout', async () => {
    let now = 1_000, calls = 0
    const clock = spyOn(Date, 'now').mockImplementation(() => now)
    const fake = transport(() => {
      calls++
      now += 8_000
      return { data: [item(String(calls))], nextCursor: calls === 4 ? null : String(calls) }
    })
    const observed = observe(fake.rpc)
    try {
      await expect(observed.client.refresh('thread')).rejects.toBeInstanceOf(RpcError)
      expect(fake.calls.map(call => call.timeoutMs)).toEqual([10_000, 10_000, 10_000, 6_000])
      expect(observed.snapshots).toEqual([])
      expect(observed.errors).toHaveLength(1)
      expect(observed.errors[0]).toContain('超时')
    } finally { clock.mockRestore(); observed.client.dispose() }
  })

  test('restarts from the first page when a notification invalidates a later page', async () => {
    const later = deferred<unknown>()
    let reads = 0
    const fake = transport(() => {
      reads++
      if (reads === 1) return { data: [item('partial')], nextCursor: 'old-next' }
      if (reads === 2) return later.promise
      return { data: [item('fresh')], nextCursor: null }
    })
    const observed = observe(fake.rpc), refresh = observed.client.refresh('thread')
    await settle()
    observed.client.notification('thread')
    later.resolve({ data: [item('stale-tail')], nextCursor: 'must-not-follow' })
    await refresh
    expect(fake.calls.map(call => call.params.cursor)).toEqual([null, 'old-next', null])
    expect(observed.snapshots).toEqual([{ threadId: 'thread', items: [item('fresh')] }])
    observed.client.dispose()
  })

  test('a transient read failure still drains a notification received during that read', async () => {
    const first = deferred<unknown>()
    let calls = 0
    const fake = transport(() => ++calls === 1 ? first.promise : { data: [item('fresh')], nextCursor: null })
    const observed = observe(fake.rpc), refresh = observed.client.refresh('thread')
    await settle()
    observed.client.notification('thread')
    first.reject(new RpcError('first read failed'))
    expect(await refresh).toBe(true)
    expect(observed.errors).toHaveLength(1)
    expect(observed.snapshots).toEqual([{ threadId: 'thread', items: [item('fresh')] }])
    expect(fake.calls).toHaveLength(2)
    observed.client.dispose()
  })

  test.each(['add', 'remove'] as const)('%s waits for its ack and remains successful when the subsequent refresh fails', async operation => {
    const ack = deferred<unknown>()
    let refreshFails = false, resolved = false
    const fake = transport(({ method }) => {
      if (method !== 'thread/queue/list') return ack.promise
      if (refreshFails) throw new RpcError('snapshot offline')
      return { data: [item('saved')], nextCursor: null }
    })
    const observed = observe(fake.rpc)
    await observed.client.refresh('thread')
    const mutation = mutate(observed.client, operation).then(() => { resolved = true })
    await settle()
    expect(resolved).toBe(false)
    expect(observed.snapshots).toHaveLength(1)
    refreshFails = true
    ack.resolve(operation === 'remove' ? { deleted: true } : { queuedSubmission: item('entry') })
    await mutation
    expect(resolved).toBe(true)
    expect(observed.client.mode).toBe('supported')
    expect(observed.errors).toHaveLength(1)
    expect(observed.errors[0]).toContain('snapshot offline')
    expect(observed.snapshots).toEqual([{ threadId: 'thread', items: [item('saved')] }])
    expect(fake.calls.filter(call => call.method !== 'thread/queue/list')).toHaveLength(1)
    expect(fake.calls.filter(call => call.method === 'thread/queue/list')).toHaveLength(2)
    refreshFails = false
    expect(await observed.client.refresh('thread')).toBe(true)
    observed.client.dispose()
  })

  test.each(['add', 'remove'] as const)('%s never retries a timeout, even when the server committed the mutation', async operation => {
    const failure = new RpcError('请求超时，服务端可能已提交')
    let committed = false
    const fake = transport(({ method }) => {
      if (method !== 'thread/queue/list') { committed = true; throw failure }
      return { data: committed && operation !== 'remove' ? [item('committed')] : [], nextCursor: null }
    })
    const observed = observe(fake.rpc)
    await expect(mutate(observed.client, operation)).rejects.toBe(failure)
    await settle()
    expect(fake.calls).toHaveLength(1)
    expect(observed.client.mode).toBe('unknown')
    expect(observed.snapshots).toEqual([])
    // clientUserMessageId is correlation metadata, not an idempotency key. Reconcile by reading.
    expect(await observed.client.refresh('thread')).toBe(true)
    expect(observed.snapshots.at(-1)?.items).toEqual(operation === 'remove' ? [] : [item('committed')])
    expect(fake.calls.filter(call => call.method !== 'thread/queue/list')).toHaveLength(1)
    observed.client.dispose()
  })

  test.each(['success', 'failure'] as const)('dispose suppresses late read %s, queued notifications, and all future callbacks/requests', async outcome => {
    const pending = deferred<unknown>(), fake = transport(() => pending.promise), observed = observe(fake.rpc)
    const refresh = observed.client.refresh('thread')
    await settle()
    observed.client.notification('thread')
    observed.client.dispose(); observed.client.dispose()
    expect(fake.calls[0].signal?.aborted).toBe(true)
    if (outcome === 'success') pending.resolve({ data: [item('late')], nextCursor: 'next' })
    else pending.reject(new RpcError('late network error'))
    expect(await refresh).toBe(false)
    observed.client.notification('thread')
    expect(await observed.client.refresh('thread')).toBe(false)
    for (const operation of mutations) await expect(mutate(observed.client, operation)).rejects.toBeInstanceOf(RpcError)
    expect(fake.calls).toHaveLength(1)
    expect(observed.snapshots).toEqual([])
    expect(observed.errors).toEqual([])
  })

  test.each([
    ['method not found', new RpcError('Method not found', -32601)],
    ['unknown queue variant', new RpcError('unknown variant \x60thread/queue/list\x60', -32600)],
    ['disabled queue service', new RpcError('user message queue is unavailable', -32600)]
  ])('only explicit unsupported errors disable the connection: %s', async (_name, failure) => {
    const fake = transport(() => { throw failure }), observed = observe(fake.rpc)
    expect(await observed.client.refresh('thread')).toBe(false)
    expect(observed.client.mode).toBe('unsupported')
    observed.client.notification('thread')
    expect(await observed.client.refresh('other')).toBe(false)
    await expect(observed.client.add('thread', input('never sent'), 'client')).rejects.toBeInstanceOf(RpcError)
    expect(fake.calls).toHaveLength(1)
    expect(observed.snapshots).toEqual([])
    expect(observed.errors).toEqual([])
    observed.client.dispose()
  })

  test.each([
    ['invalid request', new RpcError('invalid queue pagination cursor', -32600)],
    ['invalid input variant', new RpcError('unknown variant "bad-input", expected "thread/queue/add"', -32600)],
    ['invalid params', new RpcError('unknown variant "thread/queue/list"', -32602)],
    ['timeout', new RpcError('请求超时')],
    ['ordinary Error', new Error('unknown variant "thread/queue/list"')]
  ])('transient errors preserve unknown/supported modes and the last good snapshot: %s', async (_name, failure) => {
    let fail = true
    const fake = transport(() => { if (fail) throw failure; return { data: [item('saved')], nextCursor: null } })
    const observed = observe(fake.rpc)
    await expect(observed.client.refresh('thread')).rejects.toBe(failure)
    expect(observed.client.mode).toBe('unknown')
    expect(fake.calls).toHaveLength(1)
    expect(observed.errors).toHaveLength(1)
    fail = false
    expect(await observed.client.refresh('thread')).toBe(true)
    fail = true
    await expect(observed.client.refresh('thread')).rejects.toBe(failure)
    expect(observed.client.mode).toBe('supported')
    expect(observed.snapshots).toEqual([{ threadId: 'thread', items: [item('saved')] }])
    expect(observed.errors).toHaveLength(2)
    expect(fake.calls).toHaveLength(3)
    observed.client.dispose()
  })

  test('background notification refreshes are reported, recover on the next notification, and never reject unhandled', async () => {
    let fail = true
    const fake = transport(() => { if (fail) throw new RpcError('offline'); return { data: [item('remote')], nextCursor: null } })
    const observed = observe(fake.rpc)
    observed.client.notification('thread')
    await settle()
    expect(observed.errors).toHaveLength(1)
    expect(observed.client.mode).toBe('unknown')
    fail = false
    observed.client.notification('thread')
    await settle()
    expect(observed.snapshots).toEqual([{ threadId: 'thread', items: [item('remote')] }])
    expect(observed.client.mode).toBe('supported')
    observed.client.dispose()
  })

  test('ack invalidates an in-flight snapshot even without a subscription notification', async () => {
    const stale = deferred<unknown>(), ack = deferred<unknown>()
    let lists = 0, resolved = false
    const fake = transport(({ method }) => method === 'thread/queue/add' ? ack.promise : ++lists === 1 ? stale.promise : { data: [item('new')], nextCursor: null })
    const observed = observe(fake.rpc)
    const refresh = observed.client.refresh('thread')
    await settle()
    const mutation = observed.client.add('thread', input('new'), 'client-new').then(() => { resolved = true })
    await settle()
    expect(resolved).toBe(false)
    expect(observed.snapshots).toEqual([])
    ack.resolve({ queuedSubmission: item('new') })
    await settle()
    stale.resolve({ data: [item('old')], nextCursor: null })
    await mutation
    expect(await refresh).toBe(true)
    expect(observed.snapshots).toEqual([{ threadId: 'thread', items: [item('new')] }])
    expect(fake.calls.map(call => call.method)).toEqual(['thread/queue/list', 'thread/queue/add', 'thread/queue/list'])
    observed.client.dispose()
  })

  test('reads all opaque-cursor pages and merges duplicate IDs with the latest value in original order', async () => {
    const rich: ServerQueuedSubmission = { id: 'rich', clientUserMessageId: 'rich-client', input: [
      { type: 'text', text: 'photo', text_elements: [{ byteRange: { start: 0, end: 5 }, placeholder: 'photo' }] },
      { type: 'localImage', path: '/tmp/photo.png' }, { type: 'image', url: 'data:image/png;base64,AA==' },
    ] }
    const fake = transport(({ params }) => {
      if (params.cursor === null) return { data: [item('a'), rich], nextCursor: 'opaque:two' }
      if (params.cursor === 'opaque:two') return { data: [item('b'), item('a', 'new value')], nextCursor: 'opaque:three' }
      if (params.cursor === 'opaque:three') return { data: [item('c')], nextCursor: null }
      throw new Error('Unexpected cursor')
    })
    const observed = observe(fake.rpc)
    expect(await observed.client.refresh('thread')).toBe(true)
    expect(observed.snapshots).toEqual([{ threadId: 'thread', items: [item('a', 'new value'), rich, item('b'), item('c')] }])
    expect(fake.calls.map(call => call.params)).toEqual([
      { threadId: 'thread', limit: 100, cursor: null },
      { threadId: 'thread', limit: 100, cursor: 'opaque:two' },
      { threadId: 'thread', limit: 100, cursor: 'opaque:three' },
    ])
    observed.client.dispose()
  })
  test('coalesces reads and notification bursts, discards stale responses, and drains the last change', async () => {
    const pages = Array.from({ length: 3 }, () => deferred<unknown>())
    let index = 0
    const fake = transport(() => pages[index++].promise), observed = observe(fake.rpc)
    const first = observed.client.refresh('thread'), concurrent = observed.client.refresh('thread')
    await settle()
    expect(fake.calls).toHaveLength(1)
    for (let i = 0; i < 10; i++) observed.client.notification('thread')
    pages[0].resolve({ data: [item('stale')], nextCursor: null })
    await settle()
    expect(observed.snapshots).toEqual([])
    expect(fake.calls).toHaveLength(2)
    observed.client.notification('thread')
    pages[1].resolve({ data: [item('also-stale')], nextCursor: null })
    await settle()
    expect(observed.snapshots).toEqual([])
    expect(fake.calls).toHaveLength(3)
    pages[2].resolve({ data: [item('latest')], nextCursor: null })
    expect(await first).toBe(true)
    expect(await concurrent).toBe(true)
    expect(observed.snapshots).toEqual([{ threadId: 'thread', items: [item('latest')] }])
    expect(observed.errors).toEqual([])
    observed.client.dispose()
  })
  test('two clients share server-owned additions, edits, and deletions without dispatching turns', async () => {
    const server = new QueueServer(), a = server.connect(), b = server.connect()
    expect(a.client.mode).toBe('unknown')
    expect(await a.client.refresh('thread')).toBe(true)
    expect(await b.client.refresh('thread')).toBe(true)
    await a.client.add('thread', input('from device A'), 'message-A')
    await settle()
    const added = { id: 'q-1', input: input('from device A'), clientUserMessageId: 'message-A' }
    expect(a.snapshots.at(-1)).toEqual({ threadId: 'thread', items: [added] })
    expect(b.snapshots.at(-1)).toEqual(a.snapshots.at(-1))
    await b.client.update('thread', 'q-1', input('edited on device B'))
    await settle()
    expect(a.snapshots.at(-1)?.items).toEqual([{ ...added, input: input('edited on device B') }])
    expect(b.snapshots.at(-1)).toEqual(a.snapshots.at(-1))
    await a.client.remove('thread', 'q-1')
    await settle()
    expect(a.snapshots.at(-1)?.items).toEqual([])
    expect(b.snapshots.at(-1)?.items).toEqual([])
    // An already-dispatched/deleted item is also a successful, idempotent delete ack.
    await b.client.remove('thread', 'q-1')
    expect(a.client.mode).toBe('supported')
    expect(a.errors).toEqual([])
    expect(b.errors).toEqual([])
    expect(server.transport.calls.filter(call => call.method !== 'thread/queue/list').map(({ method, params }) => ({ method, params }))).toEqual([
      { method: 'thread/queue/add', params: { threadId: 'thread', input: input('from device A'), clientUserMessageId: 'message-A' } },
      { method: 'thread/queue/update', params: { threadId: 'thread', queuedSubmissionId: 'q-1', input: input('edited on device B') } },
      { method: 'thread/queue/delete', params: { threadId: 'thread', queuedSubmissionId: 'q-1' } },
      { method: 'thread/queue/delete', params: { threadId: 'thread', queuedSubmissionId: 'q-1' } },
    ])
    a.client.dispose(); b.client.dispose()
  })
})
