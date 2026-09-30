export type ComposerTrigger = { kind: 'command' | 'file'; query: string }
export type ComposerToken = ComposerTrigger & { start: number; end: number }
export type CapturedComposerToken = ComposerToken & { range: Range; trailingSpace?: Range }

// Attachments occupy a boundary, never contribute their filename to a query.
const attachmentBoundary = '\ufffc'
const tokenBoundary = /[\s\ufffc@]/u
const mentionWord = /[\p{L}\p{N}\p{M}\p{Pc}.%+/@\\-]/u

export function composerSuggestionInsertion(kind: ComposerTrigger['kind'], text: string, followingSpace = '') {
  const separateFile = kind === 'file' && text !== '' && !/\s$/u.test(text)
  const reuseTrailingSpace = separateFile && /^[\t\p{Zs}]$/u.test(followingSpace)
  return { text: text + (separateFile && !reuseTrailingSpace ? ' ' : ''), reuseTrailingSpace }
}

/** Offsets use UTF-16, like DOM Range. Query stops at the caret; replacement
 * includes the rest of the token, even when the caret is in its middle. */
export function detectComposerTrigger(text: string, caret: number): ComposerToken | null {
  if (!Number.isInteger(caret) || caret < 0 || caret > text.length) return null
  let start = caret
  while (start > 0 && !tokenBoundary.test(text[start - 1]!)) start--
  if (start > 0 && text[start - 1] === '@') start--
  const prefix = text[start]
  if (caret <= start || (prefix !== '/' && prefix !== '@')) return null
  if (prefix === '/') {
    const lineStart = Math.max(text.lastIndexOf('\n', start - 1), text.lastIndexOf('\r', start - 1)) + 1
    if (!/^[\t\p{Zs}]*$/u.test(text.slice(lineStart, start))) return null
  } else {
    const previous = Array.from(text.slice(0, start)).at(-1)
    if (previous && mentionWord.test(previous)) return null
  }
  let end = caret
  while (end < text.length && !tokenBoundary.test(text[end]!)) end++
  return { kind: prefix === '/' ? 'command' : 'file', query: text.slice(start + 1, caret), start, end }
}

/** Project editable text into a string while retaining its DOM coordinates.
 * Range.toString() alone loses BR/block boundaries and includes image labels. */
export function captureComposerTrigger(root: HTMLElement, caret: Range): CapturedComposerToken | null {
  if (!caret.collapsed || !root.contains(caret.startContainer)) return null
  const element = caret.startContainer.nodeType === Node.ELEMENT_NODE ? caret.startContainer as Element : caret.startContainer.parentElement
  if (element?.closest('[data-attachment-id], [contenteditable="false"]')) return null
  type Run = { start: number; end: number; node: Text; offset: number }
  const runs: Run[] = []
  let text = '', caretOffset: number | undefined
  function walk(node: Node, marker?: { pending: boolean }) {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.textContent || ''
      const skip = marker?.pending ? value.indexOf('\u200b') : -1
      if (skip >= 0) marker!.pending = false
      if (node === caret.startContainer) caretOffset = text.length + caret.startOffset - (skip >= 0 && caret.startOffset > skip ? 1 : 0)
      function append(from: number, to: number) {
        if (to <= from) return
        runs.push({ start: text.length, end: text.length + to - from, node: node as Text, offset: from })
        text += value.slice(from, to)
      }
      if (skip < 0) append(0, value.length)
      else { append(0, skip); append(skip + 1, value.length) }
      return
    }
    if (!(node instanceof HTMLElement)) return
    if (node.hasAttribute('data-attachment-id') || node.contentEditable === 'false') { text += attachmentBoundary; return }
    if (node.tagName === 'BR') { text += '\n'; return }
    const block = node !== root && ['DIV', 'P'].includes(node.tagName)
    if (block && text && !text.endsWith('\n')) text += '\n'
    const childMarker = node.hasAttribute('data-editor-caret') ? { pending: true } : marker
    node.childNodes.forEach((child, index) => {
      if (node === caret.startContainer && index === caret.startOffset) caretOffset = text.length
      walk(child, childMarker)
    })
    if (node === caret.startContainer && caret.startOffset === node.childNodes.length) caretOffset = text.length
    if (block && node.nextSibling && !text.endsWith('\n')) text += '\n'
  }
  walk(root)
  if (caretOffset === undefined) return null
  const token = detectComposerTrigger(text, caretOffset)
  if (!token) return null
  const first = runs.find(run => run.start <= token.start && run.end > token.start)
  const last = runs.find(run => run.start < token.end && run.end >= token.end)
  if (!first || !last) return null
  const range = root.ownerDocument.createRange()
  range.setStart(first.node, first.offset + token.start - first.start)
  range.setEnd(last.node, last.offset + token.end - last.start)
  let trailingSpace: Range | undefined
  if (/[\t\p{Zs}]/u.test(text[token.end] || '')) {
    const next = runs.find(run => run.start <= token.end && run.end > token.end)
    if (next) {
      trailingSpace = root.ownerDocument.createRange()
      trailingSpace.setStart(next.node, next.offset + token.end - next.start)
      trailingSpace.setEnd(next.node, next.offset + token.end - next.start + 1)
    }
  }
  return { ...token, range, trailingSpace }
}
