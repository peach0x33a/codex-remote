import { richPdf, richWav, richSvg, richMarkdown } from './rich-fixture'
// Test-only protocol fixture. Never imported by the application or production server.
import type { ServerWebSocket } from 'bun'
import type { Item, MessageContent, RpcMessage, Thread, Turn } from '../shared/protocol'
import { MOCK_PORT } from './config'
import { codeMarkdown } from './markdown-fixture'
import { ATTACHMENT_UPLOAD_SCRIPT } from '../src/lib/file-attachments'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
const uploadRoot = mkdtempSync(join(tmpdir(), 'codex-remote-e2e-uploads-'))
const uploadedFiles = new Set<string>()
type Peer = { initialized: boolean; acknowledged: boolean; threadId: string; threadIds: string[] }
const clients = new Set<ServerWebSocket<Peer>>()
let threads = new Map<string, Thread>()
let archived = new Map<string, Thread>()
let received: string[] = []
let approved = 0
let scenario = ''
let configVersion = 1
let userConfig: Record<string, unknown> = {}
type NativeSubmission = { id: string; clientUserMessageId: string; input: MessageContent[] }
const nativeQueues = new Map<string, NativeSubmission[]>()
const nativeSettings = new Map<string, Record<string, unknown>>()
const threadAttachments = new Map<string, { id: string; attachmentType: string; identityKey: string; payload: unknown; createdAt: number }[]>()
const goals = new Map<string, { threadId: string; objective: string; status: string; tokenBudget: number | null; tokensUsed: number; timeUsedSeconds: number; createdAt: number; updatedAt: number }>()
function queueFor(threadId: string) {
  if (!nativeQueues.has(threadId)) nativeQueues.set(threadId, [])
  return nativeQueues.get(threadId)!
}
let requests: { method: string; params: Record<string, unknown> }[] = []
let resumed: string[] = []
let pending = new Map<number, { thread: Thread; turn: Turn; kind: string }>()
const timers = new Map<string, ReturnType<typeof setInterval>>()
let requestId = 10000
const fileFixtureBytes = (path: string) => {
  if (path === '/test/files/result.pdf') return new Uint8Array(Buffer.from(richPdf, 'base64'))
  if (path === '/test/files/voice.wav') return new Uint8Array(Buffer.from(richWav, 'base64'))
  if (path === '/test/files/result.svg') return new TextEncoder().encode(richSvg)
  if (uploadedFiles.has(path)) return new Uint8Array(readFileSync(path))
  if (createdEntries.get(path) === 'file') return new Uint8Array()
  if (path === '/test/files/build.AppImage') return Uint8Array.from({ length: 600123 }, (_, i) => i % 256)
  if (path === '/tmp/bf1-server-search-preview.png') return new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAoAAAAFACAIAAACjr1pdAAAE+ElEQVR4nO3VQQ0AIBDAsLOFH/xLILhgD5pUwH6btQ8A8NjkBQDwIQMGgIABA0DAgAEgYMAAEDBgAAgYMAAEDBgAAgYMAAEDBoCAAQNAwIABIGDAABAwYAAIGDAABAwYAAIGDAABAwaAgAEDQMCAASBgwAAQMGAACBgwAAQMGAACBgwAAQMGgIABA0DAgAEgYMAAEDBgAAgYMAAEDBgAAgYMAAEDBoCAAQNAwIABIGDAABAwYAAIGDAABAwYAAIGDAABAwaAgAEDQMCAASBgwAAQMGAACBgwAAQMGAACBgwAAQMGgIABA0DAgAEgYMAAEDBgAAgYMAAEDBgAAgYMAAEDBoCAAQNAwIABIGDAABAwYAAIGDAABAwYAAIGDAABAwaAgAEDQMCAASBgwAAQMGAACBgwAAQMGAACBgwAAQMGgIABA0DAgAEgYMAAEDBgAAgYMAAEDBgAAgYMAAEDBoCAAQNAwIABIGDAABAwYAAIGDAABAwYAAIGDAABAwaAgAEDQMCAASBgwAAQMGAACBgwAAQMGAACBgwAAQMGgIABA0DAgAEgYMAAEDBgAAgYMAAEDBgAAgYMAAEDBoCAAQNAwIABIGDAABAwYAAIGDAABAwYAAIGDAABAwaAgAEDQMCAASBgwAAQMGAACBgwAAQMGAACBgwAAQMGgIABA0DAgAEgYMAAEDBgAAgYMAAEDBgAAgYMAAEDBoCAAQNAwIABIGDAABAwYAAIGDAABAwYAAIGDAABAwaAgAEDQMCAASBgwAAQMGAACBgwAAQMGAACBgwAAQMGgIABA0DAgAEgYMAAEDBgAAgYMAAEDBgAAgYMAAEDBoCAAQNAwIABIGDAABAwYAAIGDAABAwYAAIGDAABAwaAgAEDQMCAASBgwAAQMGAACBgwAAQMGAACBgwAAQMGgIABA0DAgAEgYMAAEDBgAAgYMAAEDBgAAgYMAAEDBoCAAQNAwIABIGDAABAwYAAIGDAABAwYAAIGDAABAwaAgAEDQMCAASBgwAAQMGAACBgwAAQMGAACBgwAAQMGgIABA0DAgAEgYMAAEDBgAAgYMAAEDBgAAgYMAAEDBoCAAQNAwIABIGDAABAwYAAIGDAABAwYAAIGDAABAwaAgAEDQMCAASBgwAAQMGAACBgwAAQMGAACBgwAAQMGgIABA0DAgAEgYMAAEDBgAAgYMAAEDBgAAgYMAAEDBoCAAQNAwIABIGDAABAwYAAIGDAABAwYAAIGDAABAwaAgAEDQMCAASBgwAAQMGAACBgwAAQMGAACBgwAAQMGgIABA0DAgAEgYMAAEDBgAAgYMAAEDBgAAgYMAAEDBoCAAQNAwIABIGDAABAwYAAIGDAABAwYAAIGDAABAwaAgAEDQMCAASBgwAAQMGAACBgwAAQMGAACBgwAAQMGgIABA0DAgAEgYMAAEDBgAAgYMAAEDBgAAgYMAAEDBoCAAQNAwIABIGDAABAwYAAIGDAABAwYAAIGDAABAwaAgAEDQMCAASBgwAAQMGAACBgwAAQMGAACBgwAAQMGgIABA0DAgAEgYMAAEDBgAAgYMAAEDBgAAgYMAAEDBoCAAQNAwIABIGDAABAwYAAIGDAABAwYAAIGDAABAwaAgAEDQMCAASBgwAAQMGAACBgwAAQMGAACBgwAAQMGgIABA0DAgAEgYMAAEDBgAAgYMAAELvQcqz0OdPK8AAAAAElFTkSuQmCC', 'base64'))
  if (path === '/test/files/pixel.gif') return Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), c => c.charCodeAt(0))
  const text: Record<string, string> = {
    '/test/files/README.md': '# 发布说明\n\n这是远端设备的 Markdown 文件。\n\n[下一页](./guide.md)\n\n<script>window.__filePreviewScript = true</script>\n\n' + codeMarkdown,
    '/test/files/images.md': '# 图片说明\n\n![相对路径图片](./pixel.gif)',
    '/test/files/guide.md': '# 使用指南\n\n相对链接解析到文件所在目录。',
    '/test/files/slow.md': '# 延迟返回的旧文件',
    '/test/project/src/main.ts': 'const one = 1\nconst two = 2\nexport { one, two }\n',
    '/test/project/index.html': '<!doctype html><html><head><style>body{background:rgb(12,34,56);color:white}h1{font-size:24px}</style></head><body><h1>HTML 页面预览</h1><svg aria-label="内嵌 SVG" width="100" height="80"><circle cx="40" cy="40" r="30" fill="orange" /></svg><script>parent.__htmlPreviewScript=true;fetch("/api/session")</script><img src="./blocked-resource.png"><form action="/api/profiles"><button>提交</button></form></body></html>',
  }
  return text[path] === undefined ? null : new TextEncoder().encode(text[path])
}
const createdEntries = new Map<string, 'file' | 'directory'>()
function fileFixtureReport(command: string[]) {
  const [operation, cwd, requested, fingerprint, _size, offset] = command.slice(command.indexOf('-c') + 2)
  const parts: string[] = []
  const resolved = requested === '~' ? '/mock-home' : requested!.startsWith('~/') ? '/mock-home/' + requested!.slice(2) : requested!.startsWith('/') ? requested! : cwd + '/' + requested
  for (const part of resolved.split('/')) { if (part === '..') parts.pop(); else if (part && part !== '.') parts.push(part) }
  const path = '/' + parts.join('/'), name = parts.at(-1) || '/'
  const directories: Record<string, { name: string; kind: 'directory' | 'file' }[]> = {
    '/test/project': [{ name: 'src', kind: 'directory' }, { name: 'index.html', kind: 'file' }],
    '/test/project/src': [{ name: 'main.ts', kind: 'file' }],
    '/mock-home': [{ name: 'notes', kind: 'directory' }], '/mock-home/notes': [],
  }
  for (const [created, kind] of createdEntries) if (kind === 'directory') directories[created] = []
  for (const [created, kind] of createdEntries) {
    const parent = created.slice(0, created.lastIndexOf('/')) || '/'
    directories[parent]?.push({ name: created.slice(created.lastIndexOf('/') + 1), kind })
  }
  if (operation === 'create-file' || operation === 'create-directory') {
    const child = path + '/' + fingerprint
    if (!directories[path]) return { ok: false, code: 'read-failed', message: '文件夹不存在。' }
    if (directories[child] || fileFixtureBytes(child)) return { ok: false, code: 'already-exists', message: '同名文件或文件夹已存在，请使用其他名称。' }
    const kind = operation === 'create-file' ? 'file' : 'directory'
    createdEntries.set(child, kind)
    return { ok: true, path: child, name: fingerprint, kind }
  }
  if (directories[path] && operation === 'inspect') return { ok: true, file: { path, name, kind: 'directory', size: 0, fingerprint: '1:1:0:1:1', truncated: false, entries: directories[path]!.map(entry => ({ ...entry, path: path + '/' + entry.name, size: entry.kind === 'file' ? fileFixtureBytes(path + '/' + entry.name)!.length : 0 })) } }
  if (path === '/test/files' && operation === 'inspect') return { ok: true, file: { path, name, kind: 'directory', size: 0, fingerprint: '1:1:0:1:1', truncated: false, entries: ['README.md', 'guide.md', 'build.AppImage', 'pixel.gif'].map(name => ({ path: path + '/' + name, name, kind: 'file', size: fileFixtureBytes(path + '/' + name)!.length })) } }
  const bytes = fileFixtureBytes(path)
  if (!bytes) return { ok: false, code: 'read-failed', message: '文件不存在。' }
  if (operation === 'chunk') return { ok: true, path, fingerprint, size: bytes.length, offset: Number(offset), dataBase64: Buffer.from(bytes.slice(Number(offset), Number(offset) + 262144)).toString('base64') }
  return { ok: true, file: { path, name, kind: 'file', size: bytes.length, fingerprint: '1:1:' + bytes.length + ':1:1', preview: path.endsWith('.pdf') ? { kind: 'pdf', mime: 'application/pdf' } : path.endsWith('.wav') ? { kind: 'audio', mime: 'audio/wav' } : path.endsWith('.svg') ? { kind: 'image', mime: 'image/svg+xml' } : path.endsWith('.AppImage') ? { kind: 'binary' } : path.endsWith('.gif') || path.endsWith('.png') ? { kind: 'image', mime: path.endsWith('.png') ? 'image/png' : 'image/gif' } : { kind: 'text', text: new TextDecoder().decode(bytes), mime: 'text/plain', truncated: false } } }
}
function reset() {
  uploadedFiles.clear(); rmSync(uploadRoot, { recursive: true, force: true }); mkdirSync(uploadRoot, { mode: 0o700 })
  createdEntries.clear()
  configVersion = 1; userConfig = { approvals_reviewer: 'user', model: 'test-model', model_reasoning_effort: 'medium', approval_policy: 'on-request', sandbox_mode: 'workspace-write', web_search: 'cached', model_verbosity: 'medium' }
  for (const timer of timers.values()) clearInterval(timer)
  timers.clear(); pending.clear(); nativeQueues.clear(); nativeSettings.clear(); goals.clear(); received = []; approved = 0; scenario = ''; requests = []; resumed = []
  threadAttachments.clear()
  const recent = Math.floor(Date.now() / 1000)
  archived = new Map([['archived-thread', { id: 'archived-thread', name: '归档历史会话', preview: '归档内容保留', cwd: '/test/archived-project', createdAt: recent - 604800, updatedAt: recent - 604800, status: { type: 'idle' }, turns: [{ id: 'archived-turn', status: 'completed', items: [{ id: 'archived-reply', type: 'agentMessage', text: '归档前保存的会话内容。' }] }] }]])
  threads = new Map([['existing-thread', { id: 'existing-thread', name: '已有项目分析', preview: '梳理项目结构', cwd: '/test/project', createdAt: recent - 120, updatedAt: recent - 60, status: { type: 'idle' }, turns: [{ id: 'existing-turn', status: 'completed', items: [{ id: 'existing-user', type: 'userMessage', content: [{ type: 'text', text: '梳理项目结构' }] }, { id: 'existing-agent', type: 'agentMessage', text: '这是保存在远端的会话。' }] }] }]])
  threads.set('second-thread', { id: 'second-thread', name: '第二个会话', preview: '', cwd: '/test/other-project', createdAt: recent - 240, updatedAt: recent - 180, status: { type: 'idle' }, turns: [{ id: 'second-turn', status: 'completed', items: [{ id: 'second-reply', type: 'agentMessage', text: '第二个会话的消息。' }] }] })
}
reset()
function emit(threadId: string, method: string, params: object, id?: number) { for (const ws of clients) if (ws.data.threadIds.includes(threadId)) ws.send(JSON.stringify({ ...(id !== undefined ? { id } : {}), method, params: { threadId, ...params } })) }
function finishTiming(turn: Turn) { if (scenario === 'work-duration') { turn.startedAt = 1_790_000_000; turn.completedAt = 1_790_000_138; turn.durationMs = 138_000 } }
function finish(thread: Thread, turn: Turn, text: string) {
  const item: Item = { id: crypto.randomUUID(), type: 'agentMessage', text, phase: 'final_answer' }
  turn.items.push(item); turn.status = 'completed'; thread.status = { type: 'idle' }
  finishTiming(turn)
  emit(thread.id, 'item/completed', { turnId: turn.id, item }); emit(thread.id, 'turn/completed', { turn })
}
function stream(thread: Thread, turn: Turn, long: boolean, unsafe: boolean) {
  const text = scenario === 'markdown-code' ? codeMarkdown : scenario === 'markdown-cjk' ? '**验证：**最新类型检查通过。' : unsafe ? '<script>window.__xss = true</script>\n\n[危险](javascript:alert(1))\n\n![远程图片](https://tracker.example/collect)' : long ? '这是需要持续执行的长任务。'.repeat(50) : '你好，这是通过真实 WebSocket 桥接返回的流式回复。'
  const item: Item = { id: crypto.randomUUID(), type: 'agentMessage', text: '', phase: 'final_answer' }
  turn.items.push(item); emit(thread.id, 'item/started', { turnId: turn.id, item })
  let position = 0
  const timer = setInterval(() => {
    if (turn.status !== 'inProgress') { clearInterval(timer); return }
    const delta = text.slice(position, position + 4); position += 4; item.text += delta
    emit(thread.id, 'item/agentMessage/delta', { turnId: turn.id, itemId: item.id, delta })
    if (position >= text.length) {
      clearInterval(timer); timers.delete(turn.id); turn.status = 'completed'; thread.status = { type: 'idle' }
      finishTiming(turn)
      emit(thread.id, 'item/completed', { turnId: turn.id, item }); emit(thread.id, 'turn/completed', { turn })
    }
  }, 45)
  timers.set(turn.id, timer)
}
const server = Bun.serve<Peer>({
  hostname: '127.0.0.1', port: MOCK_PORT,
  async fetch(request, server) {
    const path = new URL(request.url).pathname
    if (path === '/health') return new Response('ok')
    if (path === '/test/reset') { reset(); return Response.json({ ok: true }) }
    if (path === '/test/background.png') return new Response(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGOwTPn3H4QZYAwAV+IKaYtEenEAAAAASUVORK5CYII=', 'base64'), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' } })
    if (path === '/test/scenario' && new URL(request.url).searchParams.get('name') === 'stale-turn') {
      scenario = 'stale-turn'
      const thread = threads.get('existing-thread')!, now = Math.floor(Date.now() / 1000)
      thread.turns.unshift(
        { id: 'stale-history', status: 'inProgress', startedAt: now - 82422, items: [{ id: 'stale-answer', type: 'agentMessage', text: '旧任务的历史输出。' }] },
        { id: 'empty-stale-history', status: 'inProgress', startedAt: now - 82000, items: [] },
      )
      Object.assign(thread.turns.at(-1)!, { startedAt: now - 612, completedAt: now, durationMs: 612000 })
      return Response.json({ ok: true })
    }
    if (path === '/test/scenario' && new URL(request.url).searchParams.get('name') === 'tool-previews') {
      scenario = 'tool-previews'
      const paths = ['/test/project/src/main.ts', '/test/files/README.md', '/test/files/guide.md', '/test/files/pixel.gif', '/test/files/build.AppImage']
      const read = (id: string, files: string[]): Item => ({ id, type: 'commandExecution', status: 'completed', command: 'cat ' + files.join(' '), cwd: '/test/project', aggregatedOutput: '保留执行输出', commandActions: files.map(path => ({ type: 'read', command: 'cat ' + path, name: path.split('/').at(-1)!, path })) })
      threads.get('existing-thread')!.turns = [{ id: 'preview-turn', status: 'completed', items: [
        { id: 'preview-user', type: 'userMessage', content: [{ type: 'text', text: '读取文件并查看图片' }] },
        read('read-one', paths.slice(0, 3)), read('read-two', [paths[0]!, ...paths.slice(3)]),
        { id: 'image-one', type: 'imageView', path: '/test/files/pixel.gif' },
        { id: 'image-missing', type: 'imageView', path: '/test/files/missing.png' },
        { id: 'reason-short', type: 'reasoning', status: 'completed', summary: ['Inspecting register notify'], startedAtMs: 1000, completedAtMs: 2000 },
        { id: 'reason-long', type: 'reasoning', status: 'completed', summary: ['Preparing browser-size test', 'Rewriting browser-size test'], startedAtMs: 1000, completedAtMs: 7000 },
        { id: 'reason-blank', type: 'reasoning', status: 'completed', summary: ['  '] },
        { id: 'preview-agent', type: 'agentMessage', text: '读取完成。' },
      ] }]
      return Response.json({ ok: true })
    }
    if (path === '/test/elicitation') {
      const thread = threads.get('existing-thread')!, turn: Turn = { id: 'elicitation-turn-' + (++requestId), status: 'inProgress', items: [] }
      thread.turns.push(turn); thread.status = { type: 'active' }; emit(thread.id, 'turn/started', { turn })
      const mode = new URL(request.url).searchParams.get('mode') || 'form', id = ++requestId
      pending.set(id, { thread, turn, kind: 'elicitation' })
      const params = mode === 'url' ? { mode, serverName: '测试服务', message: '请完成授权', url: 'https://auth.example/authorize', elicitationId: 'url-1' } : { mode: 'form', serverName: '测试服务', message: '请填写发布信息', requestedSchema: { type: 'object', required: ['title', 'count', 'confirm', 'labels'], properties: { title: { type: 'string', title: '标题', minLength: 2 }, count: { type: 'integer', title: '数量', minimum: 1, maximum: 3 }, confirm: { type: 'boolean', title: '公开发布' }, labels: { type: 'array', title: '标签', minItems: 1, items: { anyOf: [{ const: 'a', title: '标签甲' }, { const: 'b', title: '标签乙' }] } } } } }
      emit(thread.id, 'mcpServer/elicitation/request', { turnId: turn.id, ...params }, id)
      return Response.json({ ok: true })
    }
    if (path === '/test/metrics') return Response.json({ received, approved, requests, resumed, forks: [...threads.values()].filter(thread => 'forkedFromId' in thread), nativeQueues: Object.fromEntries(nativeQueues), nativeSettings: Object.fromEntries(nativeSettings) })
    if (path === '/test/uploaded-file') {
      const file = new URL(request.url).searchParams.get('path') || ''
      return uploadedFiles.has(file) ? Response.json({ dataBase64: readFileSync(file).toString('base64') }) : new Response('Not found', { status: 404 })
    }
    if (path === '/test/native-queue' || path === '/test/native-settings') {
      if (scenario !== 'native-queue' || request.method !== 'POST') return Response.json({ error: 'Native queue scenario required' }, { status: 409 })
      const body = await request.json() as { threadId: string; action?: string; id?: string; text?: string; threadSettings?: Record<string, unknown> }
      if (!threads.has(body.threadId)) return Response.json({ error: 'Thread not found' }, { status: 404 })
      if (path === '/test/native-settings') {
        if (!body.threadSettings) return Response.json({ error: 'Settings required' }, { status: 400 })
        nativeSettings.set(body.threadId, structuredClone(body.threadSettings))
        emit(body.threadId, 'thread/settings/updated', { threadSettings: body.threadSettings })
        return Response.json({ ok: true })
      }
      const queue = queueFor(body.threadId), id = body.id || crypto.randomUUID()
      const index = queue.findIndex(job => job.id === id)
      if (body.action === 'add') {
        if (index >= 0) return Response.json({ error: 'Duplicate submission' }, { status: 409 })
        queue.push({ id, clientUserMessageId: 'external-' + id, input: [{ type: 'text', text: body.text || '', text_elements: [] }] })
      } else if (body.action === 'update' || body.action === 'delete') {
        if (index < 0) return Response.json({ error: 'Queued submission not found' }, { status: 404 })
        if (body.action === 'update') queue[index] = { ...queue[index]!, input: [{ type: 'text', text: body.text || '', text_elements: [] }] }
        else queue.splice(index, 1)
      } else return Response.json({ error: 'Unknown queue action' }, { status: 400 })
      emit(body.threadId, 'thread/queue/changed', {})
      return Response.json({ ok: true, id })
    }
    if (path === '/test/goal-status') {
      const status = new URL(request.url).searchParams.get('status') || ''
      if (!['paused', 'blocked', 'usageLimited', 'budgetLimited'].includes(status)) return Response.json({ error: 'invalid fixture status' }, { status: 400 })
      for (const goal of goals.values()) {
        goal.status = status
        if (status === 'budgetLimited') { goal.tokenBudget = 1280; goal.tokensUsed = 1280 }
      }
      return Response.json({ ok: true })
    }
    if (path === '/test/scenario' && new URL(request.url).searchParams.get('name') === 'worktree-activity') {
      threads.get('second-thread')!.cwd = '/test/project'
      threads.get('existing-thread')!.turns[0]!.items.push({ id: 'saved-worktree-command', type: 'commandExecution', command: 'git status --short', cwd: 'file:///test/worktrees/ready/sdk/udp', status: 'completed' })
    }
    if (path === '/test/scenario') { scenario = new URL(request.url).searchParams.get('name') || ''; if (scenario === 'rich-content') { const turn = threads.get('existing-thread')!.turns[0]!; turn.items = [{ id: 'native-image', type: 'userMessage', content: [{ type: 'localImage', path: '/test/files/pixel.gif', name: '历史图片' }, { type: 'localAudio', path: '/test/files/voice.wav', name: '历史音频' }] }, { id: 'rich-message', type: 'agentMessage', text: richMarkdown }, { id: 'rich-mcp', type: 'mcpToolCall', server: '测试媒体', tool: '展示结果', status: 'completed', result: { content: [{ type: 'text', text: '**工具返回内容**' }, { type: 'image', data: 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', mimeType: 'image/gif', name: '工具图片' }, { type: 'audio', data: richWav, mimeType: 'audio/wav' }] } }, { id: 'rich-dynamic', type: 'dynamicToolCall', tool: '动态媒体', status: 'completed', contentItems: [{ type: 'inputImage', imageUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' }] }, { id: 'rich-generation', type: 'imageGeneration', status: 'completed', result: '', savedPath: '/test/files/pixel.gif' }] } if (scenario === 'markdown-images') { threads.get('existing-thread')!.turns[0]!.items.find(item => item.type === 'agentMessage')!.text = '渲染预览：\n\n![单列服务器列表预览](/tmp/bf1-server-search-preview.png)\n\n![远程图片](' + new URL(request.url).origin + '/test/background.png)\n\n![缺失图片](/tmp/missing.png)\n\n[图片说明](/test/files/images.md)' } if (scenario === 'file-links') { threads.get('existing-thread')!.turns[0]!.items.find(item => item.type === 'agentMessage')!.text = '[说明文档](/test/files/README.md) · [AppImage](/test/files/build.AppImage) · [目录](/test/files) · [源代码](src/main.ts:2) · [图片](file:///test/files/pixel.gif) · [网站](https://example.com) · [慢文件](/test/files/slow.md) · [不存在](/test/files/missing.md)' }; if (scenario === 'archive-pages') { for (let i = 0; i < 34; i++) { const archivedAt = Math.floor(Date.now() / 1000) - 700000 - i; archived.set('archive-page-' + i, { id: 'archive-page-' + i, name: '历史归档 ' + i, preview: '', cwd: '/test/history', createdAt: archivedAt, updatedAt: archivedAt, turns: [], status: { type: 'idle' } }) } }; if (scenario === 'recent-window') { const latest = new Date(2026, 8, 29, 18).getTime() / 1000; threads.get('existing-thread')!.updatedAt = latest; threads.get('second-thread')!.updatedAt = new Date(2026, 8, 28, 0).getTime() / 1000; threads.set('old-thread', { id: 'old-thread', name: '旧项目会话', preview: '', cwd: '/test/old-project', createdAt: 1, updatedAt: new Date(2026, 8, 27, 23).getTime() / 1000, turns: [] }) }; if (scenario === 'task-time-range') {
      threads.get('existing-thread')!.updatedAt = new Date(2026, 8, 29, 18).getTime() / 1000
      threads.get('second-thread')!.updatedAt = new Date(2026, 8, 28, 0).getTime() / 1000
      for (const [id, name, date] of [['week-thread', '更早的项目会话', '2026-09-25'], ['month-thread', '月初项目会话', '2026-09-05'], ['ancient-thread', '上月项目会话', '2026-08-16']]) {
        const time = new Date(date + 'T12:00:00').getTime() / 1000
        threads.set(id, { id, name, preview: name, cwd: '/test/history', createdAt: time, updatedAt: time, status: { type: 'idle' }, turns: [] })
      }
    }; if (scenario.startsWith('paged')) { const thread = threads.get('existing-thread')!; thread.turns = Array.from({ length: scenario === 'paged' ? 45 : 95 }, (_, i) => ({ id: 'history-turn-' + i, status: 'completed', items: [{ id: 'user-' + i, type: 'userMessage', content: [{ type: 'text', text: '历史问题 ' + i }] }, { id: 'agent-' + i, type: 'agentMessage', text: '历史回答 ' + i }] })) }; return Response.json({ ok: true }) }
    if (path === '/test/finish') { for (const thread of threads.values()) { const turn = thread.turns.find(t => t.status === 'inProgress'); if (turn) { clearInterval(timers.get(turn.id)); timers.delete(turn.id); finish(thread, turn, '当前任务已完成。') } }; return Response.json({ ok: true }) }
    if (path === '/test/upstream-retry' || path === '/test/upstream-resume') {
      for (const thread of threads.values()) {
        const turn = thread.turns.find(t => t.status === 'inProgress'); if (!turn) continue
        if (path.endsWith('retry')) emit(thread.id, 'error', { turnId: turn.id, willRetry: true, error: { message: 'Reconnecting... 1/5' } })
        else { const item = turn.items.find(item => item.type === 'reasoning'); if (item) { item.content ||= []; const delta = ' 重连后继续检查。'; item.content[0] = String(item.content[0] || '') + delta; emit(thread.id, 'item/reasoning/textDelta', { turnId: turn.id, itemId: item.id, contentIndex: 0, delta }) } }
      }
      return Response.json({ ok: true })
    }
    if (path === '/test/disconnect') { for (const ws of clients) ws.close(1011, 'test disconnect'); return Response.json({ ok: true }) }
    if (request.headers.has('origin')) return new Response('Origin not allowed', { status: 403 })
    if (request.headers.get('authorization') === 'Bearer wrong-token') return new Response('Unauthorized', { status: 401 })
    if (server.upgrade(request, { data: { initialized: false, acknowledged: false, threadId: '', threadIds: [] } })) return
    return new Response('Expected WebSocket', { status: 400 })
  },
  websocket: {
    open(ws) { clients.add(ws) }, close(ws) { clients.delete(ws) },
    message(ws, raw) {
      const message = JSON.parse(String(raw)) as RpcMessage
      const p = message.params || {}
      const respond = (result: unknown) => ws.send(JSON.stringify({ id: message.id, result }))
      const fail = (code: number, reason: string) => ws.send(JSON.stringify({ id: message.id, error: { code, message: reason } }))
      if (!message.method && message.id !== undefined) {
        const job = pending.get(Number(message.id))
        if (!job) return
        if (job.kind === 'elicitation') requests.push({ method: 'elicitation/response', params: { result: message.result } })
        pending.delete(Number(message.id)); approved++
        emit(job.thread.id, 'serverRequest/resolved', { requestId: message.id })
        const result = message.result as { decision?: string; answers?: Record<string, { answers: string[] }> }
        if ([...pending.values()].some(other => other.turn.id === job.turn.id && other.thread.id === job.thread.id)) return
        finish(job.thread, job.turn, job.kind === 'elicitation' ? '表单请求已处理。' : job.kind === 'question' ? '已收到你的选择：' + (result.answers?.approach?.answers[0] || '未回答') : result.decision === 'accept' ? '已获批准，操作完成。' : '已按你的要求拒绝执行。')
        return
      }
      const method = message.method || ''
      received.push(method); requests.push({ method, params: p })
      if (method === 'initialize') { if (ws.data.initialized) { ws.send(JSON.stringify({ id: message.id, error: { code: -32600, message: 'Already initialized' } })); return }; ws.data.initialized = true; respond({ userAgent: 'codex-test/0.159.0', platformFamily: 'unix', platformOs: 'linux' }); return }
      if (method === 'initialized') { ws.data.acknowledged = true; return }
      if (!ws.data.initialized || !ws.data.acknowledged) { ws.send(JSON.stringify({ id: message.id, error: { code: -32600, message: 'Not initialized' } })); return }
      if (method.startsWith('thread/attachment/')) {
        const threadId = String(p.threadId)
        if (!threadAttachments.has(threadId)) threadAttachments.set(threadId, [])
        const rows = threadAttachments.get(threadId)!
        if (method === 'thread/attachment/list') { respond({ data: rows, nextCursor: null }); return }
        if (method === 'thread/attachment/remove') { threadAttachments.set(threadId, rows.filter(row => row.attachmentType !== p.attachmentType || row.identityKey !== p.identityKey)); respond({}); return }
        const old = rows.find(row => row.attachmentType === p.attachmentType && row.identityKey === p.identityKey)
        const attachment = old || { id: crypto.randomUUID(), attachmentType: String(p.attachmentType), identityKey: String(p.identityKey), payload: p.payload, createdAt: Date.now() }
        if (!old) rows.push(attachment)
        respond({ outcome: old ? 'existing' : 'created', attachment }); return
      }
      if (method === 'thread/inject_items') {
        if (scenario === 'steer-save-error') { fail(-32603, '测试插话保存失败'); return }
        respond({}); return
      }
      if (method === 'fs/createDirectory') { if (scenario === 'directory-denied') fail(-32603, 'Permission denied: default directory'); else respond({}); return }
      if (method === 'command/exec' && Array.isArray(p.command) && typeof p.command[4] === 'string' && p.command[4].startsWith(ATTACHMENT_UPLOAD_SCRIPT.split('\n')[0]!)) {
        const command = p.command as string[]
        if (scenario === 'file-upload-error' && command[5] === 'chunk') { fail(-32603, '测试文件上传失败，请重试'); return }
        void (async () => {
          const process = Bun.spawn(command, { cwd: uploadRoot, env: { ...globalThis.process.env, TMPDIR: uploadRoot }, stdout: 'pipe', stderr: 'pipe' })
          const [stdout, stderr, exitCode] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited])
          if (command[5] === 'finish') { const report = JSON.parse(stdout); if (report.ok && typeof report.path === 'string') uploadedFiles.add(report.path) }
          const send = () => respond({ stdout, stderr, exitCode })
          if (scenario === 'file-upload-slow' && command[5] === 'chunk') setTimeout(send, 800)
          else send()
        })().catch(cause => fail(-32603, String(cause)))
        return
      }
      if (method === 'command/exec' && Array.isArray(p.command) && p.command[3] === 'codex-remote-directory') { respond({ exitCode: 0, stdout: '/mock-home/' + String(p.command[4]).replace(/^~\/?/, ''), stderr: '' }); return }
      if (method === 'command/exec' && ['file-links', 'tool-previews', 'markdown-images', 'rich-content'].includes(scenario)) {
        const command = Array.isArray(p.command) ? p.command as string[] : []
        if (command.some(part => part.startsWith('# codex-remote workspace files'))) {
          const reply = { exitCode: 0, stdout: JSON.stringify(fileFixtureReport(command)), stderr: '' }
          if (command.includes('/test/files/slow.md')) setTimeout(() => respond(reply), 1000)
          else respond(reply)
        } else respond({ exitCode: 128, stdout: '', stderr: 'not a Git repository' })
        return
      }
      if (method === 'command/exec' && scenario === 'worktree-activity') {
        const command = Array.isArray(p.command) ? p.command as string[] : []
        const linked = String(p.cwd).startsWith('/test/worktrees/ready/')
        const root = linked ? '/test/worktrees/ready/sdk' : '/test/project'
        if (command.includes('symbolic-ref')) { respond({ exitCode: 0, stdout: 'refs/heads/' + (linked ? 'research/bfv-ready-packet-20261007' : 'main') + '\n', stderr: '' }); return }
        if (command.includes('rev-parse')) { respond({ exitCode: 0, stdout: ['true', linked ? '/repo/.git/worktrees/ready-sdk' : '.git', linked ? '/repo/.git' : '.git', root, ''].join('\n'), stderr: '' }); return }
        respond({ exitCode: 1, stdout: '', stderr: 'unsupported' }); return
      }
      if (method === 'command/exec' && (scenario === 'worktree' || scenario === 'branch')) {
        const command = Array.isArray(p.command) ? p.command as string[] : []
        const linked = scenario === 'worktree', root = String(p.cwd || '/test/project')
        if (command.includes('symbolic-ref')) { respond({ exitCode: 0, stdout: linked ? 'refs/heads/feature/island\n' : 'refs/heads/main\n', stderr: '' }); return }
        if (command.includes('rev-parse')) { respond({ exitCode: 0, stdout: ['true', linked ? '/repo/.git/worktrees/feature' : '.git', linked ? '/repo/.git' : '.git', root, ''].join('\n'), stderr: '' }); return }
        respond({ exitCode: 1, stdout: '', stderr: 'unsupported' }); return
      }
      if (method === 'command/exec' && scenario === 'inspector') {
        const command = Array.isArray(p.command) ? p.command as string[] : []
        const diff = 'diff --git a/src/App.vue b/src/App.vue\n--- a/src/App.vue\n+++ b/src/App.vue\n@@ -1 +1,2 @@\n-old line\n+new line\n+another line\n'
        if (command[0] === 'python3') { respond({ exitCode: 0, stdout: JSON.stringify({ ok: true }), stderr: '' }); return }
        if (command.includes('log')) { respond({ exitCode: 0, stdout: 'a'.repeat(40) + '\x00\x001790000000\x00Fixture commit\n', stderr: '' }); return }
        if (command.includes('for-each-ref')) { respond({ exitCode: 0, stdout: 'refs/heads/main\x00' + 'a'.repeat(40) + '\x00*\x00\n', stderr: '' }); return }
        if (command.includes('rev-parse') || command.includes('merge-base')) { respond({ exitCode: 0, stdout: 'a'.repeat(40) + '\n', stderr: '' }); return }
        if (command.includes('ls-files')) { respond({ exitCode: 0, stdout: '', stderr: '' }); return }
        respond({ exitCode: 0, stdout: diff, stderr: '' }); return
      }
      if (method === 'turn/steer') {
        const thread = threads.get(String(p.threadId)), turn = thread?.turns.find(turn => turn.id === p.expectedTurnId && turn.status === 'inProgress')
        if (!thread || !turn) { fail(-32600, 'no active turn to steer'); return }
        if (scenario === 'async-question-rejected') { scenario = 'async-question'; fail(-32603, '测试回答发送失败，请重试'); return }
        if (scenario === 'steer-not-consumed' || scenario === 'steer-save-error') { respond({ turnId: turn.id }); return }
        const user: Item = { id: crypto.randomUUID(), clientId: p.clientUserMessageId as string | undefined, type: 'userMessage', content: p.input as Item['content'] }
        turn.items.push(user); emit(thread.id, 'item/completed', { turnId: turn.id, item: user }); respond({ turnId: turn.id }); return
      }
      if (method === 'fuzzyFileSearch') {
        if (scenario === 'file-search-unavailable') { fail(-32601, 'Unknown method: fuzzyFileSearch'); return }
        const root = Array.isArray(p.roots) && typeof p.roots[0] === 'string' ? p.roots[0] : ''
        const files = ['src/App.vue', 'src/main.ts', 'README.md', 'docs/项目 计划.md']
          .filter(path => path.toLocaleLowerCase().includes(String(p.query || '').toLocaleLowerCase()))
          .map(path => ({ root, path, match_type: 'file', file_name: path.split('/').pop(), score: 100, indices: null }))
        if (scenario === 'file-search-delayed') setTimeout(() => respond({ files }), String(p.query) === 'App' ? 500 : 10)
        else respond({ files })
        return
      }
      if (method.startsWith('thread/goal/')) {
        if (scenario === 'goal-disabled') { fail(-32600, 'goals feature is disabled'); return }
        const threadId = String(p.threadId), thread = threads.get(threadId)
        if (!thread) { fail(-32602, 'Thread not found'); return }
        if (method === 'thread/goal/get') { respond({ goal: goals.get(threadId) || null }); return }
        if (scenario !== 'goal') { fail(-32601, 'Unknown method: ' + method); return }
        if (method === 'thread/goal/clear') {
          respond({ cleared: goals.delete(threadId) }); emit(threadId, 'thread/goal/cleared', {}); return
        }
        if (method === 'thread/goal/set') {
          const previous = goals.get(threadId), now = Math.floor(Date.now() / 1000)
          if (!previous && (typeof p.objective !== 'string' || !p.objective.trim())) { fail(-32602, 'Objective required'); return }
          const goal = { threadId, objective: String(p.objective ?? previous?.objective), status: String(p.status ?? previous?.status ?? 'active'), tokenBudget: typeof p.tokenBudget === 'number' ? p.tokenBudget : previous?.tokenBudget ?? null, tokensUsed: previous?.tokensUsed ?? 1240, timeUsedSeconds: previous?.timeUsedSeconds ?? 12, createdAt: previous?.createdAt ?? now, updatedAt: now }
          goals.set(threadId, goal); respond({ goal }); emit(threadId, 'thread/goal/updated', { goal, turnId: null }); return
        }
        fail(-32601, 'Unknown method: ' + method); return
      }
      if (method.startsWith('thread/queue/') || method === 'thread/settings/update') {
        // Every existing scenario keeps explicit legacy capability detection.
        if (scenario !== 'native-queue' && !(['goal', 'goal-disabled'].includes(scenario) && method === 'thread/settings/update')) { fail(-32601, 'Unknown method: ' + method); return }
        const threadId = String(p.threadId)
        if (!threads.has(threadId)) { fail(-32602, 'Thread not found'); return }
        if (method === 'thread/settings/update') {
          const { threadId: _threadId, ...settings } = p
          nativeSettings.set(threadId, structuredClone(settings)); respond({})
          emit(threadId, 'thread/settings/updated', { threadSettings: settings }); return
        }
        const queue = queueFor(threadId)
        if (method === 'thread/queue/list') {
          const offset = Number(p.cursor || 0), limit = Number(p.limit || 100)
          respond({ data: queue.slice(offset, offset + limit), nextCursor: offset + limit < queue.length ? String(offset + limit) : null }); return
        }
        if (method === 'thread/queue/add') {
          if (!Array.isArray(p.input) || typeof p.clientUserMessageId !== 'string') { fail(-32602, 'Invalid submission'); return }
          const submission: NativeSubmission = { id: crypto.randomUUID(), input: structuredClone(p.input) as MessageContent[], clientUserMessageId: p.clientUserMessageId }
          queue.push(submission); respond({ queuedSubmission: submission })
        } else if (method === 'thread/queue/update' || method === 'thread/queue/delete') {
          const index = queue.findIndex(job => job.id === p.queuedSubmissionId)
          if (index < 0) { fail(-32602, 'Queued submission not found'); return }
          if (method === 'thread/queue/update') {
            if (!Array.isArray(p.input)) { fail(-32602, 'Invalid submission'); return }
            queue[index] = { ...queue[index]!, input: structuredClone(p.input) as MessageContent[] }
          } else queue.splice(index, 1)
          respond({})
        } else { fail(-32601, 'Unknown method: ' + method); return }
        emit(threadId, 'thread/queue/changed', {}); return
      }
      if (method === 'skills/list') {
        if (scenario === 'skills-unavailable') { fail(-32601, 'Unknown method: skills/list'); return }
        respond({ data: [{ cwd: Array.isArray(p.cwds) && p.cwds[0] || '/test/project', skills: [
          { name: 'audit', description: '审查当前项目的代码', path: '/test/skills/audit/SKILL.md', scope: 'user', enabled: true },
          { name: 'disabled-skill', description: '已关闭的技能', path: '/test/skills/disabled/SKILL.md', scope: 'user', enabled: false },
        ], errors: [] }] }); return
      }
      if (method === 'plugin/installed') { respond({ marketplaces: [{ name: 'local', plugins: [{ id: 'browser@local', name: 'browser', installed: true, enabled: true, interface: { displayName: 'Browser', shortDescription: '浏览器操作' } }] }], marketplaceLoadErrors: [] }); return }
      if (method === 'thread/search') { const query = String(p.searchTerm).toLowerCase(); respond({ data: [...threads.values()].filter(thread => (thread.name || thread.preview).toLowerCase().includes(query)).slice(0, 30).map(thread => ({ thread: { ...thread, turns: [] }, snippet: thread.preview })), nextCursor: null }); return }
      if (method === 'thread/name/set') { const thread = threads.get(String(p.threadId)); if (!thread) { fail(-32602, 'Thread not found'); return }; thread.name = String(p.name); emit(thread.id, 'thread/name/updated', { threadName: thread.name }); respond({}); return }
      if (method === 'config/read') {
        if (scenario === 'config-unsupported' && p.includeLayers) { fail(-32601, '配置接口不可用'); return }
        respond({ config: userConfig, origins: {}, ...(p.includeLayers ? { layers: [{ name: { type: 'user', file: '/test/codex/config.toml' }, version: String(configVersion), config: userConfig }] } : {}) }); return
      }
      if (method === 'config/batchWrite') {
        if (scenario === 'config-conflict' || p.expectedVersion !== String(configVersion)) { fail(-32600, '配置已被其他客户端修改'); return }
        for (const edit of p.edits as { keyPath: string; value: unknown }[]) { if (edit.value === null) delete userConfig[edit.keyPath]; else userConfig[edit.keyPath] = edit.value }
        configVersion++; respond({ status: 'ok', version: String(configVersion), filePath: '/test/codex/config.toml' }); return
      }
      if (method === 'configRequirements/read') { respond({ requirements: scenario === 'restricted' ? { allowedSandboxModes: ['read-only', 'workspace-write'], allowedApprovalPolicies: ['on-request'] } : null }); return }
      if (method === 'model/list') { if (scenario === 'model-never') return; respond({ data: [
        { id: 'test-model', model: 'test-model', displayName: '测试模型', isDefault: true, defaultReasoningEffort: 'medium', defaultServiceTier: scenario === 'fast-priority' ? 'priority' : 'fast', serviceTiers: [{ id: scenario === 'fast-priority' ? 'priority' : 'fast', name: 'Fast', description: '更快的响应' }], description: '适合复杂的编码任务', supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'].map(reasoningEffort => ({ reasoningEffort, description: reasoningEffort })) },
        { id: 'quick-model', model: 'quick-model', displayName: '轻量模型', defaultReasoningEffort: 'low', description: '快速完成日常任务', supportedReasoningEfforts: ['low', 'medium'].map(reasoningEffort => ({ reasoningEffort, description: reasoningEffort })) },
      ], nextCursor: null }); return }
      if (method === 'thread/list') {
        const rows = [...(p.archived === true ? archived : threads).values()].filter(t => (!p.searchTerm || (t.name || t.preview).includes(String(p.searchTerm))) && (!p.cwd || (Array.isArray(p.cwd) ? p.cwd.includes(t.cwd) : t.cwd === p.cwd))).sort((a, b) => (b.recencyAt ?? b.updatedAt) - (a.recencyAt ?? a.updatedAt))
        const offset = Number(p.cursor || 0), limit = scenario === 'task-time-range' ? 1 : Number(p.limit || 100)
        respond({ data: rows.slice(offset, offset + limit).map(t => ({ ...t, turns: [] })), nextCursor: offset + limit < rows.length ? String(offset + limit) : null }); return
      }
      if (method === 'thread/read') { const thread = threads.get(String(p.threadId)); if (!thread) { ws.send(JSON.stringify({ id: message.id, error: { code: -32602, message: 'Thread not found' } })); return }; respond({ thread: { ...thread, turns: p.includeTurns ? thread.turns : [] } }); return }
      if (method === 'account/usage/read') { respond({ threadUsage: null }); return }
      if (method === 'thread/start') {
        const thread: Thread = { id: crypto.randomUUID(), preview: '', cwd: String(p.cwd || '/test/project'), createdAt: Date.now() / 1000, updatedAt: Date.now() / 1000, status: { type: 'idle' }, turns: [] }
        threads.set(thread.id, thread); ws.data.threadId = thread.id; if (!ws.data.threadIds.includes(thread.id)) ws.data.threadIds.push(thread.id); emit(thread.id, 'thread/started', { thread }); respond({ thread, model: 'test-model' }); return
      }
      if (method === 'thread/fork') {
        const source = threads.get(String(p.threadId))
        if (!source) { fail(-32602, 'Thread not found'); return }
        const lastTurnIndex = p.lastTurnId === undefined ? source.turns.length - 1 : source.turns.findIndex(turn => turn.id === p.lastTurnId)
        if (p.lastTurnId !== undefined && lastTurnIndex < 0) { fail(-32602, 'Fork turn not found'); return }
        const now = Math.floor(Date.now() / 1000)
        const thread: Thread & { forkedFromId: string } = {
          ...structuredClone(source), id: crypto.randomUUID(), forkedFromId: source.id,
          source: source.source ?? 'cli', createdAt: now, updatedAt: now, recencyAt: now, status: { type: 'idle' },
          turns: structuredClone(source.turns.slice(0, lastTurnIndex + 1)).map(turn => ({ ...turn, status: turn.status === 'inProgress' ? 'interrupted' : turn.status })),
        }
        threads.set(thread.id, thread)
        const settings = nativeSettings.get(source.id)
        if (settings) nativeSettings.set(thread.id, structuredClone(settings))
        const goal = goals.get(source.id)
        if (goal) goals.set(thread.id, { ...structuredClone(goal), threadId: thread.id, createdAt: now, updatedAt: now })
        ws.data.threadId = thread.id
        if (!ws.data.threadIds.includes(thread.id)) ws.data.threadIds.push(thread.id)
        const summary = { ...thread, turns: p.excludeTurns ? [] : thread.turns }
        emit(thread.id, 'thread/started', { thread: summary })
        // Native fork metadata and inherited history only; opening a fork never starts generation.
        respond({ thread: summary, model: settings?.model ?? source.model ?? 'test-model', reasoningEffort: settings?.effort ?? 'high', approvalPolicy: settings?.approvalPolicy ?? 'on-request', approvalsReviewer: settings?.approvalsReviewer ?? 'user', sandbox: settings?.sandboxPolicy ?? { type: 'workspaceWrite', networkAccess: false, writableRoots: [] } })
        return
      }
      if (method === 'thread/resume') {
        const thread = threads.get(String(p.threadId))
        if (!thread) { ws.send(JSON.stringify({ id: message.id, error: { code: -32602, message: 'Thread not found' } })); return }
        ws.data.threadId = thread.id; if (!ws.data.threadIds.includes(thread.id)) ws.data.threadIds.push(thread.id)
        if (scenario === 'never' && thread.id === 'existing-thread') return
        const deliver = () => {
          const saved = scenario === 'native-queue' ? nativeSettings.get(thread.id) : undefined
          resumed.push(thread.id); respond({ thread: { ...thread, turns: p.excludeTurns && scenario !== 'legacy' ? [] : thread.turns }, model: saved?.model ?? 'test-model', reasoningEffort: saved?.effort ?? 'high', approvalPolicy: saved?.approvalPolicy ?? 'on-request', approvalsReviewer: saved?.approvalsReviewer ?? 'user', sandbox: saved?.sandboxPolicy ?? { type: 'workspaceWrite', networkAccess: false, writableRoots: [] } })
        }
        if (scenario === 'slow' && thread.id === 'existing-thread') setTimeout(deliver, 600); else deliver()
        return
      }
      if (method === 'thread/turns/list' || method === 'thread/items/list') {
        if (scenario === 'legacy') { ws.send(JSON.stringify({ id: message.id, error: { code: -32601, message: 'Unknown method' } })); return }
        const thread = threads.get(String(p.threadId))!
        if (method === 'thread/turns/list') { respond({ data: [...thread.turns].reverse().slice(0, Number(p.limit || 20)).map(turn => ({ ...turn, items: [] })), nextCursor: null }); return }
        const entries = thread.turns.filter(turn => !p.turnId || turn.id === p.turnId).flatMap(turn => turn.items.map(item => ({ turnId: turn.id, item })))
        if (p.sortDirection !== 'asc') entries.reverse()
        const offset = Number(p.cursor || 0), limit = Number(p.limit || 60)
        if (p.cursor && scenario === 'paged-error') { scenario = 'paged-recovered'; fail(-32603, '测试历史加载失败'); return }
        const deliver = () => respond({ data: entries.slice(offset, offset + limit), nextCursor: offset + limit < entries.length ? String(offset + limit) : null })
        if (p.cursor && scenario === 'paged-slow') setTimeout(deliver, 350); else deliver()
        return
      }
      if (method === 'thread/revert') {
        const thread = threads.get(String(p.threadId))!, index = thread?.turns.findIndex(turn => turn.id === p.beforeTurnId) ?? -1
        if (index < 0 || thread.turns.some(turn => turn.status === 'inProgress')) { ws.send(JSON.stringify({ id: message.id, error: { code: -32602, message: 'Cannot revert this turn' } })); return }
        thread.turns = thread.turns.slice(0, index); thread.status = { type: 'idle' }; thread.preview = ''
        respond({ thread: { ...thread, turns: [] }, turnsBackwardsCursor: null, itemsBackwardsCursor: null }); return
      }
      if (method === 'thread/archive') {
        const id = String(p.threadId), thread = threads.get(id)
        if (!thread) { fail(-32602, 'Thread not found'); return }
        threads.delete(id); archived.set(id, thread); emit(id, 'thread/archived', {}); respond({}); return
      }
      if (method === 'thread/unarchive') {
        const id = String(p.threadId), thread = archived.get(id)
        if (scenario === 'archive-fail') { fail(-32603, '测试恢复失败，请重试'); return }
        if (!thread) { fail(-32602, 'Archived thread not found'); return }
        archived.delete(id); threads.set(id, thread); respond({ thread: { ...thread, turns: [] } }); emit(id, 'thread/unarchived', {}); return
      }
      if (method === 'turn/interrupt') {
        const thread = threads.get(String(p.threadId))!, turn = thread.turns.find(t => t.id === p.turnId)!
        clearInterval(timers.get(turn.id)); timers.delete(turn.id); turn.status = 'interrupted'; finishTiming(turn); thread.status = { type: 'idle' }; respond({}); emit(thread.id, 'turn/completed', { turn }); return
      }
      if (method === 'thread/compact/start') {
        const thread = threads.get(String(p.threadId))!
        const item: Item = { id: 'manual-compaction-' + Date.now(), type: 'contextCompaction' }
        const turn: Turn = { id: 'compact-' + Date.now(), status: 'inProgress', items: [item] }
        thread.turns.push(turn); thread.status = { type: 'active' }
        emit(thread.id, 'turn/started', { turn }); emit(thread.id, 'item/started', { turnId: turn.id, item }); respond({})
        setTimeout(() => { item.status = 'completed'; turn.status = 'completed'; thread.status = { type: 'idle' }; emit(thread.id, 'item/completed', { turnId: turn.id, item }); emit(thread.id, 'turn/completed', { turn }) }, 300)
        return
      }
      if (method === 'turn/start') {
        const thread = threads.get(String(p.threadId))!
        const inputs = p.input as { type: string; text?: string; url?: string }[]
        const text = inputs.find(i => i.type === 'text')?.text || ''
        if (scenario === 'queue-fail' && text.includes('发送失败')) { ws.send(JSON.stringify({ id: message.id, error: { code: -32603, message: '测试发送失败，请手动重试' } })); return }
        const user: Item = { id: crypto.randomUUID(), type: 'userMessage', content: inputs }
        const turn: Turn = { id: crypto.randomUUID(), status: 'inProgress', items: [user] }
        thread.preview ||= text; thread.turns.push(turn); thread.status = { type: 'active' }
        emit(thread.id, 'turn/started', { turn }); emit(thread.id, 'item/completed', { turnId: turn.id, item: user }); respond({ turn })
        if (scenario === 'worktree-activity') {
          const command: Item = { id: 'live-worktree-command', type: 'commandExecution', command: 'git status --short', cwd: 'file:///test/worktrees/ready/sdk/udp', status: 'inProgress' }
          turn.items.push(command); emit(thread.id, 'item/started', { turnId: turn.id, item: command })
          return
        }
        emit(thread.id, 'thread/tokenUsage/updated', { turnId: turn.id, tokenUsage: { total: { totalTokens: 45000, inputTokens: 42000, cachedInputTokens: 21000, cacheWriteInputTokens: 100, outputTokens: 3000, reasoningOutputTokens: 1000 }, last: { totalTokens: 19100, inputTokens: 19000, cachedInputTokens: 13330, cacheWriteInputTokens: 100, outputTokens: 100, reasoningOutputTokens: 40 }, modelContextWindow: 1000000 } })
        if (scenario.startsWith('async-question')) {
          if (text.startsWith('<send_user_message_question_reply>')) { finish(thread, turn, '回答已收到。'); return }
          const item: Item = { id: 'async-question-' + turn.id, type: 'agentMessage', delivery: 'async', phase: 'commentary', text: '这两个新命令的权限如何设置？修改服务器代号属于管理操作；插队会影响其他服务器的等待顺序。', questions: [
            { title: '这两个新命令的权限如何设置？修改服务器代号属于管理操作；插队会影响其他服务器的等待顺序。', options: ['修改代号、插队均仅 Bot 管理员（推荐）', '修改代号仅管理员，插队允许主控群所有成员'] },
            { title: '还有哪些需要补充的要求？', options: null },
          ] }
          turn.items.push(item); emit(thread.id, 'item/completed', { turnId: turn.id, item })
          if (scenario === 'async-question-with-approval') {
            const id = ++requestId
            pending.set(id, { thread, turn, kind: 'approval' })
            emit(thread.id, 'item/commandExecution/requestApproval', { turnId: turn.id, itemId: 'parallel-approval', command: 'printf pending', reason: '另一个操作正在等待审批。', availableDecisions: ['accept', 'decline', 'cancel'] }, id)
          }
          if (scenario === 'async-question-idle') finish(thread, turn, '独立检查已经完成，你可以继续回答问题。')
          return
        }
        if (scenario === 'terminal-error') {
          turn.status = 'failed'; thread.status = { type: 'idle' }
          turn.error = { message: 'exceeded retry limit, last status: 429 Too Many Requests, request id: test-terminal-429' }
          emit(thread.id, 'error', { turnId: turn.id, error: turn.error, willRetry: false })
          emit(thread.id, 'turn/completed', { turn }); return
        }
        if (scenario.startsWith('auto-retry-')) {
          const category = scenario.split('-')[2] || 'network'
          const codes: Record<string, unknown> = { network: { responseStreamDisconnected: { httpStatusCode: null } }, server: 'serverOverloaded', rate: 'rateLimitExceeded', policy: 'cyberPolicy' }
          if (scenario.endsWith('-always') || !thread.turns.slice(0, -1).some(turn => turn.status === 'failed')) {
            const message = category === 'policy'
              ? 'This content was flagged for possible cybersecurity risk. If this seems wrong, try rephrasing your request. If you’re doing authorized security work that requires more cyber permissive safeguards, apply for Daybreak access via https://platform.openai.com/settings/organization/status-and-access before retrying.'
              : category === 'rate' ? '429 Too Many Requests' : category === 'server' ? 'The server is temporarily overloaded.' : 'Response stream disconnected before completion.'
            turn.status = 'failed'; thread.status = { type: 'idle' }; turn.error = { message, codexErrorInfo: codes[category] || 'other' }
            emit(thread.id, 'error', { turnId: turn.id, error: turn.error, willRetry: false }); emit(thread.id, 'turn/completed', { turn }); return
          }
          finish(thread, turn, '自动重试后的任务已完成。'); return
        }
        if (scenario === 'inspector') {
          const read = (id: string, path: string): Item => ({ id, type: 'commandExecution', status: 'completed', command: 'cat ' + path, commandActions: [{ type: 'read', command: 'cat ' + path, path, name: path.split('/').at(-1)! }] })
          const steps: Item[] = [read('read-app', 'src/App.vue'), read('read-editor', 'src/components/PromptEditor.vue'), { id: 'run-test', type: 'commandExecution', status: 'completed', command: 'bun test', commandActions: [{ type: 'unknown', command: 'bun test' }] }, read('read-readme', 'README.md')]
          const names = ['Zeno', 'Hilbert', 'Tesla', 'Mendel', 'Bohr', 'Descartes', 'Curie', 'Turing', 'Noether']
          const ids = names.map((name, index) => {
            const id = 'child-' + index
            threads.set(id, { id, parentThreadId: thread.id, agentNickname: name, agentRole: 'worker', preview: name + ' 的任务', cwd: thread.cwd, createdAt: thread.createdAt, updatedAt: thread.updatedAt, status: { type: 'idle' }, turns: [{ id: id + '-turn', status: 'completed', items: [{ id: id + '-result', type: 'agentMessage', text: name + ' 已完成检查。' }] }] })
            return id
          })
          steps.push({ id: 'spawn-agents', type: 'collabAgentToolCall', tool: 'spawnAgent', status: 'completed', receiverThreadIds: ids, agentsStates: Object.fromEntries(ids.map(id => [id, { status: 'completed' }])) } as Item)
          steps.push({ id: 'change-files', type: 'fileChange', status: 'completed', changes: ['src/App.vue', 'src/components/PromptEditor.vue', 'README.md', 'src/style.css'].map(path => ({ path, kind: { type: 'update' }, diff: '--- a/' + path + '\n+++ b/' + path + '\n@@ -1 +1,2 @@\n-old line\n+new line\n+another line\n' })) })
          for (const item of steps) { turn.items.push(item); emit(thread.id, 'item/completed', { turnId: turn.id, item }) }
          emit(thread.id, 'turn/diff/updated', { turnId: turn.id, diff: steps.filter(item => item.type === 'fileChange').flatMap(item => item.changes || []).map(change => 'diff --git a/' + change.path + ' b/' + change.path + '\n' + change.diff).join('') })
          finish(thread, turn, '界面检查完成。'); return
        }
        if (text === '子代理事件') {
          const activity: Item = { type: 'subAgentActivity', id: 'sub-agent-event', kind: 'interacted', agentThreadId: '01a0f75e-a768-7682-ad2f-2716871ce8f1', agentPath: '/root/crossflow_sol', completedAtMs: 1790862448504 }
          threads.set(activity.agentThreadId!, { id: activity.agentThreadId!, parentThreadId: thread.id, agentNickname: 'crossflow_sol', preview: '子代理验证', cwd: thread.cwd, createdAt: thread.createdAt, updatedAt: thread.updatedAt, status: { type: 'idle' }, turns: [] })
          turn.items.push(activity); emit(thread.id, 'item/completed', { turnId: turn.id, item: activity })
          finish(thread, turn, '已记录子代理交互。'); return
        }
        if (text.startsWith('队列任务')) return
        if (text.includes('思考适配') || text.includes('思考计时')) {
          const reasoning: Item = { id: 'reasoning-' + turn.id, type: 'reasoning', summary: [], content: [] }
          turn.items.push(reasoning); emit(thread.id, 'item/started', { turnId: turn.id, item: reasoning })
          const delta = '先检查事件顺序，再确认图文输入保持原始位置。'
          reasoning.content = [delta]
          emit(thread.id, 'item/reasoning/textDelta', { turnId: turn.id, itemId: reasoning.id, contentIndex: 0, delta })
          return
        }
        if (text.includes('多个审批')) {
          for (const command of ['printf first', 'printf second']) { const id = ++requestId; pending.set(id, { thread, turn, kind: 'approval' }); emit(thread.id, 'item/commandExecution/requestApproval', { turnId: turn.id, itemId: 'command-' + id, command, cwd: thread.cwd, reason: '测试审批', availableDecisions: ['accept', 'decline', 'cancel'] }, id) }; return
        }
        if (text.includes('权限') || text.includes('提问')) {
          const id = ++requestId, question = text.includes('提问')
          pending.set(id, { thread, turn, kind: question ? 'question' : 'approval' })
          emit(thread.id, question ? 'item/tool/requestUserInput' : 'item/commandExecution/requestApproval', question ? { turnId: turn.id, itemId: 'question', questions: [{ id: 'approach', header: '方案', question: '你想采用哪个方案？', isOther: true, isSecret: false, options: [{ label: '方案 A', description: '优先保持简单。' }, { label: '方案 B', description: '采用扩展方案。' }] }] } : { turnId: turn.id, itemId: 'command', command: 'printf test', cwd: thread.cwd, reason: '测试中的执行请求，需要你明确同意。', availableDecisions: ['accept', 'decline', 'cancel'] }, id)
        } else stream(thread, turn, text.includes('长任务'), text.includes('安全测试'))
        return
      }
      ws.send(JSON.stringify({ id: message.id, error: { code: -32601, message: 'Unknown method: ' + method } }))
    },
  },
})
console.log('Test daemon listening on ' + server.port)
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { server.stop(true); rmSync(uploadRoot, { recursive: true, force: true }); process.exit(0) })
