import { expect, test } from 'bun:test'
import { diffLines, splitDiffLines } from '../../src/lib/diff-view'
test('uses hunk positions for line numbers and distinguishes headers from changed header-like contents', () => {
  expect(diffLines('--- a/a\n+++ b/a\n@@ -4,2 +8,2 @@\n kept\n---old\n+++new\n')).toEqual([
    { text: '--- a/a', kind: 'meta' }, { text: '+++ b/a', kind: 'meta' }, { text: '@@ -4,2 +8,2 @@', kind: 'meta' },
    { text: ' kept', kind: 'context', old: 4, next: 8 }, { text: '---old', kind: 'removed', old: 5 }, { text: '+++new', kind: 'added', next: 9 },
  ])
})
test('aligns replacement lines in split mode without inventing text on the other side', () => {
  const lines = diffLines('@@ -1,2 +1,3 @@\n-old\n+one\n+two\n kept\n')
  expect(splitDiffLines(lines)).toEqual([{ meta: lines[0] }, { left: lines[1], right: lines[2] }, { left: undefined, right: lines[3] }, { left: lines[4], right: lines[4] }])
})
test('raw add/delete contents and binary metadata are not interpreted as a unified hunk', () => {
  expect(diffLines('+ordinary text\nBinary files differ').every(line => line.kind === 'meta')).toBe(true)
})
