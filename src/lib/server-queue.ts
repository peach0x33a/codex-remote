import type { MessageContent, Turn } from '../../shared/protocol'
import { RpcError, type RpcClient } from './rpc'

export type ServerQueuedSubmission = { id: string; input: MessageContent[]; clientUserMessageId: string }

type QueueMode = 'unknown' | 'supported' | 'unsupported'
type Refresh = { dirty: boolean; promise: Promise<boolean> }
const PAGE_SIZE = 100
const MAX_PAGES = 100
const LIST_TIMEOUT_MS = 10_000
const SNAPSHOT_TIMEOUT_MS = 30_000

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function content(value: unknown): value is MessageContent {
  if (!record(value) || typeof value.type !== 'string' || !value.type) return false
  for (const key of ['text', 'url', 'path', 'fileId', 'name']) {
    if (value[key] !== undefined && typeof value[key] !== 'string') return false
  }
  if (value.text_elements !== undefined && (!Array.isArray(value.text_elements) || !value.text_elements.every(element =>
    record(element) && record(element.byteRange) &&
    Number.isSafeInteger(element.byteRange.start) && Number.isSafeInteger(element.byteRange.end) &&
    (element.byteRange.start as number) >= 0 && (element.byteRange.end as number) >= (element.byteRange.start as number) &&
    (element.placeholder === null || typeof element.placeholder === 'string'),
  ))) return false
  return true
}

function submission(value: unknown): value is ServerQueuedSubmission {
  return record(value) && typeof value.id === 'string' && value.id.length > 0 &&
    typeof value.clientUserMessageId === 'string' && Array.isArray(value.input) && value.input.every(content)
}

function invalidPage(reason: string): RpcError { return new RpcError('服务端队列响应无效：' + reason) }

function unavailable(error: unknown): boolean {
  return error instanceof RpcError && (error.code === -32601 || (error.code === -32600 && (
    /unknown variant\s+[\x60'"]thread\/queue\/(?:list|add|update|delete)[\x60'"]/i.test(error.message) ||
    /\bqueue (?:is )?unavailable\b/i.test(error.message)
  )))
}

/**
 * One instance per RPC connection. Automatic dispatch belongs exclusively to
 * Codex's queue extension: one item on idle/completed/failed, none on interrupt.
 * Queue changes and RPC acknowledgements are snapshot invalidations, not a
 * request for a browser to start/steer a turn. start() is explicit user recovery.
 */
export class ServerQueueClient {
  private capability: QueueMode = 'unknown'
  private disposed = false
  private readonly reads = new AbortController()
  private readonly refreshes = new Map<string, Refresh>()

  constructor(
    private readonly rpc: Pick<RpcClient, 'request'>,
    private readonly onSnapshot: (threadId: string, items: ServerQueuedSubmission[]) => void,
    private readonly onError: (message: string) => void,
  ) {}

  get mode(): QueueMode { return this.capability }

  /**
   * False means explicitly unsupported; transient failures are reported and reject without downgrading.
   * Reads coalesce per thread. Only complete snapshots publish (100 pages / 30 seconds per pass).
   * After disposal this returns the last known support state without sending a request.
   */
  async refresh(threadId: string): Promise<boolean> {
    if (!this.active()) return this.capability === 'supported'
    const existing = this.refreshes.get(threadId)
    if (existing) return existing.promise
    const refresh: Refresh = { dirty: false, promise: Promise.resolve(false) }
    // Register before invoking the transport or callbacks, including synchronous fakes.
    this.refreshes.set(threadId, refresh)
    refresh.promise = Promise.resolve().then(() => this.drain(threadId, refresh))
    return refresh.promise
  }

  add(threadId: string, input: MessageContent[], clientUserMessageId: string): Promise<void> {
    return this.mutate('thread/queue/add', threadId, { threadId, input, clientUserMessageId })
  }

  update(threadId: string, id: string, input: MessageContent[]): Promise<void> {
    return this.mutate('thread/queue/update', threadId, { threadId, queuedSubmissionId: id, input })
  }

  remove(threadId: string, id: string): Promise<void> {
    return this.mutate('thread/queue/delete', threadId, { threadId, queuedSubmissionId: id })
  }

  async start(threadId: string): Promise<Turn> {
    if (this.disposed) throw new RpcError('服务端队列客户端已释放。')
    // Do not retry or downgrade the whole queue if this optional method fails.
    const response = await this.rpc.request<{ turn: Turn }>('thread/queue/start', { threadId })
    if (!record(response) || !record(response.turn) || typeof response.turn.id !== 'string' || !response.turn.id || typeof response.turn.status !== 'string') {
      throw new RpcError('启动队列的响应无效，发送结果未确认。请查看会话后重试。')
    }
    if (!this.disposed) { try { await this.invalidate(threadId) } catch { /* A read failure must not turn an accepted start into a failed send. */ } }
    return response.turn
  }

  notification(threadId: string): void { void this.invalidate(threadId).catch(() => {}) }

  dispose(): void {
    this.disposed = true
    this.reads.abort()
    this.refreshes.clear()
  }

  private active(): boolean { return !this.disposed && this.capability !== 'unsupported' }

  private invalidate(threadId: string): Promise<boolean> {
    const refresh = this.refreshes.get(threadId)
    if (refresh) refresh.dirty = true
    return this.refresh(threadId)
  }

  private async drain(threadId: string, refresh: Refresh): Promise<boolean> {
    try {
      while (this.active()) {
        refresh.dirty = false
        let items: ServerQueuedSubmission[] | null
        try {
          items = await this.readSnapshot(threadId, refresh)
        } catch (error) {
          if (!this.active()) return this.capability === 'supported'
          if (unavailable(error)) { this.capability = 'unsupported'; return false }
          this.report('服务端队列刷新失败（' + threadId + '）：' + (error instanceof Error ? error.message : String(error)))
          if (refresh.dirty) continue
          throw error
        }
        if (!this.active()) return this.capability === 'supported'
        // A notification/ack invalidates the whole read, not just its last page.
        if (refresh.dirty || items === null) continue
        this.capability = 'supported'
        try { this.onSnapshot(threadId, items) } catch (error) {
          this.report('队列快照回调失败：' + (error instanceof Error ? error.message : String(error)))
        }
        // A notification raised synchronously by a callback also needs a trailing read.
        if (!refresh.dirty) return true
      }
      return this.capability === 'supported'
    } finally {
      if (this.refreshes.get(threadId) === refresh) this.refreshes.delete(threadId)
    }
  }

  private async readSnapshot(threadId: string, refresh: Refresh): Promise<ServerQueuedSubmission[] | null> {
    const items = new Map<string, ServerQueuedSubmission>(), cursors = new Set<string>()
    const deadline = Date.now() + SNAPSHOT_TIMEOUT_MS
    let cursor: string | null = null
    // Never publish a partial snapshot: a loop, malformed page, or cap breach is a read failure.
    for (let page = 0; page < MAX_PAGES; page++) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) throw invalidPage('分页读取超时，未发布不完整快照。')
      const response: unknown = await this.rpc.request<unknown>(
        'thread/queue/list', { threadId, limit: PAGE_SIZE, cursor },
        { signal: this.reads.signal, timeoutMs: Math.min(LIST_TIMEOUT_MS, remaining) },
      )
      if (!this.active() || refresh.dirty) return null
      if (Date.now() >= deadline) throw invalidPage('分页读取超时，未发布不完整快照。')
      if (!record(response) || !Array.isArray(response.data) || response.data.length > PAGE_SIZE) throw invalidPage('data')
      for (const entry of response.data) {
        if (!submission(entry)) throw invalidPage('queued submission')
        // Later duplicates replace their content while retaining the first occurrence's order.
        items.set(entry.id, { id: entry.id, input: entry.input, clientUserMessageId: entry.clientUserMessageId })
      }
      const next: unknown = response.nextCursor
      if (next === null) return [...items.values()]
      if (typeof next !== 'string' || !next.trim() || cursors.has(next)) throw invalidPage('nextCursor')
      cursors.add(next)
      cursor = next
    }
    throw invalidPage('超过 ' + MAX_PAGES + ' 页，未发布不完整快照。')
  }

  private async mutate(method: string, threadId: string, params: unknown): Promise<void> {
    if (this.disposed) throw new RpcError('服务端队列客户端已释放。')
    if (this.capability === 'unsupported') throw new RpcError('服务端不支持消息队列。', -32601)
    // Never retry an uncertain mutation, including timeouts: it may already be committed.
    try { await this.rpc.request(method, params) } catch (error) {
      if (!this.disposed && unavailable(error)) this.capability = 'unsupported'
      throw error
    }
    if (this.disposed) return
    if (this.active()) this.capability = 'supported'
    // The mutation succeeded at the RPC ack. A failed read must not invite resubmission.
    try {
      if (!await this.invalidate(threadId)) this.report('服务端已确认队列操作，但队列刷新不可用。请勿重复发送。')
    } catch { /* refresh already reported the read failure */ }
  }

  private report(message: string): void {
    if (!this.disposed) {
      try { this.onError(message) } catch { /* A UI callback must not turn an ack into a failed send. */ }
    }
  }
}
