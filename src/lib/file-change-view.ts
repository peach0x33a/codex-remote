import type { Item } from '../../shared/protocol'
import { diffCounts } from './thread-insights'

export type FileChangeView = { path: string; name: string; label: string; movePath?: string; diff: string; raw: string; counts?: { added: number; removed: number }; structured: boolean }
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim()
const encoder = new TextEncoder()

export function fileChangeViews(item: Item): FileChangeView[] {
  if (item.type !== 'fileChange' || !Array.isArray(item.changes)) return []
  return item.changes.filter(record).filter(change => text(change.path)).map(change => {
    const path = change.path as string, raw = typeof change.diff === 'string' ? change.diff : ''
    const kind = record(change.kind) ? change.kind.type : change.kind
    const movePath = record(change.kind) && text(change.kind.move_path) ? change.kind.move_path : undefined
    const view: FileChangeView = { path, name: path.split(/[\\/]/).filter(Boolean).at(-1) || path, label: movePath ? '移动' : kind === 'add' ? '新增' : kind === 'delete' ? '删除' : kind === 'update' ? '修改' : '变更', movePath, diff: raw, raw, structured: false }
    // Native add/delete payloads are whole file contents, even when the file itself contains a diff.
    if (encoder.encode(raw).length > 2 * 1024 * 1024 || raw.split('\n').length > 20_000) return view
    if (kind === 'add' || kind === 'delete') {
      const lines = raw ? raw.replace(/\n$/, '').split('\n') : [], count = lines.length
      view.counts = { added: kind === 'add' ? count : 0, removed: kind === 'delete' ? count : 0 }
      view.diff = count ? (kind === 'add' ? `@@ -0,0 +1,${count} @@\n` : `@@ -1,${count} +0,0 @@\n`) + lines.map(line => (kind === 'add' ? '+' : '-') + line).join('\n') + '\n' : ''
      view.structured = true
    } else {
      view.counts = diffCounts(raw)
      view.structured = !!view.counts
    }
    return view
  })
}
