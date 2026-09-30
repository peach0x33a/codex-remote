import { expect, test } from 'bun:test'
import { composerCommands, fileMentionText, submittedCommand } from '../../src/lib/composer-commands'

test('command search filters names and Chinese labels and hides device actions offline', () => {
  expect(composerCommands('go', true).map(command => command.id)).toEqual(['goal'])
  expect(composerCommands('权限', true).map(command => command.id)).toEqual(['permissions'])
  expect(composerCommands('MODEL', true).map(command => command.id)).toEqual(['model'])
  expect(composerCommands('', false).map(command => command.id)).toEqual(['new', 'settings', 'help'])
  expect(composerCommands('not-a-command', true)).toEqual([])
})
test('submitted commands accept goal objectives without interpreting ordinary paths or prose', () => {
  expect(submittedCommand('/goal 修复登录\n并验证回归')).toEqual({ name: 'goal', argument: '修复登录\n并验证回归' })
  expect(submittedCommand(' /MODEL ')).toEqual({ name: 'model', argument: '' })
  for (const literal of ['检查 /goal', '/src/App.vue', 'https://example.test/path', '@src/main.ts']) expect(submittedCommand(literal)).toBeUndefined()
})
test('file completion preserves native paths literally and quotes whitespace like the TUI', () => {
  expect(fileMentionText('src/App.vue')).toBe('src/App.vue')
  expect(fileMentionText('文档/项目 计划.md')).toBe('"文档/项目 计划.md"')
  expect(fileMentionText('C:\\work\\my file.ts')).toBe('"C:\\work\\my file.ts"')
  expect(fileMentionText('a"quoted file')).toBe('a"quoted file')
  expect(fileMentionText('$(command).ts')).toBe('$(command).ts')
})
