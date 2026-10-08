import { parseHistoryInput } from '../../shared/input-history'
import type { MessageContent } from '../../shared/protocol'
import { RpcClient, RpcError } from './rpc'

export const STOPPED_INPUT_TYPE = 'codex_remote.stopped_input.v1'
export const STOPPED_INPUT_COMMIT_TYPE = 'codex_remote.stopped_input_commit.v1'
export type StoppedInput = { clientId: string; turnId: string; sourceTurnId: string; savedAtMs: number; input: MessageContent[]; priorUserIds: string[] }
export type StoppedInputSnapshot = { committed: StoppedInput[]; unconfirmed: StoppedInput[] }
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const id = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\x00-\x1f\x7f]/.test(value)
export function parseStoppedInput(value: unknown): StoppedInput {
  if (!record(value) || !id(value.clientId) || !id(value.turnId) || !id(value.sourceTurnId) || typeof value.savedAtMs !== 'number' || !Number.isFinite(value.savedAtMs) || value.savedAtMs < 0 || !Array.isArray(value.priorUserIds) || value.priorUserIds.length > 4096 || !value.priorUserIds.every(id)) throw new Error('已停止插话的记录无效。')
  return { clientId: value.clientId, turnId: value.turnId, sourceTurnId: value.sourceTurnId, savedAtMs: value.savedAtMs, input: parseHistoryInput(value.input), priorUserIds: value.priorUserIds }
}

/** Read independently persisted thread data; raw injection has no native item projection. */
export async function readStoppedInputs(rpc: RpcClient, threadId: string, signal?: AbortSignal): Promise<StoppedInputSnapshot> {
  const inputs = new Map<string, StoppedInput>(), commits = new Set<string>(), cursors = new Set<string>()
  let cursor: string | null = null
  for (let page = 0; page < 20; page++) {
    const result: unknown = await rpc.request('thread/attachment/list', { threadId, limit: 100, ...(cursor ? { cursor } : {}) }, { signal, timeoutMs: 10_000 })
    if (!record(result) || !Array.isArray(result.data) || result.data.length > 100 || !(result.nextCursor === null || id(result.nextCursor))) throw new Error('已停止插话的列表响应无效。')
    for (const entry of result.data) {
      if (!record(entry)) throw new Error('已停止插话的列表响应无效。')
      if (entry.attachmentType === STOPPED_INPUT_TYPE) {
        const input = parseStoppedInput(entry.payload)
        if (entry.identityKey !== input.clientId) throw new Error('已停止插话的标识不匹配。')
        inputs.set(input.clientId, input)
      } else if (entry.attachmentType === STOPPED_INPUT_COMMIT_TYPE && id(entry.identityKey)) commits.add(entry.identityKey)
    }
    cursor = result.nextCursor as string | null
    if (!cursor) {
      const ordered = [...inputs.values()].sort((a, b) => a.savedAtMs - b.savedAtMs)
      return { committed: ordered.filter(input => commits.has(input.clientId)), unconfirmed: ordered.filter(input => !commits.has(input.clientId)) }
    }
    if (cursors.has(cursor)) throw new Error('已停止插话的分页标记重复。')
    cursors.add(cursor)
  }
  throw new Error('已停止插话的记录过多，请缩小会话后重试。')
}

/** Responses input, preserving order and images. Paths stay available to Codex tools. */
export function stoppedResponseItem(input: StoppedInput) {
  const content: Record<string, unknown>[] = []
  for (const part of input.input) {
    if (part.type === 'text') content.push({ type: 'input_text', text: part.text || '' })
    else if (part.type === 'image') content.push({ type: 'input_image', ...(part.fileId ? { file_id: part.fileId } : { image_url: part.url }), detail: 'auto' })
    else if (part.type === 'localImage') content.push({ type: 'input_text', text: '[Image file: ' + JSON.stringify(part.path) + ']' })
    else if (part.type === 'audio') content.push({ type: 'input_audio', audio_url: part.url })
    else if (part.type === 'localAudio') content.push({ type: 'input_text', text: '[Audio file: ' + JSON.stringify(part.path) + ']' })
    else if (part.type === 'skill' || part.type === 'mention') content.push({ type: 'input_text', text: '[' + part.type + ': ' + JSON.stringify({ name: part.name, path: part.path }) + ']' })
    else throw new Error('这条插话包含暂不支持保存的内容。')
  }
  return { type: 'message', role: 'user', id: 'msg_' + input.clientId, content }
}

export function stoppedInputUnavailable(cause: unknown) {
  return cause instanceof RpcError && cause.code === -32601
    ? '任务已停止，但此服务端不支持只保存插话；消息已保留，可取回草稿。'
    : '任务已停止，但插话保存未确认；消息已保留，请查看会话后处理。' + (cause instanceof Error ? ' ' + cause.message : '')
}
