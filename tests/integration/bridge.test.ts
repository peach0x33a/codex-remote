import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'
import { createBridge } from '../../server/bridge'

const origin = 'http://codex.test'
const accessKey = 'integration-access-key-long'
let app: ReturnType<typeof createBridge>
let mock: ReturnType<typeof Bun.serve>
let base: string
let upstreamHeaders: Headers
let session = ''
const post = (path: string, body: unknown, cookie = session, from = origin) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: from, Cookie: cookie }, body: JSON.stringify(body) })

function wsMessages(url: string, cookie = session) {
  const ws = new WebSocket(url, { headers: { Origin: origin, Cookie: cookie } })
  const messages: unknown[] = []
  let resolver: ((message: unknown) => void) | undefined
  ws.on('message', data => { const value = JSON.parse(data.toString()); if (resolver) { const resolve = resolver; resolver = undefined; resolve(value) } else messages.push(value) })
  const next = () => messages.length ? Promise.resolve(messages.shift()) : new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket response timeout')), 5000)
    resolver = value => { clearTimeout(timer); resolve(value) }
  })
  return { ws, next }
}

beforeAll(async () => {
  mock = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request, server) { upstreamHeaders = request.headers; if (request.headers.get('origin')) return new Response('No Origin permitted', { status: 403 }); if (server.upgrade(request, { data: undefined })) return; return new Response('Bad request', { status: 400 }) }, websocket: { message(ws, message) { const data = JSON.parse(String(message)); ws.send(JSON.stringify({ id: data.id, result: { echo: data.params, method: data.method } })) } } })
  app = createBridge({ host: '127.0.0.1', port: 0, origins: [origin], accessKey })
  base = 'http://127.0.0.1:' + app.server.port
  const response = await post('/api/session', { key: accessKey }, '')
  session = response.headers.get('set-cookie')!.split(';')[0]
})
afterAll(() => { app?.stop(); mock?.stop(true) })

describe('authenticated connection bridge', () => {
  test('requires authentication and rejects a foreign Origin', async () => {
    expect((await post('/api/connect', { endpoint: 'ws://localhost:1234' }, '')).status).toBe(401)
    expect((await post('/api/connect', { endpoint: 'ws://localhost:1234' }, session, 'https://attacker.example')).status).toBe(403)
    expect((await post('/api/session', { key: 'wrong' }, '')).status).toBe(401)
  })
  test('uses a no-store, one-use ticket; supplies Bearer without browser Origin', async () => {
    const response = await post('/api/connect', { endpoint: 'ws://127.0.0.1:' + mock.port, token: 'test-capability-token' })
    expect(response.headers.get('cache-control')).toBe('no-store')
    const { ticket } = await response.json()
    const { ws, next } = wsMessages(base.replace('http:', 'ws:') + '/api/socket?ticket=' + ticket)
    try {
      expect(await next()).toEqual({ method: 'bridge/ready', params: {} })
      expect(upstreamHeaders.get('origin')).toBeNull()
      expect(upstreamHeaders.get('authorization')).toBe('Bearer test-capability-token')
      ws.send(JSON.stringify({ id: 7, method: 'initialize', params: { clientInfo: { name: 'test' } } }))
      expect(await next()).toEqual({ id: 7, result: { echo: { clientInfo: { name: 'test' } }, method: 'initialize' } })
      const reused = await fetch(base + '/api/socket?ticket=' + ticket, { headers: { Origin: origin, Cookie: session } })
      expect(reused.status).toBe(401)
    } finally { ws.close() }
  })
  test('rejects credentials in URLs and non-WebSocket transports', async () => {
    for (const endpoint of ['http://127.0.0.1', 'wss://user:secret@host', 'wss://host/?token=secret']) expect((await post('/api/connect', { endpoint })).status).toBe(400)
  })
  test('enforces an optional host allowlist and Unix policy', async () => {
    const restricted = createBridge({ port: 0, origins: [origin], allowedHosts: ['allowed.example'], allowUnix: false })
    try {
      for (const endpoint of ['ws://denied.example', 'unix:///tmp/denied.sock']) {
        const response = await fetch('http://127.0.0.1:' + restricted.server.port + '/api/connect', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint }) })
        expect(response.status).toBe(400)
      }
    } finally { restricted.stop() }
  })
  test('bridges a real WebSocket handshake over a Unix socket', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'codex-remote-test-'))
    const socket = join(dir, 'app.sock')
    const http = createServer()
    const unix = new WebSocketServer({ server: http })
    unix.on('connection', ws => ws.on('message', raw => ws.send(raw.toString())))
    await new Promise<void>(resolve => http.listen(socket, resolve))
    const response = await post('/api/connect', { endpoint: 'unix://' + socket })
    const { ticket } = await response.json()
    const { ws, next } = wsMessages(base.replace('http:', 'ws:') + '/api/socket?ticket=' + ticket)
    try {
      expect(await next()).toEqual({ method: 'bridge/ready', params: {} })
      ws.send(JSON.stringify({ id: 9, result: 'unix works' }))
      expect(await next()).toEqual({ id: 9, result: 'unix works' })
    } finally { ws.terminate(); unix.close(); http.close(); await rm(dir, { recursive: true, force: true }) }
  })
})
