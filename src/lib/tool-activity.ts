import type { Item, Turn } from '../../shared/protocol'
import { parseCollabTool } from './collab-tool'

// Matches the local v2/CommandAction.ts binding. Kept structural here so older
// histories and partial live items without commandActions remain valid input.
export type CommandAction =
  | { type: 'read'; command: string; name: string; path: string }
  | { type: 'listFiles'; command: string; path: string | null }
  | { type: 'search'; command: string; query: string | null; path: string | null }
  | { type: 'unknown'; command: string }
export type ActivityRow = { key: string; item: Item } | { key: string; group: Item[]; documentSummary?: boolean }
export type CommandActivityKind = 'read' | 'listFiles' | 'search' | 'unknown'
type ActivityFields = { commandActions?: unknown; namespace?: unknown; exitCode?: unknown; success?: unknown }
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const hasText = (value: unknown): value is string => typeof value === 'string' && !!value.trim()

export function commandActivityKind(item: Item): CommandActivityKind | undefined {
  if (item.type !== 'commandExecution') return undefined
  const actions = (item as Item & ActivityFields).commandActions
  if (!Array.isArray(actions) || !actions.length) return 'unknown'
  for (const type of ['read', 'listFiles', 'search'] as const) {
    if (actions.every(action => record(action) && action.type === type && (type !== 'read' || hasText(action.path)))) return type
  }
  return 'unknown'
}

/** Count only server-reported paths, without inferring shell behavior or names. */
export function readFilePaths(items: Item[]): string[] {
  const paths = new Set<string>()
  for (const item of items) {
    if (commandActivityKind(item) !== 'read') continue
    for (const action of (item as Item & { commandActions: CommandAction[] }).commandActions) {
      if (action.type === 'read') paths.add(action.path)
    }
  }
  return [...paths]
}

function activityIdentity(item: Item): string | undefined {
  switch (item.type) {
    case 'commandExecution': return JSON.stringify([item.type, commandActivityKind(item)])
    case 'mcpToolCall': return hasText(item.server) && hasText(item.tool) ? JSON.stringify([item.type, item.server, item.tool]) : undefined
    case 'dynamicToolCall': return hasText(item.tool) ? JSON.stringify([item.type, (item as Item & ActivityFields).namespace ?? null, item.tool]) : undefined
    case 'subAgentActivity': return JSON.stringify([item.type, item.kind])
    case 'collabAgentToolCall': return hasText(item.tool) ? JSON.stringify([item.type, item.tool]) : undefined
    case 'fileChange': case 'webSearch': case 'imageView': return item.type
    // Messages, reasoning (even empty), compaction and unknown item types are
    // hard boundaries. Never filter them out before grouping.
    default: return undefined
  }
}

export function buildActivityRows(turns: Turn[]): ActivityRow[] {
  const rows: ActivityRow[] = []
  for (const turn of turns) {
    let pending: Item[] = [], identity: string | undefined
    function flush() {
      const first = pending[0]
      if (!first) return
      // No status, count or last item in the key: streaming cannot reset open UI.
      const key = JSON.stringify([turn.id, first.id])
      rows.push(pending.length > 1 || commandActivityKind(first) === 'read' ? { key, group: pending } : { key, item: first })
      pending = []
    }
    for (const item of turn.items) {
      const nextIdentity = activityIdentity(item)
      if (!nextIdentity || nextIdentity !== identity) flush()
      pending.push(item); identity = nextIdentity
      if (!nextIdentity) flush()
    }
    flush()
  }
  return rows
}

/** Collapse repeated read/edit calls across intervening activity, but never
 * across turns or another user message. Other rows keep their source order. */
export function buildDocumentActivityRows(turns: Turn[]): ActivityRow[] {
  const result: ActivityRow[] = []
  const documentCall = (item: Item) => item.type === 'fileChange' || commandActivityKind(item) === 'read'
  for (const turn of turns) {
    let segment: Item[] = []
    const flush = () => {
      const eligible = [...new Map(segment.filter(documentCall).map(item => [item.id, item])).values()]
      const positions = segment.flatMap((item, index) => documentCall(item) ? [index] : [])
      const aggregate = eligible.length > 1 && (new Set(eligible.map(item => item.type)).size > 1 || positions.some((value, index) => index > 0 && value > positions[index - 1]! + 1))
      let inserted = false
      for (const row of buildActivityRows([{ ...turn, items: segment }])) {
        const items = 'group' in row ? row.group : [row.item]
        if (aggregate && items.every(documentCall)) { if (!inserted) { result.push({ key: row.key, group: eligible, documentSummary: true }); inserted = true } }
        else result.push(row)
      }
      segment = []
    }
    for (const item of turn.items) { if (item.type === 'userMessage') flush(); segment.push(item) }
    flush()
  }
  return result
}
export function documentActivityTitle(items: Item[]) { return '合计 ' + items.filter(item => commandActivityKind(item) === 'read').length + ' 次读取，' + items.filter(item => item.type === 'fileChange').length + ' 次变更' }

export function toolActivityState(item: Item) {
  const fields = item as Item & ActivityFields
  const failed = item.status === 'failed' || !!item.error || fields.success === false ||
    item.type === 'commandExecution' && typeof fields.exitCode === 'number' && fields.exitCode !== 0
  const completed = !failed && (item.status === 'completed' || item.type === 'subAgentActivity' && !!parseCollabTool(item)?.completed)
  const running = !failed && !completed && item.status === 'inProgress'
  const labels: Record<string, string> = { inProgress: '进行中', completed: '已完成', failed: '失败', declined: '已拒绝', interrupted: '已中断', cancelled: '已取消', canceled: '已取消' }
  const label = failed ? '失败' : item.type === 'subAgentActivity' && completed ? '已记录' : Object.hasOwn(labels, item.status || '') ? labels[item.status!]! : item.status ? '状态未知' : ''
  return { failed, completed, running, label }
}

export function toolActivityError(item: Item): string {
  if (hasText(item.error)) return item.error
  if (record(item.error) && hasText(item.error.message)) return item.error.message
  if (item.error) return JSON.stringify(item.error, null, 2)
  const exitCode = (item as Item & ActivityFields).exitCode
  return item.type === 'commandExecution' && typeof exitCode === 'number' && exitCode !== 0 ? `命令退出码：${exitCode}` : ''
}

export function toolActivityTitle(item: Item): string {
  if (item.type === 'commandExecution') {
    const kind = commandActivityKind(item)
    if (kind === 'read') return '读取 ' + readFilePaths([item]).join('、')
    return item.command?.replace(/\s+/g, ' ').trim() || ({ listFiles: '列出目录', search: '搜索文件', unknown: '运行命令' })[kind as Exclude<CommandActivityKind, 'read'>]
  }
  const collab = parseCollabTool(item)
  if (collab) return collab.title
  if (item.type === 'mcpToolCall') return [item.server, item.tool].filter(hasText).join(' · ') || '调用工具'
  if (item.type === 'dynamicToolCall') return [(item as Item & ActivityFields).namespace, item.tool].filter(hasText).join(' · ') || '调用工具'
  return ({ fileChange: '文件变更', webSearch: '搜索网页', imageView: '查看图片' } as Record<string, string>)[item.type] || item.type
}

export function summarizeToolActivity(items: Item[]) {
  const first = items[0], states = items.map(toolActivityState)
  const completed = !!items.length && states.every(state => state.completed)
  const failedCount = states.filter(state => state.failed).length
  const failed = failedCount > 0, running = states.some(state => state.running)
  const labels = new Map<string, number>()
  for (const state of states) { const label = state.label || '状态未知'; labels.set(label, (labels.get(label) || 0) + 1) }
  const status = [...labels].map(([label, count]) => `${count} 项${label}`).join('，')
  const prefix = completed ? '已' : running ? '正在' : ''
  let title = '工具调用'
  const kind = first && commandActivityKind(first)
  if (kind === 'read') title = `${prefix}读取 ${readFilePaths(items).length} 个文件`
  else if (kind === 'listFiles') title = `${prefix}查看 ${items.length} 次目录`
  else if (kind === 'search') title = `${prefix}搜索 ${items.length} 次`
  else if (kind === 'unknown') title = `${prefix}运行 ${items.length} 个命令`
  else if (first?.type === 'webSearch') title = `${prefix}搜索 ${items.length} 次网页`
  else if (first?.type === 'imageView') title = `${prefix}查看 ${items.length} 张图片`
  else if (first?.type === 'fileChange') title = `${prefix}执行 ${items.length} 次文件变更`
  else if (first) title = `${prefix}调用 ${items.length} 次 ${toolActivityTitle(first)}`
  return { title, status, completed, failed, failedCount, running, kind }
}
