/** Delegate clicks so streaming Markdown always copies the current block. */
export function codeBlockFromEvent(event: MouseEvent): string | null {
  if (!(event.target instanceof Element) || !(event.currentTarget instanceof Element)) return null
  const button = event.target.closest('button.markdown-code-copy')
  if (!button || !event.currentTarget.contains(button)) return null
  const code = button.closest('.markdown-code-block')?.querySelector(':scope > pre > code')
  if (!code) return null
  event.preventDefault()
  return code.textContent ?? ''
}
