import { describe, expect, test } from 'bun:test'
import { parseFileLink } from '../../src/lib/file-links'
import { markdownEngine } from '../../src/lib/markdown-engine'

describe('device file links', () => {
  test('recognizes absolute, relative and encoded paths and code locations', () => {
    expect(parseFileLink('/mnt/Apps/Greenlight.AppImage')).toEqual({ path: '/mnt/Apps/Greenlight.AppImage' })
    expect(parseFileLink('src/App.vue:123:4')).toEqual({ path: 'src/App.vue', line: 123, column: 4 })
    expect(parseFileLink('./docs/%E6%96%87%E6%A1%A3.md#L20-L25')).toEqual({ path: './docs/文档.md', line: 20 })
    expect(parseFileLink('file:///home/me/My%20Files/README.md#L2')).toEqual({ path: '/home/me/My Files/README.md', line: 2 })
    expect(parseFileLink('/tmp/a%23b.txt')).toEqual({ path: '/tmp/a#b.txt' })
    expect(parseFileLink('../README.md')).toEqual({ path: '../README.md' })
  })
  test('leaves web and non-file protocols alone and rejects malformed paths', () => {
    for (const value of ['https://example.com/a', 'http://localhost:3000/report', '//example.com/a', 'mailto:user@example.com', '#section', 'javascript:alert(1)', 'data:text/html,x', 'file://other-host/path', '/tmp/%00bad', '/tmp/%zz']) expect(parseFileLink(value)).toBeNull()
  })
  test('renders local links as keyboard-operable buttons without browser navigation', () => {
    const html = markdownEngine.render('[新版 Linux AppImage](/mnt/LibraC/Greenlight.AppImage) · [源文件](src/App.vue:12)')
    expect(html).toContain('<button')
    expect(html).toContain('type="button"')
    expect(html).toContain('data-workspace-path="/mnt/LibraC/Greenlight.AppImage"')
    expect(html).toContain('data-workspace-line="12"')
    expect(html).not.toContain('href=')
    expect(html).not.toContain('target=')
    expect(html).toContain('</button>')
  })
  test('preserves remote URL behavior and sanitizes file-button attributes', () => {
    const html = markdownEngine.render('[文件](file:///tmp/a%22b.txt) [网站](https://example.com) [坏](javascript:alert(1))')
    expect(html).toContain('data-workspace-path="/tmp/a&quot;b.txt"')
    expect(html).toContain('href="https://example.com" target="_blank" rel="noopener noreferrer"')
    expect(html).not.toContain('href="javascript:')
  })
})
