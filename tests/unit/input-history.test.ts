import { describe, expect, test } from 'bun:test'
import { atEditorBoundary, conversationInputs, createInputHistory } from '../../src/lib/input-history'
import type { PromptPart } from '../../src/lib/prompt'
const text = (value: string): PromptPart[] => [{ type: 'text', text: value }]

describe('input history navigation', () => {
  test('recalls newest first, clamps at oldest, then restores the unsent draft', () => {
    const h = createInputHistory(), entries = [text('first'), text('second')]
    expect(h.previous(text('draft'), entries)).toEqual(text('second'))
    expect(h.previous(text('second'), entries)).toEqual(text('first'))
    expect(h.previous(text('first'), entries)).toEqual(text('first'))
    expect(h.next()).toEqual(text('second'))
    expect(h.next()).toEqual(text('draft'))
    expect(h.active).toBe(false); expect(h.next()).toBeUndefined()
  })

  test('freezes the browsing order while new messages arrive', () => {
    const h = createInputHistory(), entries = [text('first'), text('second')]
    h.previous([], entries); entries.push(text('third'))
    expect(h.previous(text('second'), entries)).toEqual(text('first'))
    expect(h.next()).toEqual(text('second')); expect(h.next()).toEqual([])
    expect(h.previous([], entries)).toEqual(text('third'))
  })
  test('reset after typing or switching device/thread drops the old draft', () => {
    const h = createInputHistory()
    h.previous(text('A draft'), [text('A')]); h.reset()
    expect(h.next()).toBeUndefined()
    expect(h.previous(text('B draft'), [text('B')])).toEqual(text('B'))
    expect(h.next()).toEqual(text('B draft'))
  })
  test('preserves inline images, skills and mentions without mutating source inputs', () => {
    const parts: PromptPart[] = [...text('look '), { type: 'image', id: 'i', name: 'image.png', url: '', size: 0, source: { type: 'image', fileId: 'remote-file' } }, ...text(' then '), { type: 'skill', id: 's', name: 'audit', path: '/skills/audit/SKILL.md' }, { type: 'mention', id: 'm', kind: 'thread', name: 'original', path: 'thread://original' }]
    const h = createInputHistory(), recalled = h.previous([], [parts])!
    expect(recalled).toEqual(parts); expect(recalled).not.toBe(parts)
    const image = recalled[1] as Extract<PromptPart, { type: 'image' }>
    image.name = 'changed'; image.source!.fileId = 'changed'
    expect(parts[1]).toMatchObject({ name: 'image.png', source: { fileId: 'remote-file' } })
    expect(h.previous(recalled, [parts])![1]).toMatchObject({ name: 'image.png' })
  })

})
test('reads actual user input in display order, excluding assistant and tool text', () => {
  expect(conversationInputs([{ id: 'a', status: 'completed', items: [{ id: 'u1', type: 'userMessage', content: [{ type: 'text', text: 'first' }] }, { id: 'a1', type: 'agentMessage', text: 'not input' }, { id: 'tool', type: 'commandExecution', command: 'not input' }, { id: 'empty', type: 'userMessage', content: [{ type: 'text', text: '' }] }] }, { id: 'b', status: 'inProgress', items: [{ id: 'u2', type: 'userMessage', content: [{ type: 'text', text: 'second' }] }] }])).toEqual([text('first'), text('second')])
})
describe('caret boundaries', () => {
  function fixture(content = '', chipOrBreak = false, collapsed = true, contained = true) {
    const node = {}, calls: string[] = []
    const root = { contains: (other: unknown) => contained && other === node } as unknown as HTMLElement
    const range = { collapsed, startContainer: node, endContainer: node, startOffset: 0, endOffset: 0, cloneRange: () => ({ selectNodeContents: () => calls.push('root'), setEnd: () => calls.push('end'), setStart: () => calls.push('start'), cloneContents: () => ({ textContent: content, querySelector: () => chipOrBreak ? {} : null }) }) } as unknown as Range
    return { root, range, calls }
  }

  test.each([
    ' '
  ])('treats real content as a boundary: %p', value => {
    const f = fixture(value); expect(atEditorBoundary(f.root, f.range, 'start')).toBe(false)
  })
  test('attachment chips and BRs count even without text', () => {
    const f = fixture('', true); expect(atEditorBoundary(f.root, f.range, 'start')).toBe(false)
  })
  test('selected text and selections outside the editor cannot trigger recall', () => {
    for (const f of [fixture('', false, false), fixture('', false, true, false)]) {
      expect(atEditorBoundary(f.root, f.range, 'start')).toBe(false); expect(f.calls).toEqual([])
    }
  })
})
