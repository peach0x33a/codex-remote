import { expect, test } from 'bun:test'
import type { Item } from '../../shared/protocol'
import { asyncRepliesFromItem, displayAsyncQuestionReply, encodeAsyncQuestionReply, pendingAsyncQuestions } from '../../src/lib/async-questions'
import { messageEditError } from '../../src/lib/prompt'

const ask: Item = { id: 'async-question-smoke', type: 'agentMessage', delivery: 'async', text: 'Which permissions?', questions: [
  { title: 'Which permissions?', options: ['Administrators only', 'Everyone'] }, { title: 'Anything else?', options: null },
] }
// Captured from a real Codex CLI 0.160.0 TUI connected to a local WebSocket fixture.
const nativeReply = '<send_user_message_question_reply>\n[{"answer":"Administrators only","question":"Which permissions?","questionItemId":"[\\"request_user_input_async\\",\\"async-question-smoke\\",0]"}]\n</send_user_message_question_reply>'
const replyItem: Item = { id: 'native-user', type: 'userMessage', content: [{ type: 'text', text: nativeReply }] }

test('matches the TUI wire format and resolves only the answered question', () => {
  const questions = pendingAsyncQuestions([ask])
  expect(questions).toHaveLength(2)
  expect(encodeAsyncQuestionReply(questions[0]!, 'Administrators only')).toBe(nativeReply)
  expect(pendingAsyncQuestions([ask, replyItem]).map(question => question.title)).toEqual(['Anything else?'])
  expect(displayAsyncQuestionReply(nativeReply)).toBe('Which permissions?\n\nAdministrators only')
  expect(messageEditError(replyItem)).toContain('暂不支持编辑')
})
test('does not treat ordinary steering, matching titles or unrelated outputs as question answers', () => {
  const unrelated: Item[] = [
    { id: 'plain', type: 'userMessage', content: ['Administrators only'] },
    { ...replyItem, content: [{ type: 'text', text: nativeReply.replace('async-question-smoke', 'another-message') }] },
    { id: 'output', type: 'functionCallOutput', name: 'another_tool', output: nativeReply },
  ]
  expect(pendingAsyncQuestions([ask, ...unrelated])).toHaveLength(2)
  expect(displayAsyncQuestionReply('ordinary <script>text</script>')).toBe('ordinary <script>text</script>')
  expect(displayAsyncQuestionReply('Example:\n' + nativeReply)).toBe('Example:\n' + nativeReply)
})
test('hydrates answers from standalone tool outputs and split native text content', () => {
  const replies = asyncRepliesFromItem(replyItem)
  const output: Item = { id: 'tool-output', type: 'functionCallOutput', name: 'request_user_input_async', output: JSON.stringify(replies) }
  expect(pendingAsyncQuestions([ask, output])).toHaveLength(1)
  expect(pendingAsyncQuestions([ask, { ...output, output: [{ type: 'input_text', text: JSON.stringify(replies[0]) }] }])).toHaveLength(1)
  expect(pendingAsyncQuestions([ask, { ...replyItem, content: [nativeReply.slice(0, 50), { type: 'text', text: nativeReply.slice(50) }] }])).toHaveLength(1)
})
test('keeps original indices, deduplicates lifecycle items and ignores malformed metadata', () => {
  const malformed = { ...ask, questions: [{ title: '' }, { title: 'Valid question', options: ['A', 42, ''] }] } as unknown as Item
  const questions = pendingAsyncQuestions([malformed, malformed])
  expect(questions).toHaveLength(1)
  expect(JSON.parse(questions[0]!.id)).toEqual(['request_user_input_async', ask.id, 1])
  expect(questions[0]!.options).toEqual(['A'])
  expect(pendingAsyncQuestions([{ ...ask, delivery: null }, { ...ask, questions: null }])).toHaveLength(0)
  expect(asyncRepliesFromItem({ ...replyItem, content: ['<send_user_message_question_reply>broken</send_user_message_question_reply>'] })).toEqual([])
})
test('preserves Unicode, multiline answers and literal closing tags inside answers', () => {
  const question = pendingAsyncQuestions([ask])[1]!, answer = '全部仅管理员 😀\n保留原始空格  </send_user_message_question_reply>'
  const text = encodeAsyncQuestionReply(question, answer)
  expect(asyncRepliesFromItem({ ...replyItem, content: [text] })[0]?.answer).toBe(answer)
  expect(displayAsyncQuestionReply(text)).toBe(question.title + '\n\n' + answer)
  expect(() => encodeAsyncQuestionReply(question, '  \n')).toThrow('选择或填写回答')
})
