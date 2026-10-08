import { computed, inject, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { markdownImageContext } from '../lib/markdown-images'
import { parseFileLink } from '../lib/file-links'
import { createWorkspaceFiles } from '../lib/workspace-files'
import { svgImageUrl } from '../lib/svg-preview'

export type MediaSource = { src: string; kind: 'image' | 'audio'; cwd?: string; fileId?: string }
export function safeMediaUrl(src: string, kind: 'image' | 'audio'): string {
  if (/^https?:\/\//i.test(src)) { try { const url = new URL(src); return url.username || url.password ? '' : url.href } catch { return '' } }
  const pattern = kind === 'image' ? /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i : /^data:audio\/(?:wav|x-wav|mpeg|mp3|ogg|flac|mp4|webm);base64,[a-z0-9+/=]+$/i
  return src.length <= 48 * 1024 * 1024 && pattern.test(src) ? src : ''
}
export function useMediaSource(input: Ref<MediaSource>) {
  const host = inject(markdownImageContext, undefined)
  const source = ref(''), loading = ref(false), error = ref(''), revision = ref(0)
  const fileIdSource = computed(() => input.value.fileId ? host?.value.resolveFileId?.(input.value.fileId) : undefined)
  let abort: AbortController | undefined, generation = 0
  function stop() { generation++; abort?.abort(); abort = undefined }
  watch(() => [input.value, host?.value, fileIdSource.value, revision.value], async () => {
    stop(); source.value = ''; loading.value = false; error.value = ''
    const request = input.value, context = host?.value
    let src = request.src
    if (!src && request.fileId) src = fileIdSource.value || ''
    if (!src) { error.value = request.fileId ? '此图片只有文件标识，设备未提供可读取的地址：' + request.fileId : '未提供媒体地址。'; return }
    if (request.kind === 'image' && /^data:image\/svg\+xml;base64,/i.test(src)) { try { if (src.length > 12 * 1024 * 1024) throw new Error('SVG 文件过大。'); source.value = svgImageUrl(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(src.slice(src.indexOf(',') + 1)), c => c.charCodeAt(0)))); } catch { error.value = 'SVG 内容无效。' }; return }
    const direct = safeMediaUrl(src, request.kind)
    if (direct) { source.value = direct; return }
    const path = parseFileLink(src)?.path
    if (!path) { error.value = '不支持此媒体地址。'; return }
    if (!context?.connected) { error.value = '请先连接此会话所属的设备。'; return }
    const mine = generation, controller = abort = new AbortController()
    loading.value = true
    try {
      const absolute = path.startsWith('/') || path === '~' || path.startsWith('~/')
      const file = await createWorkspaceFiles(context.run, { cwd: absolute ? '' : request.cwd ?? context.cwd }).inspect(path, { signal: controller.signal })
      if (mine !== generation) return
      if (file.preview?.kind !== request.kind || !file.preview.dataBase64) throw new Error(request.kind === 'image' ? '此文件不是可预览的图片，或超过 8 MiB。' : '此文件不是可播放的音频，或超过 32 MiB。')
      const preview = file.preview
      source.value = preview.mime === 'image/svg+xml' ? svgImageUrl(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(preview.dataBase64!), c => c.charCodeAt(0)))) : 'data:' + preview.mime + ';base64,' + preview.dataBase64
    } catch (cause) { if (mine === generation) error.value = cause instanceof Error ? cause.message : '媒体读取失败。' }
    finally { if (mine === generation) loading.value = false }
  }, { immediate: true })
  onBeforeUnmount(stop)
  return { source, loading, error, retry: () => revision.value++, failed: () => { error.value = '媒体加载失败，请重试或下载原文件。'; source.value = '' } }
}
