import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { resolve, sep } from 'node:path'
import Upstream from 'ws'
import type { ServerWebSocket } from 'bun'
import { CredentialError, CredentialStore, credentialEndpoint, credentialId, credentialToken } from './credentials'

type Options = { host?: string; port?: number; origins: string[]; accessKey?: string; allowedHosts?: string[]; allowUnix?: boolean; staticDir?: string; credentialFile?: string }
type Ticket = { endpoint: string; token: string; expires: number; session: string }
type Peer = { ticket: Ticket; upstream?: Upstream; queue: string[]; queuedBytes: number; closed: boolean }
const COOKIE = 'codex_remote_session'
const MAX_MESSAGE = 4 * 1024 * 1024
const MAX_BODY = 16 * 1024

async function requestJson(request: Request) {
  if (Number(request.headers.get('content-length')) > MAX_BODY) throw new CredentialError('请求体过大。', 413)
  const reader = request.body?.getReader()
  if (!reader) throw new CredentialError('无效的请求。')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BODY) { await reader.cancel(); throw new CredentialError('请求体过大。', 413) }
      chunks.push(value)
    }
  } catch (error) {
    if (error instanceof CredentialError) throw error
    throw new CredentialError('无效的请求。')
  } finally { reader.releaseLock() }
  try { return JSON.parse(Buffer.concat(chunks, size).toString('utf8')) } catch { throw new CredentialError('无效的请求。') }
}

export function createBridge(options: Options) {
  const credentials = new CredentialStore(options.credentialFile ?? '.local/credentials.json')
  const staticRoot = resolve(options.staticDir || 'dist')
  if (credentials.file === staticRoot || credentials.file.startsWith(staticRoot + sep)) throw new Error('凭证文件必须位于静态资源目录之外。')
  const tickets = new Map<string, Ticket>()
  const sessions = new Map<string, number>()
  const failures = new Map<string, { count: number; until: number }>()
  const peers = new Set<ServerWebSocket<Peer>>()
  const digest = (text: string) => createHash('sha256').update(text).digest()
  const equal = (a: string, b: string) => timingSafeEqual(digest(a), digest(b))
  const secure = options.origins.every(origin => origin.startsWith('https://'))
  const cookie = (value: string, age = 43200) => COOKIE + '=' + value + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=' + age + (secure ? '; Secure' : '')
  const sessionId = (request: Request) => request.headers.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1) || ''
  const authenticated = (request: Request) => !options.accessKey || (sessions.get(sessionId(request)) || 0) > Date.now()
  const sameOrigin = (request: Request) => options.origins.includes(request.headers.get('origin') || '')
  const json = (data: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } })
  const connectionEndpoint = (value: unknown) => {
    const endpoint = credentialEndpoint(value)
    const parsed = new URL(endpoint)
    if (parsed.protocol === 'unix:' && options.allowUnix === false) throw new CredentialError('此部署未启用 Unix socket 连接。')
    if (parsed.protocol !== 'unix:' && options.allowedHosts?.length && !options.allowedHosts.includes(parsed.hostname)) throw new CredentialError('此主机不在服务器允许连接的列表中。')
    return endpoint
  }
  const configurationError = (error: unknown) => error instanceof CredentialError
    ? json({ error: error.message }, error.status)
    : json({ error: '无法处理连接配置。' }, 500)
  const failPeer = (peer: ServerWebSocket<Peer>, message: string) => {
    if (peer.data.closed) return
    peer.send(JSON.stringify({ method: 'bridge/error', params: { message } }))
    peer.close(1011, 'Upstream connection failed')
  }
  const clean = setInterval(() => {
    const now = Date.now()
    for (const [key, ticket] of tickets) if (ticket.expires < now) tickets.delete(key)
    for (const [key, expires] of sessions) if (expires < now) sessions.delete(key)
    for (const [key, limit] of failures) if (limit.until < now) failures.delete(key)
    for (const peer of peers) if (options.accessKey && (sessions.get(peer.data.ticket.session) || 0) < now) peer.close(4001, 'Session expired')
  }, 15_000)
  clean.unref()

  const server = Bun.serve<Peer>({
    hostname: options.host || '127.0.0.1', port: options.port ?? 3000,
    maxRequestBodySize: MAX_BODY,
    async fetch(request, server) {
      const url = new URL(request.url)
      const path = url.pathname
      if (path === '/api/health' && request.method === 'GET') return json({ ok: true })
      if (path === '/api/session' && request.method === 'GET') return json({ authenticated: authenticated(request), requiresKey: !!options.accessKey })
      if (path.startsWith('/api/')) {
        if (!sameOrigin(request)) return json({ error: '请求来源不受信任，请从配置的应用地址打开。' }, 403)
        if (path !== '/api/socket' && request.method !== 'DELETE' && !request.headers.get('content-type')?.includes('application/json')) return json({ error: '需要 JSON 请求。' }, 415)
        if (path === '/api/session' && request.method === 'POST') {
          const ip = server.requestIP(request)?.address || 'unknown'
          const limit = failures.get(ip)
          if (limit && limit.until > Date.now() && limit.count >= 8) return json({ error: '尝试次数过多，请一分钟后重试。' }, 429)
          let body: { key?: string }
          try { body = await requestJson(request) } catch { return json({ error: '无效的请求。' }, 400) }
          if (typeof body?.key !== 'string' || (options.accessKey && !equal(body.key, options.accessKey))) {
            failures.set(ip, { count: (limit && limit.until > Date.now() ? limit.count : 0) + 1, until: Date.now() + 60_000 })
            return json({ error: '访问密码不正确，请重试。' }, 401)
          }
          failures.delete(ip)
          const key = randomBytes(32).toString('hex')
          sessions.set(key, Date.now() + 43_200_000)
          return json({ authenticated: true }, 200, { 'Set-Cookie': cookie(key) })
        }
        if (!authenticated(request)) return json({ error: '请先输入此应用的访问密码。' }, 401)
        if (path === '/api/session' && request.method === 'DELETE') {
          const id = sessionId(request)
          sessions.delete(id)
          for (const [key, ticket] of tickets) if (ticket.session === id) tickets.delete(key)
          for (const peer of peers) if (peer.data.ticket.session === id) peer.close(4001, 'Signed out')
          return json({ ok: true }, 200, { 'Set-Cookie': cookie('', 0) })
        }
        if (path === '/api/credentials' && (request.method === 'POST' || request.method === 'DELETE')) {
          if (!request.headers.get('content-type')?.includes('application/json')) return json({ error: '需要 JSON 请求。' }, 415)
          try {
            const body = await requestJson(request) as { endpoint?: unknown; token?: unknown; credentialId?: unknown }
            if (request.method === 'DELETE') {
              await credentials.remove(credentialId(body?.credentialId))
              return json({ ok: true })
            }
            const endpoint = connectionEndpoint(body?.endpoint)
            const token = credentialToken(body?.token, true)
            const id = body.credentialId === undefined ? undefined : credentialId(body.credentialId)
            return json({ credentialId: await credentials.save(endpoint, token, id) })
          } catch (error) { return configurationError(error) }
        }
        if (path === '/api/connect' && request.method === 'POST') {
          if (tickets.size >= 100 || peers.size >= 100) return json({ error: '连接过多，请稍后重试。' }, 429)
          try {
            const body = await requestJson(request) as { endpoint?: unknown; token?: unknown; credentialId?: unknown }
            const endpoint = connectionEndpoint(body?.endpoint)
            const token = body.credentialId !== undefined
              ? await credentials.token(credentialId(body.credentialId), endpoint)
              : credentialToken(body.token)
            if (tickets.size >= 100 || peers.size >= 100) return json({ error: '连接过多，请稍后重试。' }, 429)
            const ticket = randomBytes(32).toString('hex')
            tickets.set(ticket, { endpoint, token, expires: Date.now() + 30_000, session: sessionId(request) })
            return json({ ticket })
          } catch (error) { return configurationError(error) }
        }
        if (path === '/api/socket' && request.method === 'GET') {
          const key = url.searchParams.get('ticket') || ''
          const ticket = tickets.get(key)
          if (!ticket || ticket.expires < Date.now() || ticket.session !== sessionId(request)) return json({ error: '连接凭证已过期，请重新连接。' }, 401)
          tickets.delete(key)
          if (server.upgrade(request, { data: { ticket, queue: [], queuedBytes: 0, closed: false } })) return
          return json({ error: '需要 WebSocket 连接。' }, 400)
        }
        return json({ error: '接口不存在。' }, 404)
      }
      if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 })
      const root = staticRoot
      let decoded: string
      try { decoded = decodeURIComponent(path) } catch { return new Response('Bad path', { status: 400 }) }
      const candidate = resolve(root, '.' + decoded)
      if (!candidate.startsWith(root + sep) && candidate !== root) return new Response('Forbidden', { status: 403 })
      let file = Bun.file(candidate)
      if (path === '/' || !(await file.exists())) {
        if (path !== '/' && !request.headers.get('accept')?.includes('text/html')) return new Response('Not found', { status: 404 })
        file = Bun.file(resolve(root, 'index.html'))
        if (!(await file.exists())) return new Response('请先运行 bun run build；开发模式使用 http://localhost:5173。', { status: 503 })
      }
      return new Response(request.method === 'HEAD' ? null : file, { headers: {
        'Content-Type': file.type,
        'Cache-Control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
        'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      } })
    },
    websocket: {
      maxPayloadLength: MAX_MESSAGE, idleTimeout: 120, sendPings: true,
      open(peer) {
        peers.add(peer)
        const { endpoint, token } = peer.data.ticket
        const url = new URL(endpoint)
        try {
          // Bun's ws compatibility layer supports ws+unix, but ignores socketPath.
          const upstream = new Upstream(url.protocol === 'unix:' ? 'ws+unix://' + decodeURIComponent(url.pathname) + ':/' : endpoint, {
            ...(token ? { headers: { Authorization: 'Bearer ' + token } } : {}),
            handshakeTimeout: 12_000, maxPayload: MAX_MESSAGE, followRedirects: false,
          })
          peer.data.upstream = upstream
          upstream.on('open', () => {
            if (peer.data.closed) { upstream.close(); return }
            peer.send(JSON.stringify({ method: 'bridge/ready', params: {} }))
            for (const message of peer.data.queue) upstream.send(message)
            peer.data.queue = []; peer.data.queuedBytes = 0
          })
          upstream.on('message', data => {
            if (peer.data.closed) return
            if (peer.send(data.toString()) === -1) failPeer(peer, '浏览器接收过慢，请重新连接以同步会话。')
          })
          upstream.on('error', error => failPeer(peer, /401|403/.test(error.message) ? 'App Server 拒绝了连接，请检查访问令牌和服务器认证配置。' : '无法连接 App Server。请检查服务是否运行、地址、TLS 证书或 Unix socket 权限。'))
          upstream.on('close', () => { if (!peer.data.closed) peer.close(1011, 'App Server disconnected') })
        } catch { failPeer(peer, '连接地址或传输配置无效。') }
      },
      message(peer, raw) {
        const message = typeof raw === 'string' ? raw : raw.toString()
        const upstream = peer.data.upstream
        if (upstream?.readyState === Upstream.OPEN) {
          if (upstream.bufferedAmount > MAX_MESSAGE) { failPeer(peer, 'App Server 接收过慢，请稍后重试。'); return }
          upstream.send(message)
        } else if (upstream?.readyState === Upstream.CONNECTING) {
          peer.data.queuedBytes += message.length
          if (peer.data.queuedBytes > 64 * 1024) { failPeer(peer, '连接等待队列已满。'); return }
          peer.data.queue.push(message)
        }
      },
      close(peer) {
        peer.data.closed = true
        peer.data.ticket.token = ''
        peer.data.queue = []
        const upstream = peer.data.upstream
        if (upstream && upstream.readyState !== Upstream.CLOSED) upstream.terminate()
        peers.delete(peer)
      },
    },
  })
  return { server, stop() { clearInterval(clean); for (const peer of peers) peer.close(1001, 'Server stopping'); server.stop(true); tickets.clear(); sessions.clear() } }
}
