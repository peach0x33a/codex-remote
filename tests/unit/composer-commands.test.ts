import { expect, test } from 'bun:test'
import { composerCommands, composerPlaceholder, fileMentionText, submittedCommand } from '../../src/lib/composer-commands'

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
test('model service tiers appear after the model command like Codex TUI', () => {
  const commands = composerCommands('', true, [{ id: 'fast', name: 'Fast', description: '更快的响应' }])
  expect(commands.map(command => command.id)).toEqual(['goal', 'new', 'model', 'service-tier:fast', 'effort', 'permissions', 'skills', 'rename', 'archive', 'resume', 'agents', 'diff', 'mention', 'compact', 'status', 'cd', 'pwd', 'copy', 'project', 'tasks', 'settings', 'help'])
  expect(composerCommands('fast', true, [{ id: 'fast', name: 'Fast', description: '更快的响应' }])).toEqual([{ id: 'service-tier:fast', label: '/fast', description: '更快的响应', serviceTier: 'fast' }])
})
test('Astra uses the special placeholder only at the highest reasoning levels', () => {
  expect(composerPlaceholder('gpt-6-astra', 'xhigh')).toBe('与神对话')
  expect(composerPlaceholder('GPT-6-ASTRA', 'Max')).toBe('与神对话')
  expect(composerPlaceholder('gpt-6-astra', 'ultra')).toBe('与神对话')
  expect(composerPlaceholder('gpt-6-astra', 'high')).toBe('向 Codex 提问，或描述你想完成的任务')
  expect(composerPlaceholder('test-model', 'xhigh')).toBe('向 Codex 提问，或描述你想完成的任务')
})

test('priority wire tier uses the fast command and compact is discoverable', () => {
  const tiers = [{ id: 'priority', name: 'Priority', description: '更快的响应' }]
  expect(composerCommands('fast', true, tiers)).toEqual([{ id: 'service-tier:priority', label: '/fast', description: '更快的响应', serviceTier: 'priority' }])
  expect(composerCommands('compact', true).map(row => row.id)).toEqual(['compact'])
  expect(composerCommands('compact', false)).toEqual([])
})
