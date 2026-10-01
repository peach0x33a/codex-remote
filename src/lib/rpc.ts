import type { RpcId, RpcMessage } from '../../shared/protocol'

export class RpcError extends Error {
  constructor(message: string, public code?: number, public data?: unknown) { super(message); this.name = 'RpcError' }
}
type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; cleanup: () => void }
type RequestOptions = { signal?: AbortSignal; timeoutMs?: number }
type Handlers = { message: (message: RpcMessage) => void; close: (reason: string) => void }

export class RpcClient {
  private socket: WebSocket | null = null
  private pending = new Map<RpcId, Pending>()
  private sequence = 0
  private stopped = false
  private abort = new AbortController()
  private cancelConnect: ((error: Error) => void) | null = null
  constructor(private handlers: Handlers) {}

  async connect(endpoint: string, token: string, credentialId?: string) {
    const fetchTimeout = setTimeout(() => this.abort.abort(), 15_000)
    let response: Response
    try {
      response = await fetch('/api/connect', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentialId ? { endpoint, credentialId } : { endpoint, token }), signal: this.abort.signal,
      })
    } catch { throw new RpcError(this.stopped ? '连接已取消。' : '连接服务不可达，请检查网络或服务状态。') }
    finally { clearTimeout(fetchTimeout) }
    const data = await response.json() as { ticket?: string; error?: string }
    if (!response.ok || !data.ticket) throw new RpcError(data.error || '连接服务暂时不可用。', response.status)
    if (this.stopped) throw new RpcError('连接已取消。')
    const socket = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/socket?ticket=' + encodeURIComponent(data.ticket))
    this.socket = socket
    let errorReason = ''
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const finish = (error?: Error) => {
        if (settled) return
        settled = true; clearTimeout(timeout); this.cancelConnect = null
        if (error) reject(error); else resolve()
      }
      this.cancelConnect = error => finish(error)
      const timeout = setTimeout(() => { finish(new RpcError('连接超时，请检查 App Server 地址和网络。')); socket.close() }, 20_000)
      socket.onmessage = async event => {
        let message: RpcMessage
        try { message = JSON.parse(event.data) as RpcMessage } catch { errorReason = 'App Server 返回了无效的 JSON。'; finish(new RpcError(errorReason)); socket.close(); return }
        if (!message || typeof message !== 'object' || Array.isArray(message)) return
        if (message.method === 'bridge/ready') {
          try {
            await this.request('initialize', { clientInfo: { name: 'codex_remote_web', title: 'Codex Remote', version: '0.1.0' }, capabilities: { experimentalApi: true } })
            this.notify('initialized', {})
            finish()
          } catch (error) { finish(error instanceof Error ? error : new RpcError('初始化失败。')); socket.close() }
          return
        }
        if (message.method === 'bridge/error') {
          errorReason = typeof message.params?.message === 'string' ? message.params.message : '连接失败。'
          finish(new RpcError(errorReason)); return
        }
        if (message.method) { this.handlers.message(message); return }
        if (message.id !== undefined) {
          const pending = this.pending.get(message.id)
          if (!pending) return
          pending.cleanup(); this.pending.delete(message.id)
          if (message.error) pending.reject(new RpcError(message.error.code === -32001 ? 'App Server 繁忙，请稍后重试。' : message.error.message, message.error.code, message.error.data))
          else pending.resolve(message.result)
        }
      }
      socket.onerror = () => { errorReason ||= '无法连接应用服务，请检查网络或重新登录。' }
      socket.onclose = event => {
        const reason = errorReason || (event.code === 4001 ? '应用访问已过期，请重新登录。' : '与 App Server 的连接已断开。')
        finish(new RpcError(reason, event.code === 4001 ? 401 : undefined))
        this.rejectPending(new RpcError(reason))
        if (!this.stopped) this.handlers.close(reason)
      }
    })
  }
  request<T = unknown>(method: string, params: unknown = {}, options: RequestOptions = {}): Promise<T> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || this.stopped) return Promise.reject(new RpcError('尚未连接到 App Server。'))
    if (options.signal?.aborted) return Promise.reject(new DOMException('请求已取消', 'AbortError'))
    const id = ++this.sequence
    return new Promise<T>((resolve, reject) => {
      const fail = (error: Error) => { cleanup(); this.pending.delete(id); reject(error) }
      const cancel = () => fail(new DOMException('请求已取消', 'AbortError'))
      const timer = setTimeout(() => fail(new RpcError('请求超时：' + method + '。请重试或检查服务器状态。')), options.timeoutMs ?? 30_000)
      const cleanup = () => { clearTimeout(timer); options.signal?.removeEventListener('abort', cancel) }
      options.signal?.addEventListener('abort', cancel, { once: true })
      this.pending.set(id, { resolve: value => resolve(value as T), reject, cleanup })
      try { this.socket!.send(JSON.stringify({ id, method, params })) } catch (error) { fail(error instanceof Error ? error : new RpcError('发送请求失败。')) }
    })
  }
  notify(method: string, params: unknown) { this.send({ method, params }) }
  respond(id: RpcId, result: unknown) { this.send({ id, result }) }
  unsupported(id: RpcId) { this.send({ id, error: { code: -32601, message: 'This client does not implement this request.' } }) }
  private send(message: unknown) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || this.stopped) throw new RpcError('连接已断开，请重新连接。')
    this.socket.send(JSON.stringify(message))
  }
  private rejectPending(error: Error) { for (const p of this.pending.values()) { p.cleanup(); p.reject(error) }; this.pending.clear() }
  disconnect() {
    this.stopped = true; this.abort.abort()
    this.cancelConnect?.(new RpcError('连接已取消。'))
    this.rejectPending(new RpcError('连接已断开。'))
    this.socket?.close(); this.socket = null
  }
}
