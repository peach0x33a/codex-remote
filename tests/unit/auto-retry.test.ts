import { expect, test } from 'bun:test'
import { AUTO_RETRY_KEY, DEFAULT_AUTO_RETRY, normalizeAutoRetry, readAutoRetry, retryCategory, shouldAutoRetry } from '../../src/lib/auto-retry'

test('defaults to off, preserves explicit empty categories and bounds malformed settings', () => {
  expect(readAutoRetry()).toEqual(DEFAULT_AUTO_RETRY)
  expect(normalizeAutoRetry({ enabled: true, categories: [], delaySeconds: 3, maxAttempts: 1 })).toEqual({ enabled: true, categories: [], delaySeconds: 3, maxAttempts: 1 })
  expect(normalizeAutoRetry({ enabled: 'true', categories: ['policy', 'policy', 'unknown', 3], maxAttempts: Infinity, delaySeconds: -1 })).toEqual({ ...DEFAULT_AUTO_RETRY, enabled: false, categories: ['policy'] })
  const value = JSON.stringify({ enabled: true, categories: ['network', 'policy'], delaySeconds: 5, maxAttempts: 5 })
  expect(readAutoRetry({ getItem: key => key === AUTO_RETRY_KEY ? value : null })).toMatchObject({ enabled: true, categories: ['network', 'policy'], delaySeconds: 5, maxAttempts: 5 })
})
test.each([
  ['httpConnectionFailed', 'network'], ['responseStreamDisconnected', 'network'], ['serverOverloaded', 'server'], ['internalServerError', 'server'],
  ['rateLimitExceeded', 'rate-limit'], ['responseTooManyFailedAttempts', 'retry-exhausted'], ['cyberPolicy', 'policy'], ['misalignmentPolicyViolation', 'policy'],
  ['usageLimitExceeded', 'quota'], ['contextWindowExceeded', 'context'], ['sessionBudgetExceeded', 'context'], ['unauthorized', 'auth'], ['sandboxError', 'request'], ['badRequest', 'request'], ['other', 'other'],
] as const)('classifies structured %s as %s without replacing the displayed cause', (code, expected) => {
  const failure = { message: 'original error', codexErrorInfo: ['httpConnectionFailed', 'responseStreamDisconnected', 'responseTooManyFailedAttempts'].includes(code) ? { [code]: { httpStatusCode: null } } : code }
  expect(retryCategory(failure)).toBe(expected)
  expect(failure.message).toBe('original error')
})
test('uses HTTP status for exhausted or transport errors but never mistakes quota for rate limits', () => {
  expect(retryCategory({ message: 'failed', codexErrorInfo: { responseTooManyFailedAttempts: { httpStatusCode: 429 } } })).toBe('rate-limit')
  expect(retryCategory({ message: 'failed', codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: 503 } } })).toBe('server')
  expect(retryCategory({ message: 'failed', codexErrorInfo: { httpConnectionFailed: { httpStatusCode: 401 } } })).toBe('auth')
  expect(retryCategory({ message: '429', codexErrorInfo: 'usageLimitExceeded' })).toBe('quota')
})
test('handles older message-only errors and excludes ongoing native retries', () => {
  expect(retryCategory({ message: 'This content was flagged for possible cybersecurity risk. If this seems wrong, try rephrasing your request.' })).toBe('policy')
  expect(retryCategory({ message: 'exceeded retry limit, last status: 429 Too Many Requests' })).toBe('rate-limit')
  expect(retryCategory({ message: 'connection timed out' })).toBe('network')
  expect(retryCategory({ message: 'Reconnecting... 1/5', willRetry: true, codexErrorInfo: 'serverOverloaded' })).toBeNull()
  expect(retryCategory(null)).toBeNull()
})
test('requires opt-in, a selected category and remaining attempts', () => {
  const policy = { message: 'blocked', codexErrorInfo: 'cyberPolicy' }
  expect(shouldAutoRetry(DEFAULT_AUTO_RETRY, policy, 0)).toBe(false)
  expect(shouldAutoRetry({ ...DEFAULT_AUTO_RETRY, enabled: true }, policy, 0)).toBe(false)
  const selected = { ...DEFAULT_AUTO_RETRY, enabled: true, categories: ['policy'] as const }
  expect(shouldAutoRetry({ ...selected, categories: [...selected.categories] }, policy, 2)).toBe(true)
  expect(shouldAutoRetry({ ...selected, categories: [...selected.categories] }, policy, 3)).toBe(false)
})
