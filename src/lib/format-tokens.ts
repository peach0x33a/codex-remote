const compactTokens = new Intl.NumberFormat('en-US', {
  notation: 'compact', compactDisplay: 'short', maximumFractionDigits: 1,
})

/** Token counts use decimal K/M units, independently of the interface language. */
export function formatTokenCount(value?: number | null): string {
  return value == null || !Number.isFinite(value) || value < 0 ? '—' : compactTokens.format(value)
}
