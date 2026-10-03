<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { PhArrowUp, PhArrowsClockwise, PhCopy, PhDownloadSimple, PhFile, PhFilePlus, PhFolder, PhFolderPlus, PhX } from '@phosphor-icons/vue'
import BaseDialog from './BaseDialog.vue'
import { createWorkspaceFiles, validateWorkspaceName, type WorkspaceFile, type WorkspaceRun } from '../lib/workspace-files'
import { fileLinkFromEvent, type FileLinkTarget } from '../lib/file-links'
import { renderMarkdown } from '../lib/markdown'
import { codeBlockFromEvent } from '../lib/markdown-code'
import { htmlPreviewDocument } from '../lib/html-preview'

const props = defineProps<{ target: FileLinkTarget | null; cwd: string; deviceName: string; connected: boolean; run: WorkspaceRun; floating?: boolean; canSelectDirectory?: boolean; actionsDisabled?: boolean }>()
const emit = defineEmits<{ close: []; copy: [text: string]; selectDirectory: [path: string] }>()
const file = ref<WorkspaceFile | null>(null), location = ref<FileLinkTarget | null>(null)
const loading = ref(false), downloading = ref(false), error = ref(''), downloadError = ref(''), downloaded = ref(0)
const source = ref<HTMLElement>(), panel = ref<HTMLElement>()
const createKind = ref<'file' | 'directory' | null>(null), createName = ref(''), creating = ref(false), createError = ref(''), createDirectory = ref(''), fileNotice = ref('')
let controller: AbortController | undefined, downloadController: AbortController | undefined, createController: AbortController | undefined, generation = 0
let opener: HTMLElement | null = null
const objectUrls = new Set<string>()
const title = computed(() => file.value?.name || location.value?.path.split(/[\\/]/).filter(Boolean).at(-1) || '文件')
const parent = computed(() => {
  const path = (file.value?.path || location.value?.path || '').replace(/\/+$/, '')
  if (!path || path === '~' || !path.startsWith('/') && !path.startsWith('~/')) return ''
  return path.slice(0, path.lastIndexOf('/')) || '/'
})
const preview = computed(() => file.value?.preview)
const downloadOnly = computed(() => file.value?.kind === 'file' && (!preview.value || preview.value.kind === 'binary'))
const markdown = computed(() => preview.value?.kind === 'text' && /\.(?:md|markdown|mdown)$/i.test(file.value?.name || '') && !location.value?.line)
const markdownHtml = computed(() => markdown.value ? renderMarkdown(preview.value?.text || '') : '')
const htmlFile = computed(() => preview.value?.kind === 'text' && /\.html?$/i.test(file.value?.name || ''))
const htmlPreview = ref(true)
const htmlDocument = computed(() => htmlPreviewDocument(preview.value?.text || ''))
function onMarkdownClick(event: MouseEvent) {
  const code = codeBlockFromEvent(event)
  if (code !== null) { emit('copy', code); return }
  const target = fileLinkFromEvent(event); if (target) void load(target, parent.value)
}
const sourceText = computed(() => {
  const text = preview.value?.text || '', line = location.value?.line
  if (!line) return { before: text, selected: '', after: '' }
  const rows = text.split('\n')
  if (line > rows.length) return { before: text, selected: '', after: '' }
  return { before: rows.slice(0, line - 1).join('\n') + (line > 1 ? '\n' : ''), selected: rows[line - 1] || '\u200b', after: line < rows.length ? '\n' + rows.slice(line).join('\n') : '' }
})
const sizeLabel = (size: number) => size < 1024 ? size + ' B' : size < 1024 ** 2 ? (size / 1024).toFixed(1) + ' KB' : (size / 1024 ** 2).toFixed(1) + ' MB'
function stop() { generation++; controller?.abort(); downloadController?.abort(); createController?.abort(); controller = undefined; downloadController = undefined; createController = undefined; loading.value = false; downloading.value = false; creating.value = false; createKind.value = null }
async function load(target: FileLinkTarget, cwd = props.cwd) {
  stop(); location.value = target; file.value = null; error.value = ''; downloadError.value = ''; fileNotice.value = ''; htmlPreview.value = !target.line
  if (!props.connected) { error.value = '请先连接此会话所属的设备。'; return }
  const mine = generation, abort = controller = new AbortController()
  loading.value = true
  try {
    // Absolute/home paths must remain browsable even if the configured cwd
    // does not exist yet. Relative links still resolve against their source.
    const absolute = target.path.startsWith('/') || target.path === '~' || target.path.startsWith('~/')
    const files = createWorkspaceFiles(props.run, { cwd: absolute ? '' : cwd })
    const next = await files.inspect(target.path, { signal: abort.signal })
    if (mine !== generation) return
    file.value = next
    if (next.preview?.truncated) htmlPreview.value = false
    location.value = { ...target, path: next.path }
    await nextTick()
    panel.value?.focus({ preventScroll: true })
    const mark = source.value?.querySelector('mark') as HTMLElement | null
    const body = panel.value?.querySelector<HTMLElement>('.workspace-file-body')
    if (mark && body) body.scrollTop += Math.max(0, mark.getBoundingClientRect().top - body.getBoundingClientRect().top - 80)
  } catch (cause) { if (mine === generation) error.value = cause instanceof Error ? cause.message : '无法读取文件。' }
  finally { if (mine === generation) loading.value = false }
}
watch(() => props.target, target => {
  if (!target) { const modal = downloadOnly.value; stop(); if (modal) clearClosed(); return }
  if (!location.value && document.activeElement instanceof HTMLElement) opener = document.activeElement
  void load(target)
}, { immediate: true })
watch(() => [props.run, props.cwd, props.connected], () => { if (props.target && location.value) void load(location.value) })
function clearClosed() { if (!props.target) { file.value = null; location.value = null } }
async function close() { if (creating.value) return; stop(); emit('close'); await nextTick(); if (opener?.isConnected) opener.focus() }
onBeforeUnmount(() => { stop(); for (const url of objectUrls) URL.revokeObjectURL(url) })

function beginCreate(kind: 'file' | 'directory') {
  if (file.value?.kind !== 'directory' || !props.connected || props.actionsDisabled || creating.value) return
  createKind.value = kind; createDirectory.value = file.value.path; createName.value = ''; createError.value = ''
}
async function createEntry() {
  const kind = createKind.value, directory = createDirectory.value, name = createName.value.trim()
  if (!kind || creating.value || !props.connected || props.actionsDisabled || directory !== file.value?.path) return
  try { validateWorkspaceName(name) } catch (cause) { createError.value = cause instanceof Error ? cause.message : '名称无效。'; return }
  const mine = generation, abort = createController = new AbortController()
  creating.value = true; createError.value = ''; fileNotice.value = ''
  try {
    await createWorkspaceFiles(props.run, { cwd: '' }).create(directory, name, kind, { signal: abort.signal })
    if (mine !== generation) return
    createKind.value = null; creating.value = false; createController = undefined
    const refresh = generation + 1
    await load({ path: directory })
    if (generation === refresh && location.value?.path === directory) fileNotice.value = '已创建' + (kind === 'directory' ? '文件夹：' : '文件：') + name
  } catch (cause) { if (mine === generation) createError.value = cause instanceof Error ? cause.message : '创建失败，请刷新文件夹后重试。' }
  finally { if (mine === generation) { creating.value = false; createController = undefined } }
}

type Writable = { write: (data: Uint8Array) => Promise<void>; close: () => Promise<void>; abort: () => Promise<void> }
type SavePicker = (options: { suggestedName: string }) => Promise<{ createWritable: () => Promise<Writable> }>
const picker = (window as Window & { showSaveFilePicker?: SavePicker }).showSaveFilePicker
const BLOB_LIMIT = 128 * 1024 * 1024
async function download() {
  const current = file.value
  if (!current || current.kind !== 'file' || !props.connected || downloading.value) return
  const mine = generation, abort = downloadController = new AbortController()
  const files = createWorkspaceFiles(props.run, { cwd: '' })
  let sink: Writable | undefined
  downloading.value = true; downloadError.value = ''; downloaded.value = 0
  try {
    if (picker) {
      const handle = await picker.call(window, { suggestedName: current.name })
      abort.signal.throwIfAborted()
      sink = await handle.createWritable()
    } else if (current.size > BLOB_LIMIT) throw new Error('此文件超过 128 MB。请使用支持直接保存文件的桌面 Chrome / Edge 下载。')
    const chunks: BlobPart[] = []
    let offset = 0
    do {
      abort.signal.throwIfAborted()
      const data = await files.readChunk(current, offset, { signal: abort.signal })
      abort.signal.throwIfAborted()
      if (!data.length && offset < current.size) throw new Error('文件内容不完整，请刷新后重试。')
      if (sink) await sink.write(data)
      else chunks.push(new Uint8Array(data).buffer)
      offset += data.length
      if (mine === generation) downloaded.value = offset
    } while (offset < current.size)
    abort.signal.throwIfAborted()
    if (sink) { await sink.close(); sink = undefined }
    else {
      const url = URL.createObjectURL(new Blob(chunks, { type: 'application/octet-stream' }))
      objectUrls.add(url)
      const link = document.createElement('a'); link.href = url; link.download = current.name; document.body.append(link); link.click(); link.remove()
      setTimeout(() => { URL.revokeObjectURL(url); objectUrls.delete(url) }, 30_000)
    }
  } catch (cause) {
    if (mine === generation && !abort.signal.aborted && !(cause instanceof DOMException && cause.name === 'AbortError')) downloadError.value = cause instanceof Error ? cause.message : '下载失败，请重试。'
  } finally {
    if (sink) await sink.abort().catch(() => {})
    if (mine === generation) downloading.value = false
  }
}
</script>

<template>
  <Transition name="file-panel-reveal" @after-leave="clearClosed"><aside v-if="target && !downloadOnly" ref="panel" class="workspace-file-panel" :class="{ 'is-floating': floating }" aria-label="文件预览" tabindex="-1" @keydown.esc.prevent.stop="close">
    <header class="workspace-file-heading"><div><strong :title="title">{{ title }}</strong><small>{{ deviceName }}</small></div><button type="button" class="icon-button" aria-label="关闭文件预览" :disabled="creating" @click="close"><PhX :size="18" /></button></header>
    <div class="workspace-file-toolbar">
      <button v-if="parent" type="button" class="icon-button" aria-label="上级文件夹" title="上级文件夹" :disabled="loading || downloading || creating || !connected" @click="load({ path: parent })"><PhArrowUp :size="18" /></button>
      <code class="workspace-file-path" :title="file?.path || location?.path">{{ file?.path || location?.path }}</code>
      <button type="button" class="icon-button" aria-label="复制文件路径" title="复制路径" @click="emit('copy', file?.path || location?.path || '')"><PhCopy :size="18" /></button>
      <button type="button" class="icon-button" aria-label="刷新文件" title="刷新" :disabled="loading || downloading || creating || !connected" @click="location && load(location)"><PhArrowsClockwise :size="18" /></button>
    </div>
    <div v-if="file?.kind === 'directory'" class="workspace-directory-actions">
      <button v-if="canSelectDirectory" type="button" class="button secondary" :disabled="!connected || creating || actionsDisabled" :title="file.path === cwd ? '当前工作目录' : '使用此目录开始新对话'" @click="emit('selectDirectory', file.path)"><PhFolder :size="17" />设为工作目录</button>
      <button type="button" class="text-button" :disabled="!connected || creating || actionsDisabled" @click="beginCreate('directory')"><PhFolderPlus :size="18" />新建文件夹</button>
      <button type="button" class="text-button" :disabled="!connected || creating || actionsDisabled" @click="beginCreate('file')"><PhFilePlus :size="18" />新建文件</button>
    </div>
    <p v-if="fileNotice" class="workspace-file-notice" role="status">{{ fileNotice }}</p>
    <div v-if="htmlFile" class="workspace-html-tabs" role="group" aria-label="HTML 查看方式">
      <button type="button" :aria-pressed="htmlPreview" :disabled="!!preview?.truncated" @click="htmlPreview = true">页面预览</button><button type="button" :aria-pressed="!htmlPreview" @click="htmlPreview = false">源代码</button>
      <span v-if="preview?.truncated">文件过大，下载后打开完整页面。</span><span v-else-if="htmlPreview">隔离预览，不执行脚本</span>
    </div>
    <div class="workspace-file-body" :aria-busy="loading">
      <p v-if="loading" class="workspace-file-state" role="status"><span class="spinner" />正在读取…</p>
      <div v-else-if="error" class="workspace-file-state"><p class="inline-error" role="alert">{{ error }}</p><button type="button" class="text-button" :disabled="!connected" @click="location && load(location)">重试</button></div>
      <template v-else-if="file?.kind === 'directory'">
        <ul class="workspace-file-entries" aria-label="文件夹内容"><li v-for="entry in file.entries" :key="entry.path"><button type="button" :disabled="entry.kind === 'other' || !connected || creating" :title="entry.path" @click="load({ path: entry.path })"><PhFolder v-if="entry.kind === 'directory'" :size="19" /><PhFile v-else :size="19" /><span>{{ entry.name }}</span><small>{{ entry.kind === 'directory' ? '文件夹' : sizeLabel(entry.size) }}</small></button></li></ul>
        <p v-if="!file.entries?.length" class="workspace-file-state">此文件夹为空。</p>
        <p v-if="file.truncated" class="field-hint">仅显示前 500 项。</p>
      </template>
      <template v-else-if="file?.kind === 'file'">
        <img v-if="preview?.kind === 'image' && preview.dataBase64" class="workspace-file-image" :src="'data:' + preview.mime + ';base64,' + preview.dataBase64" :alt="file.name" />
        <template v-else-if="preview?.kind === 'text'"><iframe v-if="htmlFile && htmlPreview && !preview.truncated" class="workspace-html-preview" :srcdoc="htmlDocument" title="HTML 页面预览" sandbox="" referrerpolicy="no-referrer" /><div v-else-if="markdown" class="markdown workspace-file-markdown" @click="onMarkdownClick" v-html="markdownHtml" /><pre v-else ref="source" class="workspace-file-source"><code>{{ sourceText.before }}<mark v-if="sourceText.selected">{{ sourceText.selected }}</mark>{{ sourceText.after }}</code></pre><p v-if="preview.truncated" class="field-hint">预览已截断，下载可获取完整文件。</p></template>
        <div v-else class="workspace-file-state"><PhFile :size="32" /><p>{{ file.name }}</p><span>{{ sizeLabel(file.size) }} · 下载后打开</span></div>
      </template>
      <p v-else-if="file" class="workspace-file-state">此路径不是普通文件或文件夹。</p>
    </div>
    <footer class="workspace-file-actions">
      <p v-if="downloadError" class="inline-error" role="alert">{{ downloadError }}</p>
      <span v-if="downloading" class="workspace-file-progress" role="status">{{ sizeLabel(downloaded) }} / {{ sizeLabel(file?.size || 0) }}</span>
      <span v-else-if="file?.kind === 'file'" class="field-hint">{{ sizeLabel(file.size) }}</span>
      <button v-if="downloading" type="button" class="button secondary" @click="downloadController?.abort()"><PhX :size="17" />取消下载</button>
      <button v-else-if="file?.kind === 'file'" type="button" class="button primary" :disabled="!connected" @click="download"><PhDownloadSimple :size="18" />下载到此设备</button>
    </footer>
  </aside></Transition>
  <Teleport to="body"><BaseDialog :open="!!createKind" :title="createKind === 'directory' ? '新建文件夹' : '新建文件'" :description="createDirectory" :dismissible="!creating" @close="createKind = null">
    <form class="workspace-create-form" @submit.prevent="createEntry">
      <label class="field">{{ createKind === 'directory' ? '文件夹名称' : '文件名称' }}<input v-model="createName" data-initial-focus :aria-label="createKind === 'directory' ? '文件夹名称' : '文件名称'" :placeholder="createKind === 'directory' ? '例如：my-project' : '例如：README.md'" maxlength="255" autocomplete="off" spellcheck="false" :disabled="creating" /></label>
      <p v-if="createError" class="inline-error" role="alert">{{ createError }}</p>
      <div class="dialog-actions"><button type="button" class="button secondary" :disabled="creating" @click="createKind = null">取消</button><button type="submit" class="button primary" :disabled="creating || !createName.trim() || !connected || actionsDisabled">{{ creating ? '正在创建…' : '创建' }}</button></div>
    </form>
  </BaseDialog></Teleport>
  <Teleport to="body"><BaseDialog :open="!!target && downloadOnly" title="下载文件？" :description="deviceName" class="workspace-download-dialog" @close="close">
    <p class="workspace-download-name">{{ file?.name }}</p><p class="field-hint">{{ sizeLabel(file?.size || 0) }} · 此文件无法在网页中预览，是否下载到此设备？</p>
    <p v-if="downloadError" class="inline-error" role="alert">{{ downloadError }}</p>
    <p v-if="downloading" class="workspace-file-progress" role="status">{{ sizeLabel(downloaded) }} / {{ sizeLabel(file?.size || 0) }}</p>
    <div class="dialog-actions"><button type="button" class="button secondary" @click="close">{{ downloading ? '取消下载' : '取消' }}</button><button type="button" class="button primary" :disabled="downloading || !connected" @click="download"><PhDownloadSimple :size="18" />{{ downloading ? '正在下载…' : '下载' }}</button></div>
  </BaseDialog></Teleport>
</template>

<style scoped>
 .workspace-file-panel { display: flex; flex-direction: column; flex: 0 0 min(48%, 720px); width: min(48%, 720px); min-width: 0; min-height: 0; margin: 6px 8px 6px 0; overflow: hidden; border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--canvas); color: var(--ink-soft); }
.workspace-file-panel.file-panel-reveal-enter-active { transition: flex-basis 260ms var(--ease), width 260ms var(--ease), margin-right 260ms var(--ease), opacity 180ms ease; }
.workspace-file-panel.file-panel-reveal-leave-active { transition: flex-basis 200ms var(--ease), width 200ms var(--ease), margin-right 200ms var(--ease), opacity 120ms ease; pointer-events: none; }
.workspace-file-panel.file-panel-reveal-enter-from, .workspace-file-panel.file-panel-reveal-leave-to { flex-basis: 0; width: 0; margin-right: 0; opacity: 0; }
.workspace-directory-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; padding: 8px 12px; border-bottom: 1px solid var(--line-soft); }
.workspace-directory-actions .button { padding-inline: 12px; }
.workspace-directory-actions .button, .workspace-directory-actions .text-button { min-height: 44px; font-size: calc(13px * var(--ui-font-scale, 1)); }
.workspace-file-notice { margin: 8px 12px 0; color: var(--muted); font-size: calc(12px * var(--ui-font-scale, 1)); overflow-wrap: anywhere; }
.workspace-html-tabs { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; padding: 8px 12px; border-bottom: 1px solid var(--line-soft); }
.workspace-html-tabs button { min-height: 36px; padding: 6px 10px; border-radius: var(--radius-sm); color: var(--muted); font-size: calc(13px * var(--ui-font-scale, 1)); }
.workspace-html-tabs button[aria-pressed="true"] { color: var(--ink); background: var(--hover); }
.workspace-html-tabs span { margin-left: auto; color: var(--muted); font-size: calc(11px * var(--ui-font-scale, 1)); }
.workspace-html-preview { display: block; width: 100%; height: 100%; min-height: 280px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: #fff; }
.workspace-create-form .field { margin: 0; }
.workspace-create-form input { font-size: 16px; }
.workspace-file-panel:focus { outline: none; }
.workspace-file-heading { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--line-soft); flex-shrink: 0; }
.workspace-file-heading > div { flex: 1; min-width: 0; }
.workspace-file-heading strong { display: block; font-size: calc(13px * var(--ui-font-scale, 1)); font-weight: 550; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.workspace-file-heading small { color: var(--muted); font-size: calc(11px * var(--ui-font-scale, 1)); }
.workspace-file-markdown { padding: 4px; }
.workspace-download-name { overflow-wrap: anywhere; color: var(--ink); }
.workspace-file-panel.is-floating { position: fixed; inset: 68px 8px 8px auto; z-index: 25; width: min(48vw, 720px); margin: 0; }
.workspace-file-panel.is-floating.file-panel-reveal-enter-active, .workspace-file-panel.is-floating.file-panel-reveal-leave-active { transition: opacity 180ms ease, transform 200ms var(--ease); }
.workspace-file-panel.is-floating.file-panel-reveal-enter-from, .workspace-file-panel.is-floating.file-panel-reveal-leave-to { width: min(48vw, 720px); transform: translateX(12px); }
.workspace-file-toolbar { display: flex; align-items: center; gap: 6px; flex-shrink: 0; padding: 8px 12px; border-bottom: 1px solid var(--line-soft); }
.workspace-file-path { flex: 1; min-width: 0; color: var(--muted); font-family: var(--code-font-family, monospace); font-size: var(--code-font-size, 13px); overflow-wrap: anywhere; }
.workspace-file-body { flex: 1; min-width: 0; min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 12px; }
.workspace-file-state { display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 10px; padding: 32px 12px; color: var(--muted); text-align: center; overflow-wrap: anywhere; }
.workspace-file-state p { margin: 0; }
.workspace-file-entries { list-style: none; margin: 0; padding: 0; }
.workspace-file-entries button { display: flex; align-items: center; width: 100%; min-height: 40px; gap: 10px; padding: 8px; text-align: left; color: var(--ink-soft); border-radius: var(--radius-sm); }
.workspace-file-entries button:hover:not(:disabled) { background: var(--hover); }
.workspace-file-entries button > span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.workspace-file-entries svg, .workspace-file-entries small { flex-shrink: 0; color: var(--muted); }
.workspace-file-source { margin: 0; padding: 8px 0; white-space: pre; font-family: var(--code-font-family, monospace); font-size: var(--code-font-size, 13px); color: var(--ink-soft); line-height: 1.65; }
.workspace-file-source mark { color: inherit; background: var(--accent-soft); }
.workspace-file-image { display: block; max-width: 100%; max-height: 60dvh; margin: auto; object-fit: contain; }
.workspace-file-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 12px; flex-shrink: 0; padding: 10px 12px; }
.workspace-file-actions > p { flex-basis: 100%; margin: 0; }
.workspace-file-progress { font-variant-numeric: tabular-nums; color: var(--muted); }
@media (max-width: 600px) { .workspace-file-toolbar .icon-button { min-width: 44px; min-height: 44px; }.workspace-file-entries button, .workspace-html-tabs button { min-height: 44px; } }
@media (max-width: 1099px) { .workspace-file-panel, .workspace-file-panel.is-floating { position: fixed; inset: 64px 8px 8px auto; z-index: 25; width: min(720px, calc(100vw - 16px)); margin: 0; } }
@media (max-width: 1099px) {
  .workspace-file-panel.file-panel-reveal-enter-active, .workspace-file-panel.file-panel-reveal-leave-active { transition: opacity 180ms ease, transform 200ms var(--ease); }
  .workspace-file-panel.file-panel-reveal-enter-from, .workspace-file-panel.file-panel-reveal-leave-to { width: min(720px, calc(100vw - 16px)); transform: translateX(12px); }
}
</style>
