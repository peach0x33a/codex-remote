import { describe, expect, test } from 'bun:test'
import { markdownEngine as markdown } from '../../src/lib/markdown-engine'
const tick = String.fromCharCode(96)

describe('CJK Markdown emphasis compatibility', () => {
  test('renders a punctuation-ending bold label adjacent to Chinese text', () => {
    expect(markdown.render('**验证：**最新类型检查通过。')).toBe('<p><strong>验证：</strong>最新类型检查通过。</p>\n')
    expect(markdown.render('前文**注意！**后文')).toBe('<p>前文<strong>注意！</strong>后文</p>\n')
  })
  test('handles closing-marker padding in streamed CJK labels', () => {
    expect(markdown.render('**验证： **最新类型检查通过。')).toContain('<strong>验证：</strong>最新')
  })
  test('keeps normal strong, lists, links, and separate labels working', () => {
    const html = markdown.render('- **正常加粗**\n- [链接](https://example.com)\n\n**验证：**通过。**说明：**正常。')
    expect(html).toContain('<ul>'); expect(html).toContain('<strong>正常加粗</strong>')
    expect(html).toContain('href="https://example.com"'); expect(html).toContain('rel="noopener noreferrer"')
    expect(html).toContain('<strong>验证：</strong>'); expect(html).toContain('<strong>说明：</strong>')
  })
  test('does not reinterpret escaped delimiters or inline/fenced code', () => {
    expect(markdown.render('\\*\\*验证：\\*\\*最新')).not.toContain('<strong>')
    expect(markdown.render(tick + '**验证：**最新' + tick)).toContain('<code>**验证：**最新</code>')
    expect(markdown.render(tick.repeat(3) + 'text\n**验证：**最新\n' + tick.repeat(3))).toContain('**验证：**最新\n</code>')
  })
  test('does not change URL destinations or enable unsafe HTML/images', () => {
    const href = 'https://example.com/path/**验证：**最新'
    expect(markdown.parseInline('[链接](' + href + ')', {})[0].children?.find(t => t.type === 'link_open')?.attrGet('href')).toContain('**')
    expect(markdown.render('<script>alert(1)</script> **验证：**通过')).not.toContain('<script>')
    expect(markdown.render('![远程图片](https://tracker.example/pixel)')).not.toContain('<img')
    expect(markdown.render('[危险](javascript:alert(1))')).not.toContain('href="javascript:')
  })
})
