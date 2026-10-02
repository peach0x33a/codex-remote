import hljs from 'highlight.js/lib/common'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import powershell from 'highlight.js/lib/languages/powershell'

hljs.registerLanguage('dockerfile', dockerfile)
hljs.registerLanguage('powershell', powershell)

const aliases = new Map([['vue', 'xml'], ['svelte', 'xml'], ['astro', 'xml'], ['shell', 'bash'], ['zsh', 'bash']])
const cache = new Map<string, string>()
const MAX_CODE_LENGTH = 20_000, MAX_CACHE_LENGTH = 500_000, MAX_CACHE_ENTRIES = 64
let cacheLength = 0

/** Empty results let MarkdownIt escape plain/unknown/oversized code itself. */
export function highlightCode(code: string, hint: string): string {
  const name = hint.trim().toLowerCase(), language = aliases.get(name) || name
  // Never guess a language during streaming: auto-detection repeatedly parses
  // every block against many grammars, including ordinary text and log output.
  if (!code || code.length > MAX_CODE_LENGTH || !language || !hljs.getLanguage(language)) return ''
  const key = language + '\n' + code, cached = cache.get(key)
  if (cached !== undefined) { cache.delete(key); cache.set(key, cached); return cached }
  try {
    const html = hljs.highlight(code, { language, ignoreIllegals: true }).value
    const weight = key.length + html.length
    if (weight <= MAX_CACHE_LENGTH) {
      while (cache.size && (cache.size >= MAX_CACHE_ENTRIES || cacheLength + weight > MAX_CACHE_LENGTH)) {
        const oldest = cache.keys().next().value!
        cacheLength -= oldest.length + cache.get(oldest)!.length; cache.delete(oldest)
      }
      cache.set(key, html); cacheLength += weight
    }
    return html
  } catch { return '' }
}
