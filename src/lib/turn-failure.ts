export type TurnFailureInfo = {
  message: string
  willRetry?: boolean
  additionalDetails?: string | null
  codexErrorInfo?: unknown
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
