export type TurnFailureInfo = {
  message: string
  willRetry?: boolean
  additionalDetails?: string | null
  codexErrorInfo?: unknown
}

/** Keep the real retry cause supplied by the server alongside its retry count. */
export function retryStatusMessage(error: unknown): string {
  if (!error || typeof error !== 'object') return '连接中断，正在重试…'
  const value = error as Record<string, unknown>
  const text = (input: unknown) => typeof input === 'string' && input.trim() ? turnFailureMessage({ message: input }) || '' : ''
  const message = text(value.message), details = text(value.additionalDetails)
  if (details) return !message || details.includes(message) ? details : message.includes(details) ? message : details + ' · ' + message
  const info = value.codexErrorInfo
  if (info && typeof info === 'object') {
    for (const entry of Object.values(info)) {
      const code = entry && typeof entry === 'object' && 'httpStatusCode' in entry ? entry.httpStatusCode : undefined
      if (typeof code === 'number' && Number.isInteger(code) && code >= 100 && code <= 599 && !message.includes(String(code))) return 'HTTP ' + code + (message ? ' · ' + message : '')
    }
  }
  return message || '连接中断，正在重试…'
}

/**
 * Desktop app-shared-bedb2212942c.js: HXn hides willRetry errors and unwraps
 * an exact { error: { message } } JSON response. Retry exhaustion remains a
 * terminal error; neither HTTP status nor message wording implies live retry.
 */
export function turnFailureMessage(failure: TurnFailureInfo | null | undefined): string | null {
  if (!failure || failure.willRetry === true) return null
  const message = failure.message.trim()
  if (!message) return '本轮未完成，请重试。'
  try {
    const body: unknown = JSON.parse(message)
    if (body && typeof body === 'object' && 'error' in body) {
      const error = body.error
      if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' && error.message.trim()) return error.message.trim()
    }
  } catch { /* Ordinary server messages are plain text. Preserve them verbatim. */ }
  return message
}
