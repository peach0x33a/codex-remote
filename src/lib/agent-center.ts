import type { Item, Thread, Turn } from '../../shared/protocol'

export type AgentState = 'needsYou' | 'working' | 'ready' | 'inactive' | 'unknown'
export type AgentFilter = 'all' | Exclude<AgentState, 'unknown'>
export type AgentGrouping = 'project' | 'status' | 'model'
export type AgentThread = Omit<Thread, 'status'> & {
  recencyAt?: number | null
  status?: { type: string; activeFlags?: string[] }
  ephemeral?: boolean; parentThreadId?: string | null; sessionId?: string
  source?: unknown; agentNickname?: string | null; modelProvider?: string
  reasoningEffort?: string | null; gitInfo?: { branch?: string | null } | null
}
export type AgentRow = { thread: AgentThread; members: AgentThread[]; state: AgentState; searchText: string }
export type AgentGroup = { key: string; label: string; rows: AgentRow[] }
export type AgentUsage = {
  threadId: string
  groups: { inputTokens?: number | null; outputTokens?: number | null; totalTokens?: number | null }[]
}
export const AGENT_STATE_LABELS: Record<AgentState, string> = { needsYou: '需处理', working: '进行中', ready: '空闲', inactive: '未加载', unknown: '状态未知' }
export const AGENT_FILTERS: { value: AgentFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  ...(['needsYou', 'working', 'ready', 'inactive'] as const).map(value => ({ value, label: AGENT_STATE_LABELS[value] })),
]
// Unknown is explicit and outranks idle/unloaded; an unfamiliar status never implies completion.
const priority: Record<AgentState, number> = { needsYou: 0, working: 1, unknown: 2, ready: 3, inactive: 4 }

export function agentState(status: AgentThread['status']): AgentState {
  switch (status?.type) {
    case 'active': return status.activeFlags?.some(flag => flag === 'waitingOnApproval' || flag === 'waitingOnUserInput') ? 'needsYou' : 'working'
    case 'systemError': return 'needsYou'
    case 'idle': return 'ready'
    case 'notLoaded': return 'inactive'
    default: return 'unknown'
  }
}
export function agentTitle(thread: AgentThread): string {
  return (thread.name?.trim() || thread.preview?.trim() || thread.agentNickname?.trim() || '未命名会话').split(/\r?\n/)[0]
}

function parentId(thread: AgentThread): string | undefined {
  if (thread.parentThreadId) return thread.parentThreadId
  // Compatibility with source-only ancestry in older thread projections.
  const source = thread.source as { subAgent?: { thread_spawn?: { parent_thread_id?: unknown } } } | null
  const parent = source?.subAgent?.thread_spawn?.parent_thread_id
  return typeof parent === 'string' ? parent : undefined
}

export function buildAgentRows(threads: AgentThread[]): AgentRow[] {
  const byId = new Map(threads.filter(thread => !thread.ephemeral).map(thread => [thread.id, thread]))
  const children = new Map<string, AgentThread[]>()
  for (const thread of byId.values()) {
    const parent = parentId(thread)
    if (parent && parent !== thread.id && byId.has(parent)) {
      const siblings = children.get(parent) || []
      siblings.push(thread); children.set(parent, siblings)
    }
  }
  const visited = new Set<string>(), rows: AgentRow[] = []
  function append(root: AgentThread) {
    if (visited.has(root.id)) return
    const members: AgentThread[] = [], pending = [root]
    while (pending.length) {
      const thread = pending.pop()!
      if (visited.has(thread.id)) continue
      visited.add(thread.id); members.push(thread)
      pending.push(...children.get(thread.id) || [])
    }
    const state = members.map(thread => agentState(thread.status)).sort((a, b) => priority[a] - priority[b])[0]
    const searchText = members.map(thread => [thread.id, thread.name, thread.preview, thread.cwd, thread.model, thread.agentNickname, thread.gitInfo?.branch].filter(Boolean).join(' ')).join(' ').toLocaleLowerCase()
    rows.push({ thread: root, members, state, searchText })
  }
  for (const thread of byId.values()) if (!byId.has(parentId(thread) || '')) append(thread)
  // Missing ancestors and malformed cycles stay inspectable without recursive loops.
  for (const thread of byId.values()) append(thread)
  return rows.sort((a, b) => priority[a.state] - priority[b.state] || b.thread.updatedAt - a.thread.updatedAt || a.thread.id.localeCompare(b.thread.id))
}

export function filterAgentRows(rows: AgentRow[], query: string, filter: AgentFilter): AgentRow[] {
  const search = query.trim().toLocaleLowerCase()
  return rows.filter(row => (filter === 'all' || row.state === filter) && (!search || row.searchText.includes(search)))
}
export function groupAgentRows(rows: AgentRow[], grouping: AgentGrouping): AgentGroup[] {
  const groups = new Map<string, AgentGroup>()
  for (const row of rows) {
    const key = grouping === 'status' ? row.state : grouping === 'model' ? row.thread.model || '' : row.thread.cwd || ''
    const label = grouping === 'status' ? AGENT_STATE_LABELS[row.state] : key || (grouping === 'model' ? '模型未提供' : '目录未提供')
    const group = groups.get(key) || { key, label, rows: [] }
    group.rows.push(row); groups.set(key, group)
  }
  return [...groups.values()].sort((a, b) => grouping === 'status' ? priority[a.key as AgentState] - priority[b.key as AgentState] : a.label.localeCompare(b.label)).map(group => ({
    ...group, rows: [...group.rows].sort((a, b) => b.thread.updatedAt - a.thread.updatedAt || a.thread.id.localeCompare(b.thread.id)),
  }))
}

function itemText(item: Item): string {
  const text = item.text ?? item.content?.map(part => typeof part === 'string' ? part : part.text ?? (part.type === 'image' || part.type === 'localImage' ? '[图片]' : '')).filter(Boolean).join('\n') ?? ''
  return text.length > 4000 ? text.slice(0, 4000) + '…' : text
}
export function recentAgentMessages(turns: Turn[]): { user?: string; agent?: string } {
  const messages: { user?: string; agent?: string } = {}
  // Caller requests descending turns. Reverse only each turn's chronological items.
  for (const turn of turns) for (const item of [...turn.items].reverse()) {
    if (item.type === 'userMessage' && messages.user === undefined) messages.user = itemText(item)
    if (item.type === 'agentMessage' && messages.agent === undefined) messages.agent = itemText(item)
  }
  return messages
}
export function agentTokenTotals(usage?: AgentUsage | null) {
  const sum = (key: 'inputTokens' | 'outputTokens' | 'totalTokens') => {
    const values = usage?.groups?.map(group => group[key])
    return values?.length && values.every((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0) ? values.reduce((total, value) => total + value, 0) : undefined
  }
  return { input: sum('inputTokens'), output: sum('outputTokens'), total: sum('totalTokens') }
}
