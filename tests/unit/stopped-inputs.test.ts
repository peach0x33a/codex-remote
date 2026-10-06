import { expect, test } from 'bun:test'
import { parseStoppedInput, readStoppedInputs, STOPPED_INPUT_COMMIT_TYPE, STOPPED_INPUT_TYPE, stoppedResponseItem, type StoppedInput } from '../../src/lib/stopped-inputs'
import { RpcClient } from '../../src/lib/rpc'

const input: StoppedInput = { clientId: 'client-message', turnId: 'stopped-turn', sourceTurnId: 'source-turn', savedAtMs: 100, input: [{ type: 'text', text: 'BF1 你先别动', text_elements: [] }], priorUserIds: ['original-user'] }
test('builds a Responses user message with stable identity and preserves ordered text, images and references', () => {
  const message = stoppedResponseItem({ ...input, input: [...input.input, { type: 'image', fileId: 'file-image' }, { type: 'text', text: 'after' }, { type: 'localImage', path: '/tmp/image.png' }, { type: 'skill', name: 'review', path: '/skills/review.md' }] })
  expect(message).toMatchObject({ id: 'msg_client-message', type: 'message', role: 'user' })
  expect(message.content.map(part => part.type)).toEqual(['input_text', 'input_image', 'input_text', 'input_text', 'input_text'])
  expect(message.content[0]).toEqual({ type: 'input_text', text: 'BF1 你先别动' })
  expect(message.content[1]).toEqual({ type: 'input_image', file_id: 'file-image', detail: 'auto' })
  expect(message.content[3]?.text).toContain('/tmp/image.png')
  expect(message.content[4]?.text).toContain('/skills/review.md')
})
test('rejects malformed persisted input rather than activating it as user instructions', () => {
  expect(parseStoppedInput(input)).toEqual(input)
  for (const value of [null, {}, { ...input, sourceTurnId: '' }, { ...input, savedAtMs: Infinity }, { ...input, input: [] }, { ...input, priorUserIds: [null] }, { ...input, input: [{ type: 'script', text: 'invalid' }] }]) expect(() => parseStoppedInput(value)).toThrow()
})
test('keeps reservations unconfirmed until a persisted commit receipt exists, regardless of page order', async () => {
  let page = 0
  const pages = [
    { data: [{ attachmentType: STOPPED_INPUT_COMMIT_TYPE, identityKey: input.clientId }, { attachmentType: STOPPED_INPUT_TYPE, identityKey: 'second', payload: { ...input, clientId: 'second', savedAtMs: 101 } }], nextCursor: 'next' },
    { data: [{ attachmentType: STOPPED_INPUT_TYPE, identityKey: input.clientId, payload: input }, { attachmentType: 'another_client_artifact', payload: {} }], nextCursor: null },
  ]
  const rpc = { request: async () => pages[page++] } as unknown as RpcClient
  expect(await readStoppedInputs(rpc, 'thread')).toEqual({ committed: [input], unconfirmed: [{ ...input, clientId: 'second', savedAtMs: 101 }] })
})
test('rejects repeated cursors and mismatched native identities', async () => {
  const repeated = { request: async () => ({ data: [], nextCursor: 'same' }) } as unknown as RpcClient
  await expect(readStoppedInputs(repeated, 'thread')).rejects.toThrow('分页标记重复')
  const mismatch = { request: async () => ({ data: [{ attachmentType: STOPPED_INPUT_TYPE, identityKey: 'different', payload: input }], nextCursor: null }) } as unknown as RpcClient
  await expect(readStoppedInputs(mismatch, 'thread')).rejects.toThrow('标识不匹配')
})
