import { afterEach, expect, test } from 'bun:test'
import { randomId } from '../../src/lib/random-id'

const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')!
afterEach(() => Object.defineProperty(globalThis, 'crypto', cryptoDescriptor))
test('creates distinct UUID v4 identifiers on LAN HTTP without randomUUID', () => {
  const crypto = globalThis.crypto
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { getRandomValues: crypto.getRandomValues.bind(crypto) } })
  const ids = Array.from({ length: 1000 }, randomId)
  expect(new Set(ids).size).toBe(ids.length)
  for (const id of ids) expect(id).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/)
})
test('uses native UUID generation when available', () => {
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { randomUUID: () => 'native-id' } })
  expect(randomId()).toBe('native-id')
})
