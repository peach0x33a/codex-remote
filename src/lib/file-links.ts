export type FileLinkTarget = { path: string; line?: number; column?: number }

/** Markdown paths belong to the conversation's device, never the web origin. */
export function parseFileLink(href: string): FileLinkTarget | null {
  if (!href || href.startsWith('#') || href.startsWith('//')) return null
  let raw = href
  if (/^file:/i.test(raw)) {
    try {
      const url = new URL(raw)
      if (url.hostname && url.hostname !== 'localhost') return null
      raw = url.pathname + url.hash
    } catch { return null }
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^[a-z]:[\\/]/i.test(raw)) return null
  const hash = raw.indexOf('#')
  const fragment = hash < 0 ? '' : raw.slice(hash + 1)
  if (hash >= 0) raw = raw.slice(0, hash)
  try { raw = decodeURIComponent(raw) } catch { return null }
  if (!raw || /[\u0000-\u001f\u007f]/.test(raw)) return null
  const location = /^(.*?):([1-9]\d*)(?::([1-9]\d*))?$/.exec(raw)
  const lineFragment = /^L([1-9]\d*)(?:C([1-9]\d*))?(?:-L?\d+(?:C\d+)?)?$/.exec(fragment)
  const path = location ? location[1]! : raw
  const line = Number(lineFragment?.[1] || location?.[2])
  const column = Number(lineFragment?.[2] || location?.[3])
  return { path, ...(Number.isSafeInteger(line) && line > 0 ? { line } : {}), ...(Number.isSafeInteger(column) && column > 0 ? { column } : {}) }
}

export function fileLinkFromEvent(event: MouseEvent): FileLinkTarget | null {
  const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button[data-workspace-path]') : null
  if (!button || !(event.currentTarget instanceof Element) || !event.currentTarget.contains(button)) return null
  const path = button.dataset.workspacePath
  if (!path) return null
  event.preventDefault()
  const line = Number(button.dataset.workspaceLine), column = Number(button.dataset.workspaceColumn)
  return { path, ...(Number.isSafeInteger(line) && line > 0 ? { line } : {}), ...(Number.isSafeInteger(column) && column > 0 ? { column } : {}) }
}
