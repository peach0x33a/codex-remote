export type DiffLine = { text: string; kind: 'context' | 'added' | 'removed' | 'meta'; old?: number; next?: number }
export type SplitDiffLine = { left?: DiffLine; right?: DiffLine; meta?: DiffLine }

/** Line numbers are obtained from hunk headers, never inferred for raw file contents. */
export function diffLines(diff: string): DiffLine[] {
  let old = 0, next = 0, oldLeft = 0, newLeft = 0
  return diff.replace(/\n$/, '').split('\n').map(text => {
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(text)
    if (header) {
      old = Number(header[1]); next = Number(header[3])
      oldLeft = header[2] === undefined ? 1 : Number(header[2]); newLeft = header[4] === undefined ? 1 : Number(header[4])
      return { text, kind: 'meta' }
    }
    if (oldLeft > 0 || newLeft > 0) {
      if (text.startsWith('+') && newLeft > 0) { newLeft--; return { text, kind: 'added', next: next++ } }
      if (text.startsWith('-') && oldLeft > 0) { oldLeft--; return { text, kind: 'removed', old: old++ } }
      if (text.startsWith(' ') && oldLeft > 0 && newLeft > 0) { oldLeft--; newLeft--; return { text, kind: 'context', old: old++, next: next++ } }
      if (text.startsWith('\\ No newline')) return { text, kind: 'meta' }
      oldLeft = newLeft = 0
    }
    return { text, kind: 'meta' }
  })
}

export function splitDiffLines(lines: DiffLine[]): SplitDiffLine[] {
  const result: SplitDiffLine[] = []
  for (let index = 0; index < lines.length;) {
    const line = lines[index]!
    if (line.kind === 'meta') { result.push({ meta: line }); index++; continue }
    if (line.kind === 'context') { result.push({ left: line, right: line }); index++; continue }
    const removed: DiffLine[] = [], added: DiffLine[] = []
    while (lines[index]?.kind === 'removed') removed.push(lines[index++]!)
    while (lines[index]?.kind === 'added') added.push(lines[index++]!)
    for (let row = 0; row < Math.max(removed.length, added.length); row++) result.push({ left: removed[row], right: added[row] })
  }
  return result
}
