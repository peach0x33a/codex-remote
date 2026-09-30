import { describe, expect, test } from 'bun:test'
import { composerSuggestionInsertion, detectComposerTrigger } from '../../src/lib/composer-trigger'

function atCaret(value: string) {
  const caret = value.indexOf('|')
  return detectComposerTrigger(value.replace('|', ''), caret)
}

describe('composer commands and file mentions', () => {
  test('starts a command at the beginning of an input or indented line', () => {
    expect(atCaret('/|')).toEqual({ kind: 'command', query: '', start: 0, end: 1 })
    expect(atCaret('  /goal|')).toEqual({ kind: 'command', query: 'goal', start: 2, end: 7 })
    expect(atCaret('前文\n\t /go|')).toEqual({ kind: 'command', query: 'go', start: 5, end: 8 })
    expect(atCaret('前文\r\n　/goal|')).toMatchObject({ kind: 'command', query: 'goal' })
  })

  test('does not treat inline slashes, URLs or a later argument as commands', () => {
    for (const value of ['看看 /goal|', 'https://example.test/go|', 'src/components/Pro|', '/goal do this|', '/goal |', '\ufffc /goal|', 'a\t/goal|']) {
      expect(atCaret(value)).toBeNull()
    }
  })

  test('recognizes file mentions at word boundaries, including punctuation', () => {
    expect(atCaret('@|')).toEqual({ kind: 'file', query: '', start: 0, end: 1 })
    expect(atCaret('查看 @src/Prompt|')).toEqual({ kind: 'file', query: 'src/Prompt', start: 3, end: 14 })
    for (const value of ['(@src|', '查看：@文件|', '“@文件|', '🙂@src|', '\ufffc@src|', '\n@src|']) {
      expect(atCaret(value)).toMatchObject({ kind: 'file' })
    }
  })

  test('ignores emails, identifiers, nested at signs and escaped mentions', () => {
    for (const value of ['user@example|', 'first.last+tag@example|', '人名@例子|', 'name_@src|', 'e\u0301@src|', '𐐀@src|', 'a-@src|', 'a%@src|', '@@src|', '@src@next|', '\\@src|', 'https://host/@src|']) {
      expect(atCaret(value)).toBeNull()
    }
  })

  test('replaces the whole token but searches only up to a caret in its middle', () => {
    expect(atCaret('  /go|al suffix')).toEqual({ kind: 'command', query: 'go', start: 2, end: 7 })
    expect(atCaret('前 @src/Pro|mpt.vue 后')).toEqual({ kind: 'file', query: 'src/Pro', start: 2, end: 17 })
    expect(atCaret('@|src/file.ts 后')).toEqual({ kind: 'file', query: '', start: 0, end: 12 })
    expect(atCaret('|@src/file.ts')).toBeNull()
    expect(atCaret('@src |后')).toBeNull()
  })

  test('selects the token at the caret, preserving other mentions and attachments', () => {
    const value = '前 @first\ufffc@sec|ond 后 @third'
    const token = atCaret(value)!
    const text = value.replace('|', '')
    expect(token).toMatchObject({ kind: 'file', query: 'sec' })
    expect(text.slice(0, token.start) + 'src/chosen.ts ' + text.slice(token.end)).toBe('前 @first\ufffcsrc/chosen.ts  后 @third')
    expect(atCaret('@src|\ufffc尾')).toEqual({ kind: 'file', query: 'src', start: 0, end: 4 })
    expect(atCaret('@src\ufffc|尾')).toBeNull()
    expect(atCaret('\ufffc\n /goal|')).toMatchObject({ kind: 'command', query: 'goal' })
  })

  test('uses DOM-compatible UTF-16 offsets without corrupting Unicode', () => {
    expect(atCaret('🙂 @文件/🧪|.ts 后')).toEqual({ kind: 'file', query: '文件/🧪', start: 3, end: 12 })
    expect(atCaret('@src/file-name.test.ts|')).toMatchObject({ query: 'src/file-name.test.ts' })
  })

  test('rejects invalid caret offsets and ordinary text', () => {
    for (const caret of [-1, 7, 1.5, NaN, Infinity]) expect(detectComposerTrigger('/goal', caret)).toBeNull()
    for (const value of ['|', 'plain|', ' |', '/goal\n|', '@src\t|']) expect(atCaret(value)).toBeNull()
  })
})

describe('file completion separates subsequent input', () => {
  test('adds a space after ordinary and quoted file paths', () => {
    for (const path of ['src/App.vue', '"docs/项目 计划.md"']) {
      expect(composerSuggestionInsertion('file', path)).toEqual({ text: path + ' ', reuseTrailingSpace: false })
    }
  })
  test('reuses an existing horizontal separator so the caret can advance over it', () => {
    for (const space of [' ', '\t', '\u00a0', '　']) {
      expect(composerSuggestionInsertion('file', 'src/App.vue', space)).toEqual({ text: 'src/App.vue', reuseTrailingSpace: true })
    }
  })
  test('does not advance over a newline, an attachment or ordinary text', () => {
    for (const next of ['\n', '\ufffc', '后']) {
      expect(composerSuggestionInsertion('file', 'src/App.vue', next)).toEqual({ text: 'src/App.vue ', reuseTrailingSpace: false })
    }
  })
  test('preserves explicit trailing whitespace and token removal', () => {
    expect(composerSuggestionInsertion('file', 'src/App.vue ')).toEqual({ text: 'src/App.vue ', reuseTrailingSpace: false })
    expect(composerSuggestionInsertion('file', '')).toEqual({ text: '', reuseTrailingSpace: false })
  })
  test('keeps command replacements exact, including empty command removal', () => {
    for (const text of ['', '/goal', '/goal ']) {
      expect(composerSuggestionInsertion('command', text, ' ')).toEqual({ text, reuseTrailingSpace: false })
    }
  })
})
