import type { Thread } from '../../shared/protocol'

export type ThreadAgent = { id: string; name: string; role?: string; status?: string; message?: string }
export type ChangedFile = { path: string; added?: number; removed?: number; diff: string; kind?: string }

/** The automatic footer belongs to the latest turn, not the conversation's history. */
export function latestTurnFiles(thread: Thread | null): ChangedFile[] {
  if (!thread?.turns.length) return []
  return buildThreadInsights({ ...thread, turns: thread.turns.slice(-1) }).files
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

/** Count only complete, recognizable unified hunks, never raw file contents. */
function diffCounts(diff: string): { added: number; removed: number } | undefined {
  let added = 0, removed = 0, oldRemaining = 0, newRemaining = 0, sawHunk = false
  for (const line of diff.split(/\r?\n/)) {
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:.*)$/.exec(line)
    if (hunk) {
      if (oldRemaining || newRemaining) return undefined
      if (!hunk.slice(1).every(value => value === undefined || Number.isSafeInteger(Number(value)))) return undefined
      oldRemaining = hunk[2] === undefined ? 1 : Number(hunk[2])
      newRemaining = hunk[4] === undefined ? 1 : Number(hunk[4])
      sawHunk = true
      continue
    }
    if (line === '\\ No newline at end of file') continue
    if (oldRemaining || newRemaining) {
      // A hunk can contain literal +++/--- text; these are real changed lines.
      if (line.startsWith('+')) { newRemaining--; added++ }
      else if (line.startsWith('-')) { oldRemaining--; removed++ }
      else if (line.startsWith(' ')) { oldRemaining--; newRemaining-- }
      else return undefined
      if (oldRemaining < 0 || newRemaining < 0) return undefined
      continue
    }
    // Native update diffs may append a move note. Headers and metadata are not lines changed.
    if (line === '' || /^(?:diff --git |index |--- |\+\+\+ |(?:new|deleted) file mode |(?:old|new) mode |(?:dis)?similarity index |(?:rename|copy) (?:from|to) |Moved to: )/.test(line)) continue
    return undefined
  }
  return sawHunk && oldRemaining === 0 && newRemaining === 0 ? { added, removed } : undefined
}

type AgentMetadata = { nickname?: string; name?: string; role?: string; status?: string; message?: string }
type FileProjection = { file: ChangedFile; diffs: string[]; knownCounts: boolean }

/**
 * Project only this thread's currently loaded history, in its existing chronological order.
 * Summaries enrich collab targets; they never discover unrelated/global threads.
 * File totals describe recorded patch activity, not a net Git/worktree diff. If any
 * contribution is unrecognized, that file's totals stay unknown. No IO or undo is implied.
 */
export function buildThreadInsights(thread: Thread | null, summaries: Record<string, unknown>[] = []): { agents: ThreadAgent[]; files: ChangedFile[] } {
  if (!thread) return { agents: [], files: [] }
  const metadata = new Map<string, AgentMetadata>()
  for (const summary of summaries) {
    if (!record(summary)) continue
    const id = text(summary.id) ?? text(summary.threadId)
    if (!id) continue
    const previous = metadata.get(id) ?? {}
    const status = record(summary.status) ? text(summary.status.type) : text(summary.status)
    metadata.set(id, {
      nickname: text(summary.agentNickname) ?? previous.nickname,
      name: text(summary.name) ?? previous.name,
      role: text(summary.agentRole) ?? text(summary.role) ?? previous.role,
      status: status ?? previous.status,
      message: text(summary.lastMessage) ?? previous.message,
    })
  }
  const agents = new Map<string, ThreadAgent>(), files = new Map<string, FileProjection>()
  for (const turn of Array.isArray(thread.turns) ? thread.turns : []) {
    if (!record(turn) || !Array.isArray(turn.items)) continue
    const loadedItems: unknown[] = turn.items
    // Repeated lifecycle snapshots of one item are one operation, not extra edits.
    const fileSnapshots = new Map<string, Record<string, unknown>>(), seenFiles = new Set<string>()
    for (const item of loadedItems) if (record(item) && item.type === 'fileChange' && text(item.id)) fileSnapshots.set(item.id as string, item)
    for (const item of loadedItems) {
      if (!record(item)) continue
      if (item.type === 'subAgentActivity') {
        const id = text(item.agentThreadId), path = text(item.agentPath)
        if (id && id !== thread.id) {
          const agent = agents.get(id) ?? { id, name: path?.split('/').filter(Boolean).at(-1) || id }
          if (item.kind === 'started') agent.status = 'running'
          else if (item.kind === 'interrupted') agent.status = 'interrupted'
          else if (item.kind === 'completed') agent.status = 'completed'
          agents.set(id, agent)
        }
      }
      if (item.type === 'collabAgentToolCall') {
        const states = record(item.agentsStates) ? item.agentsStates : {}
        const receivers = Array.isArray(item.receiverThreadIds) ? item.receiverThreadIds : []
        const ids = new Set([...receivers, ...Object.keys(states)].filter((id): id is string => !!text(id) && id !== thread.id))
        for (const id of ids) {
          const agent = agents.get(id) ?? { id, name: id }
          const state = Object.hasOwn(states, id) && record(states[id]) ? states[id] : undefined
          // Tool-call completion (especially wait) says nothing about agent completion.
          if (state) {
            const status = text(state.status)
            if (status) agent.status = status
            if (typeof state.message === 'string' || state.message === null) {
              const message = text(state.message)
              if (message) agent.message = message; else delete agent.message
            }
          }
          agents.set(id, agent)
        }
      }
      if (item.type !== 'fileChange') continue
      const itemId = text(item.id)
      if (itemId && seenFiles.has(itemId)) continue
      if (itemId) seenFiles.add(itemId)
      const fileItem = itemId ? fileSnapshots.get(itemId)! : item
      if (!Array.isArray(fileItem.changes)) continue
      // Pending, failed, and declined patches do not establish that a file was edited.
      if (fileItem.status != null && fileItem.status !== 'completed') continue
      for (const change of fileItem.changes) {
        if (!record(change)) continue
        const path = text(change.path)
        if (!path) continue
        const diff = typeof change.diff === 'string' ? change.diff : ''
        const kind = record(change.kind) ? text(change.kind.type) : text(change.kind)
        const entry = files.get(path) ?? { file: { path, diff: '' }, diffs: [], knownCounts: true }
        // Rust emits complete file contents for add/delete, even when that file is
        // itself a .patch. Only update/legacy diff payloads establish unified stats.
        const counts = kind === 'add' || kind === 'delete' ? undefined : diffCounts(diff)
        if (!counts) entry.knownCounts = false
        if (entry.knownCounts && counts) {
          entry.file.added = (entry.file.added ?? 0) + counts.added
          entry.file.removed = (entry.file.removed ?? 0) + counts.removed
        } else { delete entry.file.added; delete entry.file.removed }
        if (diff) entry.diffs.push(diff)
        if (kind) entry.file.kind = kind
        files.set(path, entry)
      }
    }
  }
  for (const [id, agent] of agents) {
    const summary = metadata.get(id)
    if (!summary) continue
    agent.name = summary.nickname ?? summary.name ?? agent.name
    if (summary.role) agent.role = summary.role
    // Preserve runtime status names such as idle; never translate idle into completed.
    if (!agent.status && summary.status) agent.status = summary.status
    if (!agent.message && summary.message) agent.message = summary.message
  }
  return {
    agents: [...agents.values()],
    files: [...files.values()].map(({ file, diffs }) => ({ ...file, diff: diffs.join('\n') })),
  }
}
