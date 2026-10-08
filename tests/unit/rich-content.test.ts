import { expect, test } from 'bun:test'
import { elicitationContent, elicitationFields } from '../../src/lib/elicitation'
import { toolContent, resolveImageFileId } from '../../src/lib/tool-content'
import { messageParts, toInputs, messageEditError } from '../../src/lib/prompt'
import { parseHistoryInput } from '../../shared/input-history'
import { markdownEngine } from '../../src/lib/markdown-engine'

test('preserves native audio through history, editing and re-submission without losing its source', () => {
  const inputs = parseHistoryInput([{ type: 'audio', url: 'data:audio/wav;base64,UklGRg==' }, { type: 'localAudio', path: '/tmp/voice.wav' }])
  expect(toInputs(messageParts(inputs))).toEqual(inputs)
  expect(messageEditError({ id: 'u', type: 'userMessage', content: inputs })).toBeUndefined()
  expect(messageParts(inputs).map(p => p.type)).toEqual(['audio', 'audio'])
})

test('extracts tool media, resource links and text, while preserving unknown blocks', () => {
  expect(toolContent({ id: 'm', type: 'mcpToolCall', result: { content: [{ type: 'text', text: '**结果**' }, { type: 'image', mimeType: 'image/png', data: 'aW1hZ2U=' }, { type: 'audio', mimeType: 'audio/wav', data: 'UklGRg==' }, { type: 'resource_link', uri: '/tmp/result.pdf', name: '结果' }, { type: 'future', special: true }] } }).map(p => p.type)).toEqual(['text', 'image', 'audio', 'link', 'unknown'])
  expect(toolContent({ id: 'd', type: 'dynamicToolCall', contentItems: [{ type: 'inputImage', imageUrl: 'https://example.com/a.png' }, { type: 'inputAudio', audioUrl: 'https://example.com/a.wav' }] }).map(p => p.type)).toEqual(['image', 'audio'])
  expect(toolContent({ id: 'g', type: 'imageGeneration', result: 'ignored', savedPath: '/tmp/output.png' })[0]).toMatchObject({ type: 'image', src: '/tmp/output.png' })
  expect(resolveImageFileId([{ id: 'u', type: 'userMessage', content: [{ type: 'image', fileId: 'file-1', url: 'https://example.com/a.png' }] }], 'file-1')).toBe('https://example.com/a.png')
  expect(resolveImageFileId([], 'opaque')).toBeUndefined()
})

test('renders formula delimiters and readonly tasks without treating code or unsafe TeX as executable content', () => {
  for (const input of ['$x^2$', '$$x^2$$', '\\(x^2\\)', '\\[x^2\\]']) expect(markdownEngine.render(input)).toContain('class="katex')
  const html = markdownEngine.render('- [x] 完成\n- [ ] 待办')
  expect(html).toContain('disabled=""'); expect(html).toContain('checked=""')
  expect(markdownEngine.render('`$x^2$`')).not.toContain('katex')
  expect(markdownEngine.render('$\\href{javascript:alert(1)}{x}$')).not.toContain('href="javascript:')
  expect(markdownEngine.render('```mermaid\ngraph TD; A-->B\n```')).toContain('data-markdown-diagram')
})

test('MCP form validates required/optional fields, false booleans, numeric boundaries and both enum variants', () => {
  const fields = elicitationFields({ type: 'object', required: ['name', 'count', 'confirm', 'choices'], properties: {
    name: { type: 'string', minLength: 2, maxLength: 4 }, count: { type: 'integer', minimum: 1, maximum: 3 }, confirm: { type: 'boolean' },
    choices: { type: 'array', minItems: 1, items: { anyOf: [{ const: 'a', title: '甲' }, { const: 'b', title: '乙' }] } },
    optional: { type: 'string', oneOf: [{ const: 'x', title: '选项' }] },
  } })
  expect(elicitationContent(fields, { name: '中文', count: '2', confirm: false, choices: ['a'] })).toEqual({ name: '中文', count: 2, confirm: false, choices: ['a'] })
  for (const values of [{}, { name: '中文', count: '1.5', confirm: false, choices: ['a'] }, { name: '中文', count: '2', confirm: false, choices: ['invalid'] }, { name: '中文', count: '2', confirm: false, choices: ['a', 'a'] }]) expect(() => elicitationContent(fields, values)).toThrow()
  expect(() => elicitationFields({ type: 'object', properties: { nested: { type: 'object' } } })).toThrow()
  expect(() => elicitationFields({ type: 'object', properties: { regex: { type: 'string', pattern: '(a+)+$' } } })).toThrow()
  expect(() => elicitationFields({ type: 'object', properties: {}, oneOf: [{ required: ['unrepresented'] }] })).toThrow()
  expect(() => elicitationFields({ type: 'object', properties: { list: { type: 'string', minLength: -1 } } })).toThrow()
})

test('MCP fields cannot poison prototypes and invalid dates are rejected', () => {
  const fields = elicitationFields(JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string"},"date":{"type":"string","format":"date"}}}'))
  const result = elicitationContent(fields, JSON.parse('{"__proto__":"safe","date":"2026-10-08"}'))
  expect(Object.getPrototypeOf(result)).toBeNull(); expect(result.__proto__).toBe('safe')
  expect(() => elicitationContent(fields, { date: '2026-02-31' })).toThrow()
})
