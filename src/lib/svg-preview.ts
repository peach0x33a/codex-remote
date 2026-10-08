import DOMPurify from 'dompurify'

/** Raster-like SVG presentation: no scripts, embedded HTML or external resources. */
export function sanitizedSvg(source: string, naturalSize = false): string {
  if (source.length > 8 * 1024 * 1024) throw new Error('SVG 文件过大。')
  const clean = DOMPurify.sanitize(source, { USE_PROFILES: { svg: true, svgFilters: true }, FORBID_TAGS: ['script', 'foreignObject', 'image', 'a', 'animate', 'animateMotion', 'animateTransform', 'set'] })
  const doc = new DOMParser().parseFromString(clean, 'image/svg+xml')
  if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'svg') throw new Error('SVG 内容无效。')
  if (naturalSize) {
    const box = (doc.documentElement.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number)
    if (box.length === 4 && box.every(Number.isFinite) && box[2]! > 0 && box[3]! > 0) {
      doc.documentElement.setAttribute('width', String(box[2]))
      doc.documentElement.setAttribute('height', String(box[3]))
    }
  }
  for (const node of doc.querySelectorAll('*')) {
    for (const attr of [...node.attributes]) {
      if ((/^(?:href|xlink:href)$/i.test(attr.name) && !/^#[\w:.-]+$/.test(attr.value)) || /@import|url\(\s*['"]?(?!#)[^)]/i.test(attr.value)) node.removeAttribute(attr.name)
    }
    if (node.localName === 'style' && /@import|url\(\s*['"]?(?!#)[^)]/i.test(node.textContent || '')) node.remove()
  }
  return new XMLSerializer().serializeToString(doc.documentElement)
}
export function svgImageUrl(source: string, naturalSize = false): string {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(sanitizedSvg(source, naturalSize))
}
