import type { TurnFailureInfo } from './turn-failure'

export const AUTO_RETRY_KEY = 'codex-remote.auto-retry.v1'
export const AUTO_RETRY_CHANGED = 'codex-remote:auto-retry-changed'
export const RETRY_CATEGORIES = [
  { id: 'network', label: '网络与连接中断', detail: '连接失败、响应流中断或超时' },
  { id: 'server', label: '服务暂不可用', detail: '服务繁忙、内部错误或 HTTP 5xx' },
  { id: 'rate-limit', label: '请求频率限制', detail: '请求过于频繁或 HTTP 429' },
  { id: 'retry-exhausted', label: '服务端重试耗尽', detail: '服务端已用完自己的重试次数' },
  { id: 'policy', label: '安全策略拦截', detail: '网络安全或其他安全策略终止请求' },
  { id: 'quota', label: '用量限制', detail: '当前账户或会话的用量已达上限' },
  { id: 'context', label: '上下文与任务预算', detail: '上下文窗口或任务预算不足' },
  { id: 'auth', label: '身份验证失败', detail: '凭据失效或未获授权' },
  { id: 'request', label: '请求与执行错误', detail: '请求参数、沙盒或权限请求失败' },
  { id: 'other', label: '其他错误', detail: '未归入以上类别的失败' },
] as const
export type RetryCategory = typeof RETRY_CATEGORIES[number]['id']
export type AutoRetryPreferences = { enabled: boolean; categories: RetryCategory[]; delaySeconds: number; maxAttempts: number }
export const DEFAULT_AUTO_RETRY: AutoRetryPreferences = { enabled: false, categories: ['network', 'server', 'rate-limit'], delaySeconds: 10, maxAttempts: 3 }
export const RETRY_DELAY_OPTIONS = [3, 5, 10, 30, 60]
export const RETRY_ATTEMPT_OPTIONS = [1, 3, 5, 10]
export function normalizeAutoRetry(value: unknown): AutoRetryPreferences {
  const saved = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const categories = saved.categories
  return {
    enabled: saved.enabled === true,
    categories: Array.isArray(categories) ? RETRY_CATEGORIES.filter(category => categories.includes(category.id)).map(category => category.id) : [...DEFAULT_AUTO_RETRY.categories],
    delaySeconds: RETRY_DELAY_OPTIONS.includes(saved.delaySeconds as number) ? saved.delaySeconds as number : DEFAULT_AUTO_RETRY.delaySeconds,
    maxAttempts: RETRY_ATTEMPT_OPTIONS.includes(saved.maxAttempts as number) ? saved.maxAttempts as number : DEFAULT_AUTO_RETRY.maxAttempts,
  }
}
export function readAutoRetry(storage?: Pick<Storage, 'getItem'>): AutoRetryPreferences {
  try { return normalizeAutoRetry(JSON.parse(storage?.getItem(AUTO_RETRY_KEY) || '{}')) } catch { return normalizeAutoRetry(null) }
}
const structuredCategories: Record<string, RetryCategory> = {
  httpConnectionFailed: 'network', responseStreamConnectionFailed: 'network', responseStreamDisconnected: 'network',
  internalServerError: 'server', serverOverloaded: 'server', flexUnavailable: 'server',
  rateLimitExceeded: 'rate-limit', responseTooManyFailedAttempts: 'retry-exhausted',
  cyberPolicy: 'policy', misalignmentPolicyViolation: 'policy', usageLimitExceeded: 'quota',
  contextWindowExceeded: 'context', sessionBudgetExceeded: 'context', unauthorized: 'auth',
  badRequest: 'request', threadRollbackFailed: 'request', sandboxError: 'request', tooManyDenials: 'request', activeTurnNotSteerable: 'request',
}
export function retryCategory(failure: TurnFailureInfo | null | undefined): RetryCategory | null {
  if (!failure || failure.willRetry === true) return null
  const info = failure.codexErrorInfo
  const key = typeof info === 'string' ? info : info && typeof info === 'object' ? Object.keys(info)[0] : undefined
  const value = key && info && typeof info === 'object' ? (info as Record<string, unknown>)[key] : undefined
  const status = value && typeof value === 'object' && 'httpStatusCode' in value ? value.httpStatusCode : undefined
  if (key && ['cyberPolicy', 'misalignmentPolicyViolation', 'usageLimitExceeded', 'contextWindowExceeded', 'sessionBudgetExceeded'].includes(key)) return structuredCategories[key]!
  if (status === 429) return 'rate-limit'
  if (status === 401 || status === 403) return 'auth'
  if (typeof status === 'number' && status >= 500 && status <= 599) return 'server'
  if (key && structuredCategories[key]) return structuredCategories[key]!
  const message = [failure.message, failure.additionalDetails || ''].join(' ')
  if (/cybersecurity risk|cyber.?policy|misalignment|safety policy|安全策略|安全风险/i.test(message)) return 'policy'
  if (/usage limit|quota|credit.*exhaust|用量.{0,8}(限制|上限)|配额/i.test(message)) return 'quota'
  if (/\b429\b|rate.?limit|too many requests|请求.{0,6}频繁/i.test(message)) return 'rate-limit'
  if (/context.{0,12}(exceed|window|limit)|session budget|上下文.{0,8}(不足|超出|上限)/i.test(message)) return 'context'
  if (/\b(401|403)\b|unauthorized|authentication|身份验证|未授权/i.test(message)) return 'auth'
  if (/\b5\d\d\b|server overload|internal server error|服务.{0,8}(繁忙|不可用)/i.test(message)) return 'server'
  if (/retry limit|too many failed attempts|重试.{0,6}(耗尽|上限)/i.test(message)) return 'retry-exhausted'
  if (/connection|disconnected|timed? ?out|timeout|network|连接.{0,6}(失败|中断)|超时/i.test(message)) return 'network'
  if (/bad request|sandbox|invalid.{0,8}(request|argument)|沙盒|参数.{0,6}(无效|错误)/i.test(message)) return 'request'
  return 'other'
}
export function shouldAutoRetry(preferences: AutoRetryPreferences, failure: TurnFailureInfo | null | undefined, attempts: number): boolean {
  const category = retryCategory(failure)
  return preferences.enabled && attempts < preferences.maxAttempts && category !== null && preferences.categories.includes(category)
}
