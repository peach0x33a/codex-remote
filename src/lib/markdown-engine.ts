import MarkdownIt from 'markdown-it'
import { parseFileLink } from './file-links'
import { highlightCode } from './code-highlight'

export const markdownEngine = new MarkdownIt({ html: false, linkify: true, breaks: true, highlight: highlightCode })
const validateLink = markdownEngine.validateLink
markdownEngine.validateLink = href => /^file:/i.test(href) ? !!parseFileLink(href) : validateLink(href)
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

markdownEngine.core.ruler.after('inline', 'workspace_file_links', state => {
  for (const block of state.tokens) {
    const links: boolean[] = []
    for (const token of block.children || []) {
      if (token.type === 'link_open') {
        const target = parseFileLink(String(token.attrGet('href') || ''))
        links.push(!!target)
        if (!target) continue
        token.tag = 'button'
        token.attrs = (token.attrs || []).filter(([name]) => name !== 'href' && name !== 'target' && name !== 'rel')
        token.attrSet('type', 'button')
        token.attrSet('class', 'workspace-file-link')
        token.attrSet('data-workspace-path', target.path)
        token.attrSet('title', target.path + (target.line ? ':' + target.line : ''))
        if (target.line) token.attrSet('data-workspace-line', String(target.line))
        if (target.column) token.attrSet('data-workspace-column', String(target.column))
      } else if (token.type === 'link_close' && links.pop()) token.tag = 'button'
    }
  }
})
const originalLink = markdownEngine.renderer.rules.link_open
markdownEngine.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
  if (tokens[index].tag === 'button') return renderer.renderToken(tokens, index, options)
  tokens[index].attrSet('target', '_blank')
  tokens[index].attrSet('rel', 'noopener noreferrer')
  return originalLink ? originalLink(tokens, index, options, env, renderer) : renderer.renderToken(tokens, index, options)
}
markdownEngine.renderer.rules.image = (tokens, index) => '<span class="image-label">[图片：' + markdownEngine.utils.escapeHtml(tokens[index].content || '未命名') + ']</span>'

for (const kind of ['fence', 'code_block'] as const) {
  const renderCode = markdownEngine.renderer.rules[kind]!
  markdownEngine.renderer.rules[kind] = (tokens, index, options, env, renderer) => {
    const language = markdownEngine.utils.escapeHtml(tokens[index].info.trim().split(/\s+/, 1)[0] || '代码')
    return '<div class="markdown-code-block"><div class="markdown-code-header"><span class="markdown-code-language">' + language
      + '</span><button type="button" class="markdown-code-copy" aria-label="复制代码">复制</button></div>'
      + renderCode(tokens, index, options, env, renderer) + '</div>\n'
  }
}
