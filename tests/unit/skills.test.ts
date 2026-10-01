import { expect, test } from 'bun:test'
import { filterSkills, parseSkills } from '../../src/lib/skills'
import { hasPrompt, messageEditError, messageParts, promptText, toInputs, type PromptPart } from '../../src/lib/prompt'
import { detectComposerTrigger } from '../../src/lib/composer-trigger'
const skill = { name: 'audit', description: '检查代码', path: '/skills/audit/SKILL.md', scope: 'user', enabled: true }
const response = (skills: unknown[] = [skill], cwd = '/project') => ({ data: [{ cwd, skills, errors: [] }] })
test('loads real scoped skill metadata, including disabled state and preferred display metadata', () => {
  const catalog = parseSkills(response([skill, { ...skill, path: '/other/audit.md', enabled: false, interface: { displayName: '审查', shortDescription: '简述' } }]), '/project')
  expect(catalog.skills).toHaveLength(2)
  expect(catalog.skills[1]).toMatchObject({ enabled: false, displayName: '审查', description: '简述' })
  expect(filterSkills(catalog.skills, '简述')).toHaveLength(1)
})
test('refuses responses from another working directory and malformed skill paths', () => {
  expect(() => parseSkills(response(), '/other')).toThrow('工作目录')
  expect(() => parseSkills(response([{ ...skill, path: '../fake' }]), '/project')).toThrow('元数据')
  expect(() => parseSkills({ data: {} }, '')).toThrow('无效')
})
test('preserves canonical skill references through send, history, edits and queue serialization', () => {
  const parts: PromptPart[] = [{ type: 'text', text: '请用 ' }, { type: 'skill', id: 'selected', name: skill.name, path: skill.path }, { type: 'text', text: ' 检查当前代码' }]
  const wire = toInputs(parts)
  expect(wire).toEqual([{ type: 'text', text: '请用 ', text_elements: [] }, { type: 'text', text: '$audit', text_elements: [{ byteRange: { start: 0, end: 6 }, placeholder: 'audit' }] }, { type: 'skill', name: 'audit', path: '/skills/audit/SKILL.md' }, { type: 'text', text: ' 检查当前代码', text_elements: [] }])
  expect(toInputs(messageParts(wire))).toEqual(wire)
  expect(promptText(parts)).toBe('请用 $audit 检查当前代码')
  expect(hasPrompt([parts[1]!])).toBe(true)
  expect(messageEditError({ id: 'u', type: 'userMessage', content: wire })).toBeUndefined()
})
test('dollar completion preserves file names and rejects escaped or shell-only dollar expressions', () => {
  for (const text of ['$audit', '请用 $audit', '($audit']) expect(detectComposerTrigger(text, text.length)).toMatchObject({ kind: 'skill', query: 'audit' })
  for (const text of ['\\$audit', '$$audit', '${HOME}', 'word$audit']) expect(detectComposerTrigger(text, text.length)).toBeNull()
  const file = '@src/$file.ts'; expect(detectComposerTrigger(file, file.length)).toMatchObject({ kind: 'file', query: 'src/$file.ts' })
})
