export type TypographyPreferences = { uiFont: string; uiSize: number; codeFont: string; codeSize: number }
export const TYPOGRAPHY_KEY = 'codex-remote.typography.v1'
export const DEFAULT_TYPOGRAPHY: TypographyPreferences = { uiFont: '', uiSize: 14, codeFont: '', codeSize: 13 }
export const UI_FONT_FALLBACK = '"DM Sans Variable", Inter, system-ui, -apple-system, "PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif'
export const CODE_FONT_FALLBACK = '"SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace'
export function normalizeFontName(value: unknown): string { return typeof value === 'string' && value.trim().length <= 160 && !/[\x00-\x1f\x7f]/.test(value) ? value.trim() : '' }
export function normalizeTypography(value: unknown): TypographyPreferences {
  const saved = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const size = (key: 'uiSize' | 'codeSize', min: number, max: number) => typeof saved[key] === 'number' && Number.isFinite(saved[key]) ? Math.round(Math.max(min, Math.min(max, saved[key]))) : DEFAULT_TYPOGRAPHY[key]
  return { uiFont: normalizeFontName(saved.uiFont), uiSize: size('uiSize', 12, 20), codeFont: normalizeFontName(saved.codeFont), codeSize: size('codeSize', 10, 24) }
}
export function fontStack(value: string, kind: 'ui' | 'code') {
  const name = normalizeFontName(value), fallback = kind === 'ui' ? UI_FONT_FALLBACK : CODE_FONT_FALLBACK
  if (!name) return fallback
  return (['system-ui', 'sans-serif', 'serif', 'monospace', 'ui-monospace'].includes(name) ? name : JSON.stringify(name)) + ', ' + fallback
}
export function readTypography(storage?: Pick<Storage, 'getItem'>): TypographyPreferences { try { return normalizeTypography(JSON.parse(storage?.getItem(TYPOGRAPHY_KEY) || '{}')) } catch { return { ...DEFAULT_TYPOGRAPHY } } }
