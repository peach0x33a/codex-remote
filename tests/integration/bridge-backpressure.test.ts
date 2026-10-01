import { afterEach, expect, spyOn, test } from 'bun:test'
import type { ServerWebSocket } from 'bun'
import { createBridge } from '../../server/bridge'

type Peer = ServerWebSocket<any>
type Handler = { open(peer: Peer): void; drain(peer: Peer): void; close(peer: Peer): void; backpressureLimit: number }
const cleanup: (() => void)[] = []
afterEach(() => { for (const stop of cleanup.splice(0).reverse()) stop() })
async function until(check: () => boolean) { for (let i = 0; i < 500 && !check(); i++) await Bun.sleep(2); expect(check()).toBe(true) }

// The upstream is a real socket. Only downstream send statuses/buffer bytes are
// controlled so transient backpressure and its deadline are deterministic.
async function fixture() {
  let remote!: ServerWebSocket<undefined>, handler!: Handler
  const daemon = Bun.serve({ hostname: '127.0.0.1', port: 0,
    fetch(request, server) { if (server.upgrade(request, { data: undefined })) return; return new Response('Expected upgrade', { status: 400 }) },
    websocket: { open(socket) { remote = socket }, message() {} },
  })
  cleanup.push(() => daemon.stop(true))
  const fakeServer = { port: 0, stop() {} }
  const capture = spyOn(Bun, 'serve').mockImplementation(((options: { websocket: Handler }) => { handler = options.websocket; return fakeServer }) as unknown as typeof Bun.serve)
  let bridge: ReturnType<typeof createBridge>
  try { bridge = createBridge({ port: 0, origins: ['http://pressure.test'] }) } finally { capture.mockRestore() }
  cleanup.push(() => bridge.stop())
  let status = 1, buffered = 0
  const messages: string[] = [], closed: { code: number; reason: string }[] = []
  const peer = {
    data: { ticket: { endpoint: 'ws://127.0.0.1:' + daemon.port, token: '', session: '', expires: Date.now() + 30_000 }, queue: [], queuedBytes: 0, closed: false },
    getBufferedAmount: () => buffered,
    send(message: string) { messages.push(message); const next = status; status = 1; if (next === -1) buffered = 128; return next === 1 ? Buffer.byteLength(message) : next },
    close(code: number, reason: string) { closed.push({ code, reason }); handler.close(peer as unknown as Peer) },
  } as unknown as Peer
  handler.open(peer)
  await until(() => !!remote && messages.some(message => message.includes('bridge/ready')))
  return { peer, handler, messages, closed, send: (text: string) => remote.send(text), pressure: () => { status = -1 }, drop: () => { status = 0 }, buffered: (bytes: number) => { buffered = bytes } }
}

test('buffers a pressured burst in order and drains without dropping or duplicating frames', async () => {
  const f = await fixture()
  f.pressure(); f.send('first frame')
  await until(() => f.peer.data.browserBlocked === true)
  expect(f.closed).toEqual([])
  f.send('second frame'); f.send('third frame')
  await until(() => f.peer.data.browserQueue?.length === 2)
  expect(f.messages).not.toContain('second frame'); expect(f.messages).not.toContain('third frame')
  expect(f.messages.filter(message => message === 'first frame')).toHaveLength(1)
  f.buffered(0); f.pressure(); f.handler.drain(f.peer)
  expect(f.peer.data.browserBlocked).toBe(true)
  expect(f.peer.data.browserQueue).toEqual(['third frame'])
  expect(f.messages.filter(message => message === 'second frame')).toHaveLength(1)
  f.buffered(0); f.handler.drain(f.peer)
  expect(f.peer.data.browserBlocked).toBe(false)
  expect(f.peer.data.browserStall).toBeUndefined()
  expect(f.messages.slice(-3)).toEqual(['first frame', 'second frame', 'third frame'])
  expect(f.peer.data.browserQueuedBytes).toBe(0)
  expect(f.messages.filter(message => message === 'first frame')).toHaveLength(1)
  expect(f.closed).toEqual([])
})

test('disconnects for a genuinely dropped frame instead of mislabelling it as a speed measurement', async () => {
  const f = await fixture(); f.drop(); f.send('dropped')
  await until(() => f.closed.length === 1)
  expect(f.peer.data.closed).toBe(true)
  expect(f.messages.some(message => message.includes('未能接收消息'))).toBe(true)
  f.handler.drain(f.peer)
  expect(f.peer.data.browserStall).toBeUndefined()
})

test('bounds the combined native and application queues using UTF-8 byte lengths', async () => {
  const f = await fixture()
  f.peer.data.browserQueue = ['pending']
  f.peer.data.browserQueuedBytes = Buffer.byteLength('pending') + 16
  f.buffered(f.handler.backpressureLimit - f.peer.data.browserQueuedBytes - 18)
  f.send('中') // Three UTF-8 bytes plus 16 bytes overhead; string.length would undercount.
  await until(() => f.closed.length === 1)
  expect(f.closed[0]!.code).toBe(1013)
  expect(f.messages).not.toContain('中')
  expect(f.messages.some(message => message.includes('缓冲已满'))).toBe(true)
})

test('closes only a persistently blocked send buffer and clears the stall timer', async () => {
  const f = await fixture(), realTimeout = globalThis.setTimeout
  let expire: (() => void) | undefined
  const timer = spyOn(globalThis, 'setTimeout').mockImplementation(((callback: () => void, delay: number, ...args: unknown[]) => {
    if (delay === 30_000) { expire = callback; const handle = realTimeout(() => {}, 3_600_000); handle.unref(); return handle }
    return realTimeout(callback, delay, ...args)
  }) as typeof setTimeout)
  try {
    f.pressure(); f.send('held'); await until(() => !!expire)
    expect(f.closed).toEqual([])
    f.buffered(64); expire!()
    expect(f.closed).toEqual([]) // Progress grants another bounded observation interval.
    expire!()
    expect(f.closed[0]!.code).toBe(1013)
    expect(f.peer.data.browserStall).toBeUndefined()
    expect(f.messages.some(message => message.includes('没有发送进展'))).toBe(true)
  } finally { timer.mockRestore() }
})
