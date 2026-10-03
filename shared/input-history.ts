import type { MessageContent } from './protocol'
import { profileId, record } from './profiles'

export const INPUT_HISTORY_LIMIT = 100
export const INPUT_HISTORY_BODY_LIMIT = 4 * 1024 * 1024
export const INPUT_HISTORY_STORAGE_LIMIT = 16 * 1024 * 1024
export type InputHistoryEntry = { id: string; deviceId: string; createdAt: number; input: MessageContent[] }
const invalid = () => new Error('输入历史格式无效。')
const bytes = (text: string) => new TextEncoder().encode(text).length
const field = (value: unknown, max = 4096) => {
  if (typeof value !== 'string' || !value || value.length > max || /[\x00-\x1f\x7f]/.test(value)) throw invalid()
  return value
}

/** Store the native input union, including attachment order and UI placeholders. */
export function parseHistoryInput(value: unknown): MessageContent[] {
  if (!Array.isArray(value) || !value.length || value.length > 256) throw invalid()
  const input = value.map((part): MessageContent => {
    if (!record(part)) throw invalid()
    if (part.type === 'text') {
      if (typeof part.text !== 'string') throw invalid()
      const length = bytes(part.text), elements = part.text_elements ?? []
      if (!Array.isArray(elements) || elements.length > 256) throw invalid()
      const text_elements = elements.map(element => {
        if (!record(element) || !record(element.byteRange)) throw invalid()
        const { start, end } = element.byteRange
        if (typeof start !== 'number' || typeof end !== 'number' || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > length
          || !(element.placeholder === null || typeof element.placeholder === 'string' && element.placeholder.length <= 4096)) throw invalid()
        return { byteRange: { start, end }, placeholder: element.placeholder }
      })
      return { type: 'text', text: part.text, text_elements }
    }
    if (part.type === 'image') {
      if (part.fileId !== undefined) return { type: 'image', fileId: field(part.fileId) }
      const url = field(part.url, INPUT_HISTORY_BODY_LIMIT)
      if (!/^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(url) && !/^https?:\/\//i.test(url)) throw invalid()
      return { type: 'image', url }
    }
    if (part.type === 'localImage') return { type: 'localImage', path: field(part.path) }
    if (part.type === 'skill' || part.type === 'mention') return { type: part.type, name: field(part.name), path: field(part.path) }
    throw invalid()
  })
  if (!input.some(part => part.type !== 'text' || !!part.text?.trim()) || bytes(JSON.stringify(input)) > INPUT_HISTORY_BODY_LIMIT - 4096) throw invalid()
  return input
}
export function parseHistoryEntry(value: unknown): InputHistoryEntry {
  if (!record(value) || typeof value.createdAt !== 'number' || !Number.isFinite(value.createdAt) || value.createdAt < 0) throw invalid()
  return { id: field(value.id, 128), deviceId: profileId(value.deviceId), createdAt: value.createdAt, input: parseHistoryInput(value.input) }
}
export function parseHistoryEntries(value: unknown): InputHistoryEntry[] {
  if (!Array.isArray(value) || value.length > INPUT_HISTORY_LIMIT * 512 || bytes(JSON.stringify(value)) > INPUT_HISTORY_STORAGE_LIMIT) throw invalid()
  return value.map(parseHistoryEntry)
}
