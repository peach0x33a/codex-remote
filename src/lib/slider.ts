export function normalizeSliderValue(raw: string | number, min: number, max: number, step = 1): number | undefined {
  if (typeof raw === 'string' && !raw.trim()) return undefined
  const number = Number(raw)
  if (!Number.isFinite(number) || !Number.isFinite(min) || !Number.isFinite(max) || max < min || !Number.isFinite(step) || step <= 0) return undefined
  const rounded = min + Math.round((number - min) / step) * step
  return Number(Math.max(min, Math.min(max, rounded)).toFixed(6))
}
