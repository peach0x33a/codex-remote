import { randomId } from './random-id'
import type { Item, MessageContent } from '../../shared/protocol'
import { THREAD_REFERENCE_MARKER, threadReferenceContext, threadReferenceLink } from './mentions'
import { asyncRepliesFromItem } from './async-questions'
import { fileReference, parseFileReference, type FileAttachment } from './file-attachments'
export type PromptPart = { type: 'text'; text: string; pasteId?: string } | { type: 'image'; id: string; name: string; url: string; size: number; source?: MessageContent } | FileAttachment | { type: 'skill'; id: string; name: string; path: string } | { type: 'mention'; id: string; name: string; path: string; kind: 'plugin' | 'thread' | 'agent' }
export const pastedTextLabel = (text: string) => '粘贴的文本 (' + Array.from(text).length + '字符)'
export const isLongPaste = (text: string) => text.length >= 1000 || text.split('\n').length >= 12
export const promptText = (parts: PromptPart[]) => parts.map(p => p.type === 'text' ? p.text : p.type === 'skill' ? '$' + p.name : '[' + p.name + ']').join('')
export const hasPrompt = (parts: PromptPart[]) => parts.some(p => p.type !== 'text' || !!p.text.trim())
export function toInputs(parts: PromptPart[], deviceId?: string): MessageContent[] {
  const input: MessageContent[] = []
  const markedText = (text: string, placeholder: string): MessageContent => ({ type: 'text', text, text_elements: [{ byteRange: { start: 0, end: new TextEncoder().encode(text).length }, placeholder }] })
  const context = threadReferenceContext(parts.filter((part): part is Extract<PromptPart, { type: 'mention' }> => part.type === 'mention' && part.path.startsWith('thread://')).map(part => part.path))
  if (context) input.push(markedText(context, THREAD_REFERENCE_MARKER))
  for (const part of parts) {
    if (part.type === 'file') {
      if (deviceId !== undefined && part.deviceId !== deviceId) throw new Error('文件“' + part.name + '”属于另一台设备，请在当前设备重新添加。')
      input.push(markedText(fileReference(part), part.name))
      if (part.image) input.push({ type: 'localImage', path: part.path })
      continue
    }
    if (part.type === 'mention') {
      if (part.path.startsWith('thread://')) input.push(markedText(threadReferenceLink(part.name, part.path), part.name))
      else input.push(markedText('@' + part.name, part.name), { type: 'mention', name: part.name, path: part.path })
      continue
    }
    if (part.type === 'skill') { input.push(markedText('$' + part.name, part.name), { type: 'skill', name: part.name, path: part.path }); continue }
    if (part.type === 'text') { if (part.text) input.push(part.pasteId ? markedText(part.text, pastedTextLabel(part.text)) : { type: 'text', text: part.text, text_elements: [] }); continue }
    // text_elements is the App Server's native UI-placeholder mechanism. Keep filenames
    // in the recorded input without adding unsupported fields to the image union.
    const marker = '[Image: ' + part.name + ']'
    const image: MessageContent = part.source?.type === 'localImage' && part.source.path ? { type: 'localImage', path: part.source.path } : part.source?.fileId ? { type: 'image', fileId: part.source.fileId } : { type: 'image', url: part.url }
    input.push({ type: 'text', text: marker, text_elements: [{ byteRange: { start: 0, end: new TextEncoder().encode(marker).length }, placeholder: part.name }] }, image)
  }
  return input
}
export function messageParts(content: Item['content']): PromptPart[] {
  const result: PromptPart[] = [], input = content || []
  let imageName = '', imageIndex = 0
  for (let i = 0; i < input.length; i++) {
    const part = input[i], next = input[i + 1]
    if (typeof part === 'string') { result.push({ type: 'text', text: part }); continue }
    if (part.type === 'text') {
      const element = part.text_elements?.[0]
      if (part.text_elements?.length === 1 && element?.byteRange.start === 0 && element.byteRange.end === new TextEncoder().encode(part.text || '').length) {
        const file = parseFileReference(part.text || '', element.placeholder)
        if (file) { result.push(file); if (file.image && typeof next === 'object' && next?.type === 'localImage' && next.path === file.path) i++; continue }
        if (/^粘贴的文本 \(\d+字符\)$/.test(element.placeholder || '')) { result.push({ type: 'text', text: part.text || '', pasteId: 'paste-' + randomId() }); continue }
        if (element.placeholder === THREAD_REFERENCE_MARKER && part.text?.startsWith('## Referenced chats with Codex:')) continue
        if (next && typeof next === 'object' && ['skill', 'mention'].includes(next.type) && next.name === element.placeholder) continue
        const match = /^\[@[\s\S]*\]\((thread:\/\/[a-z0-9_-]{1,64})\)$/i.exec(part.text || '')
        if (match && element.placeholder) { result.push({ type: 'mention', id: 'mention-' + i, name: element.placeholder, path: match[1]!, kind: 'thread' }); continue }
      }
      if (part.text_elements?.length === 1 && element?.byteRange.start === 0 && element.byteRange.end === new TextEncoder().encode(part.text || '').length && element.placeholder && typeof next === 'object' && ['image', 'localImage'].includes(next.type)) { imageName = element.placeholder; continue }
      result.push({ type: 'text', text: part.text || '' })
    } else if (part.type === 'mention' && part.name && part.path) {
      result.push({ type: 'mention', id: 'mention-' + i, name: part.name, path: part.path, kind: part.path.startsWith('plugin://') ? 'plugin' : 'thread' })
    } else if (part.type === 'skill' && part.name && part.path) {
      result.push({ type: 'skill', id: 'skill-' + i, name: part.name, path: part.path })
    } else if (['image', 'localImage'].includes(part.type)) {
      imageIndex++
      result.push({ type: 'image', id: 'image-' + imageIndex, name: imageName || part.name || part.path?.split(/[\\/]/).pop() || '图片 ' + imageIndex, url: safeImageUrl(part.url), size: 0, source: { ...part } }); imageName = ''
    } else result.push({ type: 'text', text: '[' + (part.name || part.type) + ']' })
  }
  const last = result[result.length - 1]
  if (last?.type === 'text' && !last.pasteId) last.text = last.text.trimEnd()
  return result
}
export function safeImageUrl(url?: string) { return url && (/^data:image\/(png|jpeg|webp|gif);base64,/i.test(url) || /^https?:\/\//i.test(url)) ? url : '' }
export function textFragment(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'text' in value && typeof value.text === 'string') return value.text
  return ''
}
export function reasoningText(item?: Item): string {
  if (!item || item.type !== 'reasoning') return ''
  const summary = item.summary?.map(textFragment).filter(text => text.trim()).join('\n\n')
  const content = item.content?.map(textFragment).filter(text => text.trim()).join('\n\n')
  return summary || content || item.text || ''
}
export function reasoningPreview(item?: Item): string { return reasoningText(item).split(/\n\s*\n/).filter(s => s.trim()).at(-1)?.replace(/[*_#]/g, '').replace(/\s+/g, ' ').trim() || '' }
export function mergeItem(previous: Item | undefined, incoming: Item): Item {
  const item = { ...previous, ...incoming }
  if (item.type !== 'reasoning' || !previous) return item
  for (const field of ['summary', 'content'] as const) {
    const old = previous[field]?.map(textFragment) || [], next = incoming[field]?.map(textFragment) || []
    if (!old.some(text => text.trim())) continue
    const merged = Array.from({ length: Math.max(old.length, next.length) }, (_, index) => {
      const a = old[index] || '', b = next[index] || ''
      return !b.trim() || a.startsWith(b) ? a : b
    })
    item[field] = merged
  }
  return item
}


export function messageEditError(item: Item): string | undefined {
  if (item.type !== 'userMessage') return '只能编辑自己的消息。'
  if (asyncRepliesFromItem(item).length) return '这条问题回答暂不支持编辑，请通过新消息补充。'
  for (const part of item.content || []) {
    if (typeof part === 'string' || part.type === 'text') continue
    if (part.type === 'skill' && part.name && part.path) continue
    if (part.type === 'mention' && part.name && part.path && /^(plugin|thread):\/\//.test(part.path)) continue
    if (part.type === 'localImage' && part.path || part.type === 'image' && (part.fileId || safeImageUrl(part.url))) continue
    return '这条消息包含暂不支持编辑的附件类型。'
  }
  return undefined
}
