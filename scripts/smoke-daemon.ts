// Read-only protocol smoke test against an explicitly supplied daemon endpoint.
// Does not start a turn, execute commands, or print thread contents or account data.
import { WebSocket } from 'ws'
import { createBridge } from '../server/bridge'
const endpoint = process.argv[2]
if (!endpoint) throw new Error('Usage: bun scripts/smoke-daemon.ts unix:///absolute/control.sock')
const origin = 'http://codex-remote-smoke.local'
const app = createBridge({ port: 0, origins: [origin] })
let socket: WebSocket | undefined
try {
  const response = await fetch('http://127.0.0.1:' + app.server.port + '/api/connect', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint }) })
  const body = await response.json()
  if (!response.ok) throw new Error(body.error)
  socket = new WebSocket('ws://127.0.0.1:' + app.server.port + '/api/socket?ticket=' + body.ticket, { headers: { Origin: origin } })
  let id = 0
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>()
  let ready: () => void
  let rejectReady: (error: Error) => void
  const connected = new Promise<void>((resolve, reject) => { ready = resolve; rejectReady = reject })
  socket.on('message', raw => {
    const message = JSON.parse(raw.toString())
    if (message.method === 'bridge/ready') ready()
    else if (message.method === 'bridge/error') rejectReady(new Error(message.params.message))
    else if (message.id !== undefined && pending.has(message.id)) {
      const p = pending.get(message.id)!
      pending.delete(message.id)
      if (message.error) p.reject(new Error(message.error.message)); else p.resolve(message.result)
    }
  })
  socket.on('error', error => rejectReady(error))
  const timeout = setTimeout(() => { for (const p of pending.values()) p.reject(new Error('Timed out')); rejectReady(new Error('Timed out')) }, 15_000)
  function request(method: string, params: unknown = {}) { return new Promise<any>((resolve, reject) => { const requestId = ++id; pending.set(requestId, { resolve, reject }); socket!.send(JSON.stringify({ id: requestId, method, params })) }) }
  try {
    await connected
    const handshake = await request('initialize', { clientInfo: { name: 'codex_remote_smoke', version: '0.1.0', title: 'Codex Remote Smoke Test' }, capabilities: { experimentalApi: true } })
    socket.send(JSON.stringify({ method: 'initialized', params: {} }))
    const models = await request('model/list', { limit: 1 })
    const threads = await request('thread/list', { limit: process.argv.includes('--history') ? 40 : 1 })
    if (!Array.isArray(models.data) || !Array.isArray(threads.data)) throw new Error('Invalid protocol responses')
    let history: Record<string, unknown> | undefined
    if (process.argv.includes('--history')) {
      const thread = threads.data.find((t: { status?: { type?: string } }) => ['idle', 'notLoaded'].includes(t.status?.type || ''))
      if (!thread) throw new Error('No inactive thread available for history verification')
      const start = performance.now()
      const resumed = await request('thread/resume', { threadId: thread.id, excludeTurns: true })
      const resumeMs = Math.round(performance.now() - start)
      const [turns, items, config] = await Promise.all([
        request('thread/turns/list', { threadId: thread.id, limit: 20, sortDirection: 'desc', itemsView: 'notLoaded' }),
        request('thread/items/list', { threadId: thread.id, limit: 60, sortDirection: 'desc' }),
        request('config/read', { includeLayers: false, cwd: thread.cwd }),
      ])
      if (!Array.isArray(turns.data) || !Array.isArray(items.data) || items.data.length > 60) throw new Error('Invalid paginated history response')
      history = { resumeMs, totalMs: Math.round(performance.now() - start), resumedTurns: resumed.thread.turns.length, turnMetadataCount: turns.data.length, recentItemsCount: items.data.length, hasEarlierItems: !!items.nextCursor, supportsAutoReview: 'approvals_reviewer' in config.config, reasoningItems: items.data.filter((entry: { item: { type: string } }) => entry.item.type === 'reasoning').length, reasoningWithContent: items.data.filter((entry: { item: { type: string; content?: string[] } }) => entry.item.type === 'reasoning' && entry.item.content?.some(text => text.length)).length }
    }
    console.log(JSON.stringify({ success: true, transport: new URL(endpoint).protocol, initialized: true, platformFamily: handshake.platformFamily, modelList: 'valid', threadList: 'valid', history, turnsStarted: 0 }, null, 2))
  } finally { clearTimeout(timeout) }
} finally { socket?.terminate(); app.stop() }
