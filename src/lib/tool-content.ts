import type { Item } from '../../shared/protocol'

export type ToolContent = { type: 'text'; text: string } | { type: 'image'; src: string; name: string; fileId?: string } | { type: 'audio'; src: string; name: string } | { type: 'link'; url: string; name: string } | { type: 'unknown'; value: unknown }
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
function content(value: unknown, index: number): ToolContent {
  if (typeof value === 'string') return { type: 'text', text: value }
  if (!record(value)) return { type: 'unknown', value }
  const name = typeof value.name === 'string' ? value.name : '图片 ' + (index + 1)
  if (['text', 'input_text', 'inputText'].includes(String(value.type)) && typeof value.text === 'string') return { type: 'text', text: value.text }
  if (['image', 'input_image', 'inputImage'].includes(String(value.type))) {
    const url = value.url ?? value.image_url ?? value.imageUrl
    const fileId = value.fileId ?? value.file_id
    if (typeof url === 'string' || typeof fileId === 'string') return { type: 'image', src: typeof url === 'string' ? url : '', name, ...(typeof fileId === 'string' ? { fileId } : {}) }
    if (typeof value.data === 'string' && typeof value.mimeType === 'string' && /^image\/(png|jpeg|gif|webp|svg\+xml)$/.test(value.mimeType)) return { type: 'image', src: 'data:' + value.mimeType + ';base64,' + value.data, name }
  }
  if (['audio', 'input_audio', 'inputAudio'].includes(String(value.type))) {
    const url = value.url ?? value.audio_url ?? value.audioUrl
    if (typeof url === 'string') return { type: 'audio', src: url, name: '音频 ' + (index + 1) }
    if (typeof value.data === 'string' && typeof value.mimeType === 'string' && /^audio\/(wav|x-wav|mpeg|mp3|ogg|flac|mp4|webm)$/.test(value.mimeType)) return { type: 'audio', src: 'data:' + value.mimeType + ';base64,' + value.data, name: '音频 ' + (index + 1) }
  }
  if (value.type === 'resource_link' && typeof value.uri === 'string') return { type: 'link', url: value.uri, name: typeof value.name === 'string' ? value.name : value.uri }
  if (value.type === 'resource' && record(value.resource)) {
    const resource = value.resource
    if (typeof resource.text === 'string') return { type: 'text', text: resource.text }
    if (typeof resource.blob === 'string' && typeof resource.mimeType === 'string') return content({ type: resource.mimeType.startsWith('audio/') ? 'audio' : 'image', data: resource.blob, mimeType: resource.mimeType, name }, index)
  }
  return { type: 'unknown', value }
}
export function toolContent(item: Item): ToolContent[] {
  if (item.type === 'imageGeneration') {
    const src = item.savedPath || (typeof item.result === 'string' ? item.result : '')
    if (!src) return []
    return [{ type: 'image', src: /^[a-z0-9+/=]+$/i.test(src) && src.length > 64 ? 'data:image/png;base64,' + src : src, name: '生成的图片' }]
  }
  let blocks: unknown
  if (item.type === 'mcpToolCall' && record(item.result)) blocks = item.result.content
  else if (item.type === 'dynamicToolCall') blocks = item.contentItems
  else if (item.type === 'functionCallOutput') blocks = item.output
  if (typeof blocks === 'string') return [{ type: 'text', text: blocks }]
  return Array.isArray(blocks) ? blocks.map(content) : []
}
/** Some servers return a display URL/path alongside an opaque input file ID. */
export function resolveImageFileId(items: Item[], id: string): string | undefined {
  for (const item of items) {
    for (const part of item.content || []) {
      if (typeof part !== 'string' && part.fileId === id && (part.url || part.path)) return part.url || part.path
    }
    for (const part of toolContent(item)) if (part.type === 'image' && part.fileId === id && part.src) return part.src
  }
}
