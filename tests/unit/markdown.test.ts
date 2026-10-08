import { describe, expect, test } from 'bun:test'
import { markdownEngine as markdown } from '../../src/lib/markdown-engine'
import { highlightCode } from '../../src/lib/code-highlight'
const tick = String.fromCharCode(96)

test('adds copy controls only to escaped fenced and indented code, including unfinished and empty blocks', () => {
  const source = '<script>alert(1)</script> & 你好'
  for (const input of [tick.repeat(3) + 'ts\n' + source + '\n' + tick.repeat(3), '~~~\n' + source, '    ' + source]) {
    const html = markdown.render(input)
    expect(html.match(/aria-label="复制代码"/g)).toHaveLength(1)
    expect(html.replace(/<\/?span\b[^>]*>/g, '')).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; 你好')
    expect(html).not.toContain('<script>')
  }
  expect(markdown.render(tick.repeat(3) + 'text\n' + tick.repeat(3))).toContain('aria-label="复制代码"')
  expect(markdown.render('~~~\n' + source)).toContain('你好</code>')
  expect(markdown.render(tick + 'inlineOnly' + tick)).not.toContain('复制代码')
  const hostile = markdown.render('~~~<img/src=x/onerror=alert(1)>\ncode\n~~~')
  expect(hostile).not.toContain('<img')
  expect(hostile).toContain('&lt;img/src=x/onerror=alert(1)&gt;')
})

test('highlights common code languages and aliases without changing code text', () => {
  const entities: Record<string, string> = { lt: '<', gt: '>', quot: '"', '#x27': "'", amp: '&' }
  const cases = [
    ['JS', 'const message = "你好";'], ['ts', 'const count: number = 3'], ['tsx', 'const view = <div>Hello</div>'],
    ['py', 'def greet(name):\n    return "Hello " + name'], ['go', 'func main() { return }'], ['rs', 'fn main() { let x = 3; }'],
    ['bash', 'if true; then echo "$HOME"; fi'], ['shell', 'echo "$HOME"'], ['json', '{"enabled": true, "count": 3}'],
    ['yaml', 'enabled: true'], ['sql', 'SELECT name FROM users WHERE id = 1;'], ['css', '.panel { color: red; }'],
    ['html', '<div title="你好">&amp;</div>'], ['vue', '<template><div>{{ message }}</div></template>'],
    ['dockerfile', 'FROM alpine:3\nRUN echo hello'], ['powershell', '$name = "hello"'],
  ]
  for (const [language, code] of cases) {
    const html = highlightCode(code!, language!)
    expect(html).toContain('class="hljs-')
    const text = html.replace(/<\/?span\b[^>]*>/g, '').replace(/&(lt|gt|quot|#x27|amp);/g, (_, entity: string) => entities[entity]!)
    expect(text).toBe(code!)
  }
})

test('keeps unsafe, unknown, plain and oversized blocks escaped with copy controls', () => {
  const unsafe = '<script>alert(1)</script><img src=x onerror=alert(1)> & 你好'
  for (const language of ['html', 'javascript', 'missing-language', '__proto__', 'constructor', 'text', '']) {
    const html = markdown.render('~~~' + language + '\n' + unsafe + '\n~~~')
    expect(html).not.toContain('<script>'); expect(html).not.toContain('<img ')
    expect(html).toContain('aria-label="复制代码"')
    if (['missing-language', '__proto__', 'constructor', 'text', ''].includes(language)) expect(html).not.toContain('hljs-')
  }
  const oversized = 'const x = 1;\n'.repeat(2000)
  expect(highlightCode(oversized, 'js')).toBe('')
  const html = markdown.render('~~~js\n' + oversized + '~~~')
  expect(html).toContain(oversized); expect(html).not.toContain('hljs-')
  expect(html).toContain('aria-label="复制代码"')
})

test('updates incomplete streamed code and retains correct results after cache eviction', () => {
  const partial = highlightCode('const text = "你', 'js')
  const completed = highlightCode('const text = "你好"', 'js')
  expect(partial).toContain('你'); expect(partial).not.toContain('你好'); expect(completed).toContain('你好')
  for (let index = 0; index < 80; index++) highlightCode('const value = ' + index, 'js')
  expect(highlightCode('const text = "你好"', 'js')).toBe(completed)
})

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
  test('does not change URL destinations or enable unsafe HTML', () => {
    const href = 'https://example.com/path/**验证：**最新'
    expect(markdown.parseInline('[链接](' + href + ')', {})[0].children?.find(t => t.type === 'link_open')?.attrGet('href')).toContain('**')
    expect(markdown.render('<script>alert(1)</script> **验证：**通过')).not.toContain('<script>')
    expect(markdown.render('![远程图片](https://tracker.example/pixel)')).not.toContain('<img')
    expect(markdown.render('[危险](javascript:alert(1))')).not.toContain('href="javascript:')
  })
})

test('preserves local and remote image sources as escaped inert placeholders', () => {
  for (const src of ['/tmp/bf1-server-search-preview.png', './preview.png', 'https://example.com/preview.png', 'file:///tmp/preview.png']) {
    const html = markdown.render('![渲染预览](' + src + ')')
    expect(html).toContain('data-markdown-image="' + src + '"')
    expect(html).toContain('data-image-name="渲染预览"')
    expect(html).not.toContain('<img')
  }
  expect(markdown.render('![危险](javascript:alert(1))')).not.toContain('data-markdown-image')
  expect(markdown.render('![&quot; onerror=alert(1)](/tmp/a.png)')).toContain('data-image-name="&amp;quot; onerror=alert(1)"')
})
