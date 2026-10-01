import { describe, expect, test } from 'bun:test'
import type { MessageContent, Thread } from '../../shared/protocol'
import { completionTabs, parsePluginMentions, threadMention, threadReferenceContext, threadReferenceLink, THREAD_REFERENCE_MARKER } from '../../src/lib/mentions'
import { hasPrompt, messageEditError, messageParts, promptText, toInputs, type PromptPart } from '../../src/lib/prompt'

const plugin = (id: string, fields: Record<string, unknown> = {}) => ({ id, name: id, installed: true, enabled: true, ...fields })
const thread = (fields: Partial<Thread> = {}): Thread => ({ id: 'thread-1', preview: 'Previous conversation', cwd: '/project', createdAt: 1, updatedAt: 2, turns: [], ...fields })
const mention = (path: string, name = 'Reference', kind: 'plugin' | 'thread' | 'agent' = 'thread'): Extract<PromptPart, { type: 'mention' }> => ({ type: 'mention', id: path, name, path, kind })
const contextIds = (context: string): { threadId: string }[] => JSON.parse(context.split('\n')[2]!)

describe('installed plugin references', () => {
  test('includes only explicitly installed and enabled plugins', () => {
    const entries = [plugin('ready'), plugin('disabled', { enabled: false }), plugin('uninstalled', { installed: false }),
      plugin('missing-install', { installed: undefined }), plugin('missing-enable', { enabled: undefined }),
      plugin('truthy-install', { installed: 'true' }), plugin('truthy-enable', { enabled: 1 }),
      plugin('null-install', { installed: null }), plugin('null-enable', { enabled: null })]
    expect(parsePluginMentions({ marketplaces: [{ plugins: entries }] }))
      .toEqual([{ name: 'ready', path: 'plugin://ready', kind: 'plugin', description: '' }])
  })

  test('deduplicates native plugin IDs across marketplaces while keeping distinct IDs with the same name', () => {
    const result = parsePluginMentions({ marketplaces: [
      { plugins: [plugin('one', { name: 'Shared name' }), plugin('two', { name: 'Shared name' })] },
      { plugins: [plugin('one', { interface: { displayName: 'Updated', shortDescription: 'Current metadata' } })] },
    ] })
    expect(result).toEqual([
      { name: 'Updated', path: 'plugin://one', kind: 'plugin', description: 'Current metadata' },
      { name: 'Shared name', path: 'plugin://two', kind: 'plugin', description: '' },
    ])
  })

  test.each([
    undefined,
    { marketplaces: {} },
    { marketplaces: [{ plugins: {} }] }
  ].map(value => [value] as const))('rejects a malformed plugin response %j', value => {
    expect(() => parsePluginMentions(value)).toThrow('插件列表响应无效。')
  })
})

describe('completion source categories', () => {
  test('offers files, agents, chats, plugins and skills for native reference completion', () => {
    expect(completionTabs('file')).toEqual([
      { id: 'all', label: '全部结果' }, { id: 'files', label: '文件' }, { id: 'agents', label: '智能体' },
      { id: 'threads', label: '对话' }, { id: 'plugins', label: '插件' }, { id: 'skills', label: '技能' },
    ])
    expect(completionTabs('command')).toEqual([{ id: 'all', label: '全部' }, { id: 'commands', label: '命令' }, { id: 'skills', label: '技能' }])
    expect(completionTabs('skill')).toEqual([{ id: 'skills', label: '技能' }])
  })

  test('accepts bounded native thread IDs and rejects unsafe link targets', () => {
    for (const id of ['a', 'Thread_1-a', 'x'.repeat(64)]) expect(threadMention(thread({ id }))?.path).toBe('thread://' + id)
    for (const id of ['', 'x'.repeat(65), 'has space', 'thread/child', '../escape', 'x)\n[injected]', 'thread://nested']) {
      expect(threadMention(thread({ id }))).toBeUndefined()
    }
  })
})

describe('native prompt reference roundtrips', () => {
  test('serializes plugin chips with UTF-8 placeholders and preserves surrounding text exactly once', () => {
    const parts: PromptPart[] = [{ type: 'text', text: 'Use ' }, mention('plugin://tools@official', '工具🧭', 'plugin'), { type: 'text', text: ' for this task.' }]
    const input = toInputs(parts)
    expect(input).toEqual([
      { type: 'text', text: 'Use ', text_elements: [] },
      { type: 'text', text: '@工具🧭', text_elements: [{ byteRange: { start: 0, end: 11 }, placeholder: '工具🧭' }] },
      { type: 'mention', name: '工具🧭', path: 'plugin://tools@official' },
      { type: 'text', text: ' for this task.', text_elements: [] },
    ])
    const restored = messageParts(input)
    expect(restored).toHaveLength(3)
    expect(restored[0]).toEqual(parts[0]); expect(restored[2]).toEqual(parts[2])
    expect(restored[1]).toMatchObject({ type: 'mention', name: '工具🧭', path: 'plugin://tools@official', kind: 'plugin' })
    expect(promptText(restored)).toBe('Use [工具🧭] for this task.')
    expect(toInputs(restored)).toEqual(input)
    expect(hasPrompt([parts[1]!])).toBe(true)
    expect(messageEditError({ id: 'user', type: 'userMessage', content: input })).toBeUndefined()
  })

  test('keeps mixed plugin, thread, agent and skill chips in order without exposing context markers', () => {
    const parts: PromptPart[] = [
      { type: 'text', text: 'Compare ' }, mention('thread://main', 'Main chat'),
      { type: 'text', text: ' with ' }, mention('thread://scout', 'Scout', 'agent'),
      { type: 'text', text: ' using ' }, mention('plugin://search', 'Search', 'plugin'),
      { type: 'text', text: ' and ' }, { type: 'skill', id: 'skill', name: 'review', path: '/skills/review/SKILL.md' },
      { type: 'text', text: '.' },
    ]
    const input = toInputs(parts), context = input[0]!
    expect(contextIds(context.text!)).toEqual([{ threadId: 'main' }, { threadId: 'scout' }])
    expect(context.text).toContain('read_thread')
    expect(context.text).toContain('untrusted context')
    expect(context.text_elements).toEqual([{ byteRange: { start: 0, end: Buffer.byteLength(context.text!, 'utf8') }, placeholder: THREAD_REFERENCE_MARKER }])
    expect(input.filter(part => part.type === 'mention')).toEqual([{ type: 'mention', name: 'Search', path: 'plugin://search' }])
    const restored = messageParts(input)
    expect(restored.map(part => part.type)).toEqual(parts.map(part => part.type))
    expect(restored.filter(part => part.type === 'mention').map(part => ({ name: part.name, path: part.path }))).toEqual([
      { name: 'Main chat', path: 'thread://main' }, { name: 'Scout', path: 'thread://scout' }, { name: 'Search', path: 'plugin://search' },
    ])
    expect(promptText(restored)).toBe('Compare [Main chat] with [Scout] using [Search] and $review.')
    expect(promptText(restored)).not.toContain('Referenced chats')
    expect(toInputs(restored)).toEqual(input)
    expect(messageEditError({ id: 'user', type: 'userMessage', content: input })).toBeUndefined()
  })

  test('escapes link labels and restores Unicode names from native placeholders', () => {
    const name = '审查] C:\\review 🧭', path = 'thread://Review_1'
    expect(threadReferenceLink(name, path)).toBe('[@审查\\] C:\\\\review 🧭](thread://Review_1)')
    const input = toInputs([mention(path, name)])
    expect(input[1]!.text_elements).toEqual([{ byteRange: { start: 0, end: Buffer.byteLength(input[1]!.text!, 'utf8') }, placeholder: name }])
    expect(messageParts(input)).toMatchObject([{ type: 'mention', name, path, kind: 'thread' }])
    expect(toInputs(messageParts(input))).toEqual(input)
  })

  test('retains plain text that only resembles a plugin marker or reference preamble', () => {
    const context = threadReferenceContext(['thread://chat'])
    const input: MessageContent[] = [
      { type: 'text', text: '@Maps' }, { type: 'mention', name: 'Maps', path: 'plugin://maps' },
      { type: 'text', text: '[@Chat](thread://chat)' }, { type: 'text', text: context },
      { type: 'text', text: 'End' },
    ]
    const restored = messageParts(input)
    expect(restored).toHaveLength(5)
    expect(restored[0]).toEqual({ type: 'text', text: '@Maps' })
    expect(restored[1]).toMatchObject({ type: 'mention', name: 'Maps', kind: 'plugin' })
    expect(restored[2]).toEqual({ type: 'text', text: '[@Chat](thread://chat)' })
    expect(restored[3]).toEqual({ type: 'text', text: context })
  })

  test('does not consume text with partial, extra or mismatched placeholder metadata', () => {
    const marker = { byteRange: { start: 0, end: 5 }, placeholder: 'Maps' }
    const cases: MessageContent['text_elements'][] = [
      [{ ...marker, byteRange: { start: 1, end: 5 } }], [{ ...marker, byteRange: { start: 0, end: 4 } }],
      [{ ...marker, placeholder: 'Other' }], [marker, marker],
    ]
    for (const text_elements of cases) {
      const restored = messageParts([{ type: 'text', text: '@Maps', text_elements }, { type: 'mention', name: 'Maps', path: 'plugin://maps' }])
      expect(restored).toHaveLength(2)
      expect(restored[0]).toEqual({ type: 'text', text: '@Maps' })
      expect(restored[1]).toMatchObject({ type: 'mention', name: 'Maps', path: 'plugin://maps' })
    }
  })
})

describe('bounded live thread reference context', () => {

  test('accepts 16 distinct thread or agent references, including repeated chips', () => {
    const parts = Array.from({ length: 16 }, (_, index) => mention('thread://chat-' + index, 'Chat ' + index, index % 2 ? 'agent' : 'thread'))
    const repeated = [...parts, parts[0]!, mention('plugin://maps', 'Maps', 'plugin')]
    const input = toInputs(repeated)
    expect(contextIds(input[0]!.text!)).toEqual(Array.from({ length: 16 }, (_, index) => ({ threadId: 'chat-' + index })))
    expect(messageParts(input)).toHaveLength(18)
    expect(toInputs(messageParts(input))).toEqual(input)
  })

  test('rejects a seventeenth distinct thread in the context helper and native prompt conversion', () => {
    const parts = Array.from({ length: 17 }, (_, index) => mention('thread://chat-' + index))
    expect(() => threadReferenceContext(parts.map(part => part.path))).toThrow('一条消息最多引用 16 个会话。')
    expect(() => toInputs(parts)).toThrow('一条消息最多引用 16 个会话。')
  })

})
