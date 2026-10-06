import type { Approval, Item } from '../../shared/protocol'

const TOOL = 'request_user_input_async'
const OPEN = '<send_user_message_question_reply>'
const CLOSE = '</send_user_message_question_reply>'
export type AsyncQuestion = { id: string; itemId: string; index: number; title: string; options: string[] }
export type AsyncQuestionReply = { questionItemId: string; question: string; answer: string }
export type AsyncAnswerResult = { ok: boolean; error?: string }

// Codex TUI 0.160.0 identifies each question by the message ID and its original index.
export const asyncQuestionId = (itemId: string, index: number) => JSON.stringify([TOOL, itemId, index])
function readReplies(text: string, tagged = true): AsyncQuestionReply[] {
  const value = text.trim().replace(/^## My request for Codex:\s*/, ''), start = value.indexOf(OPEN), end = value.lastIndexOf(CLOSE)
  if (tagged && (!value.startsWith(OPEN) || !value.endsWith(CLOSE))) return []
  const json = start >= 0 && end > start ? value.slice(start + OPEN.length, end) : value
  try {
    const parsed: unknown = JSON.parse(json), replies = Array.isArray(parsed) ? parsed : [parsed]
    return replies.filter((reply): reply is AsyncQuestionReply => !!reply && typeof reply === 'object'
      && typeof reply.questionItemId === 'string' && typeof reply.question === 'string' && typeof reply.answer === 'string')
  } catch { return [] }
}
export function asyncRepliesFromItem(item: Item): AsyncQuestionReply[] {
  if (item.type === 'userMessage') {
    const text = (item.content || []).map(part => typeof part === 'string' ? part : part.type === 'text' ? part.text || '' : '').join('')
    return readReplies(text)
  }
  if (item.type === 'functionCallOutput' && item.name === TOOL) {
    const output = typeof item.output === 'string' ? item.output : Array.isArray(item.output)
      ? item.output.map(part => part && typeof part === 'object' && typeof part.text === 'string' ? part.text : '').join('') : ''
    return readReplies(output, false)
  }
  return []
}
export function pendingAsyncQuestions(items: Item[], accepted: ReadonlySet<string> = new Set()): AsyncQuestion[] {
  const replies = new Map<string, string>()
  for (const item of items) for (const reply of asyncRepliesFromItem(item)) replies.set(reply.questionItemId, reply.question)
  const pending = new Map<string, AsyncQuestion>()
  for (const item of items) {
    if (item.type !== 'agentMessage' || item.delivery !== 'async' || !Array.isArray(item.questions)) continue
    item.questions.forEach((question, index) => {
      if (!question || typeof question.title !== 'string' || !question.title.trim()) return
      const id = asyncQuestionId(item.id, index)
      if (accepted.has(id) || replies.get(id) === question.title) return
      pending.set(id, { id, itemId: item.id, index, title: question.title,
        options: Array.isArray(question.options) ? question.options.filter(option => typeof option === 'string' && !!option.trim()) : [] })
    })
  }
  return [...pending.values()]
}
export function asyncQuestionApproval(question: AsyncQuestion): Approval {
  return { id: question.id, method: 'tool/requestUserInput', params: { questions: [{ id: 'answer', header: '回答', question: question.title,
    isOther: true, options: question.options.map(label => ({ label, description: '' })) }] } }
}
export function encodeAsyncQuestionReply(question: AsyncQuestion, answer: string): string {
  if (!answer.trim()) throw new Error('请先选择或填写回答。')
  return OPEN + '\n' + JSON.stringify([{ answer, question: question.title, questionItemId: question.id }]) + '\n' + CLOSE
}
export function displayAsyncQuestionReply(text: string): string {
  const replies = readReplies(text)
  return replies.length ? replies.map(reply => reply.question + '\n\n' + reply.answer).join('\n\n') : text
}
