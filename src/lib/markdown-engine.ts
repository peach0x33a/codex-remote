import MarkdownIt from 'markdown-it'

export const markdownEngine = new MarkdownIt({ html: false, linkify: true, breaks: true })
type Token = ReturnType<typeof markdownEngine.parse>[number]
const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
const cjkNext = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u

// CommonMark treats the closing ** after punctuation as an opener when CJK
// text follows immediately. Repair only unresolved CJK labels in text tokens.
// Escapes remain text_special at this stage; code, URLs and HTML are untouched.
markdownEngine.core.ruler.after('inline', 'cjk_label_strong', state => {
  for (const block of state.tokens) {
    if (!block.children) continue
    const children: Token[] = []
    for (const token of block.children) {
      if (token.type !== 'text' || !token.content.includes('**')) { children.push(token); continue }
      const source = token.content, pattern = /\*\*([^*\r\n]+?)\*\*/g
      let offset = 0, changed = false, match: RegExpExecArray | null
      const push = (type: string, tag: string, nesting: -1 | 0 | 1, content: string, level: number) => {
        const next = new state.Token(type, tag, nesting); next.content = content; next.level = level
        if (nesting) next.markup = '**'
        children.push(next)
      }
      while ((match = pattern.exec(source))) {
        const content = match[1], label = content.trimEnd(), end = match.index + match[0].length
        if (!label || /^\s/.test(label) || !cjk.test(label)) continue
        const padded = label !== content
        if (!padded && !(/[\p{P}\p{S}]$/u.test(label) && cjkNext.test(source.slice(end)))) continue
        if (match.index > offset) push('text', '', 0, source.slice(offset, match.index), token.level)
        push('strong_open', 'strong', 1, '', token.level)
        push('text', '', 0, label, token.level + 1)
        push('strong_close', 'strong', -1, '', token.level)
        offset = end; changed = true
      }
      if (!changed) children.push(token)
      else if (offset < source.length) push('text', '', 0, source.slice(offset), token.level)
    }
    block.children = children
  }
})

const originalLink = markdownEngine.renderer.rules.link_open
markdownEngine.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
  tokens[index].attrSet('target', '_blank')
  tokens[index].attrSet('rel', 'noopener noreferrer')
  return originalLink ? originalLink(tokens, index, options, env, renderer) : renderer.renderToken(tokens, index, options)
}
markdownEngine.renderer.rules.image = (tokens, index) => '<span class="image-label">[图片：' + markdownEngine.utils.escapeHtml(tokens[index].content || '未命名') + ']</span>'
