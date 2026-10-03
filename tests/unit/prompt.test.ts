import { describe, expect, test } from 'bun:test'
import { hasPrompt, isLongPaste, pastedTextLabel, mergeItem, messageParts, reasoningPreview, reasoningText, safeImageUrl, toInputs, type PromptPart } from '../../src/lib/prompt'
const image: PromptPart = { type: 'image', id: 'i', name: '示意图.png', url: 'data:image/png;base64,abcd', size: 4 }
test('collapsed pasted text uses native UTF-8 placeholders while preserving every character and attachment order', () => {
  const text = '中😀<script>literal</script>\n'.repeat(60) + '  \n'
  const input = toInputs([{ type: 'text', text: 'before ' }, image, { type: 'text', text, pasteId: 'paste-original' }])
  expect(pastedTextLabel('中😀')).toBe('粘贴的文本 (2字符)')
  expect(input.at(-1)).toEqual({ type: 'text', text, text_elements: [{ byteRange: { start: 0, end: new TextEncoder().encode(text).length }, placeholder: pastedTextLabel(text) }] })
  const restored = messageParts(input)
  expect(restored.at(-1)).toMatchObject({ type: 'text', text, pasteId: expect.any(String) })
  expect((restored.at(-1) as Extract<PromptPart, { type: 'text' }>).pasteId).not.toBe((messageParts(input).at(-1) as Extract<PromptPart, { type: 'text' }>).pasteId)
  expect(toInputs(restored)).toEqual(input)
  expect(isLongPaste(text)).toBe(true); expect(isLongPaste('short\ntext')).toBe(false)
})
describe('ordered multimodal prompts and native reasoning', () => {
  test('keeps an inline image between text and restores its name from text_elements', () => {
    const parts: PromptPart[] = [{ type: 'text', text: '前面的内容' }, image, { type: 'text', text: '后面的内容' }]
    const wire = toInputs(parts), restored = messageParts(wire)
    expect(wire.map(p => p.type)).toEqual(['text', 'text', 'image', 'text'])
    expect(restored.map(p => p.type)).toEqual(['text', 'image', 'text'])
    expect(restored[1]).toMatchObject({ name: '示意图.png', url: image.url })
    expect(restored[2]).toEqual({ type: 'text', text: '后面的内容' })
  })
  test('accepts image-only prompts and rejects empty drafts', () => { expect(hasPrompt([image])).toBe(true); expect(hasPrompt([{ type: 'text', text: ' \n' }])).toBe(false) })
  test('falls back to content when the native reasoning summary is empty', () => {
    const item = { id: 'r', type: 'reasoning', summary: [], content: ['First paragraph.', 'Current reasoning.'] }
    expect(reasoningText(item)).toBe('First paragraph.\n\nCurrent reasoning.')
    expect(reasoningPreview(item)).toBe('Current reasoning.')
    expect(reasoningText({ ...item, summary: ['Public summary.'] })).toBe('Public summary.')
  })
  test('preserves streamed reasoning across empty and stale final snapshots', () => {
    const old = { id: 'r', type: 'reasoning', summary: ['Summary'], content: ['Full streamed text.'] }
    expect(reasoningText(mergeItem(old, { id: 'r', type: 'reasoning', summary: [], content: [] }))).toBe('Summary')
    expect(mergeItem(old, { id: 'r', type: 'reasoning', content: ['Full'] }).content).toEqual(['Full streamed text.'])
  })
  test('never embeds active-content image URLs', () => { expect(safeImageUrl('javascript:alert(1)')).toBe(''); expect(safeImageUrl('data:image/svg+xml,<svg/>')).toBe('') })
})

test('normalizes structured reasoning fragments without inventing absent text', () => {
  expect(reasoningText({ id: 'r', type: 'reasoning', summary: [], content: [{ type: 'reasoning_text', text: 'Structured body' }] })).toBe('Structured body')
  expect(reasoningText({ id: 'r', type: 'reasoning', content: [] })).toBe('')
  const previous = { id: 'r', type: 'reasoning', content: [{ type: 'reasoning_text', text: 'Keep streamed content' }] }
  expect(reasoningText(mergeItem(previous, { id: 'r', type: 'reasoning', content: [''] }))).toBe('Keep streamed content')
})
test('edited image attachments retain native local paths and file IDs', () => {
  const parts = messageParts([{ type: 'text', text: 'Inspect ' }, { type: 'localImage', path: '/project/diagram.png' }, { type: 'image', fileId: 'file-existing' }])
  const input = toInputs(parts)
  expect(input.find(part => part.type === 'localImage')).toMatchObject({ path: '/project/diagram.png' })
  expect(input.find(part => part.type === 'image')).toMatchObject({ fileId: 'file-existing' })
})
