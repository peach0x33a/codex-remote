/** User-initiated copy, with an HTTP-compatible fallback and no popup side effects. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator.clipboard?.writeText === 'function') {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch { /* Browser policy may disallow the asynchronous clipboard API. */ }
  if (typeof document.execCommand !== 'function' || !document.body) return false
  const active = document.activeElement as HTMLElement | null
  const selection = window.getSelection()
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange()) : []
  const input = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement ? active : null
  const caret = input ? { start: input.selectionStart, end: input.selectionEnd, direction: input.selectionDirection } : null
  const field = document.createElement('textarea')
  field.value = text; field.readOnly = true
  field.style.cssText = 'position:fixed;left:-10000px;top:0;opacity:0;pointer-events:none'
  field.tabIndex = -1
  const container = active?.closest('dialog, [role="dialog"]') || document.body
  container.append(field)
  try {
    field.focus({ preventScroll: true }); field.select()
    return document.execCommand('copy')
  } catch { return false }
  finally {
    try {
      if (active?.isConnected) active.focus({ preventScroll: true })
      if (selection) { selection.removeAllRanges(); for (const range of ranges) selection.addRange(range) }
      if (input?.isConnected && caret && caret.start !== null && caret.end !== null) input.setSelectionRange(caret.start, caret.end, caret.direction ?? undefined)
    } catch { /* Selection may have disappeared during the browser copy event. */ }
    field.remove()
  }
}
