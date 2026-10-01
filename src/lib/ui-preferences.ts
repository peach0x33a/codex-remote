export type ThemePreference = 'system' | 'light' | 'dark'
export type BackgroundMode = 'animated' | 'image' | 'none'
export type ImageBackgroundSettings = { opacity: number; blur: number; color: string; colorOpacity: number }
export type UiPreferences = { contentWidth: number; theme: ThemePreference; autoConnect: boolean; autoWrap: boolean; backgroundMode: BackgroundMode; imageBackground: ImageBackgroundSettings }
export function defaultImageBackground(theme: 'light' | 'dark' = 'light'): ImageBackgroundSettings {
  return { opacity: 35, blur: 0, color: theme === 'dark' ? '#181818' : '#ffffff', colorOpacity: 0 }
}
export function normalizeImageBackground(value: unknown, theme: 'light' | 'dark' = 'light'): ImageBackgroundSettings {
  const fallback = defaultImageBackground(theme), saved = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const number = (key: 'opacity' | 'blur' | 'colorOpacity', max: number) => typeof saved[key] === 'number' && Number.isFinite(saved[key]) ? Math.round(Math.max(0, Math.min(max, saved[key]))) : fallback[key]
  return { opacity: number('opacity', 100), blur: number('blur', 32), color: typeof saved.color === 'string' && /^#[\da-f]{6}$/i.test(saved.color) ? saved.color.toLowerCase() : fallback.color, colorOpacity: number('colorOpacity', 100) }
}
export const UI_PREFERENCES_KEY = 'codex-remote.ui.v1'
export function readUiPreferences(storage?: Pick<Storage, 'getItem'>, systemDark = false): UiPreferences {
  const defaults: UiPreferences = { contentWidth: 1080, theme: 'system', autoConnect: true, autoWrap: false, backgroundMode: 'animated', imageBackground: defaultImageBackground() }
  const mode = (value: unknown): BackgroundMode => value === 'image' || value === 'none' || value === 'animated' ? value : 'animated'
  try {
    const saved = JSON.parse(storage?.getItem(UI_PREFERENCES_KEY) || '{}')
    const theme: ThemePreference = ['system', 'light', 'dark'].includes(saved.theme) ? saved.theme : defaults.theme
    const previousTheme = resolveTheme(theme, systemDark)
    return {
      contentWidth: saved.contentWidth === 0 || (typeof saved.contentWidth === 'number' && saved.contentWidth >= 720 && saved.contentWidth <= 1600) ? saved.contentWidth : defaults.contentWidth,
      theme,
      autoConnect: typeof saved.autoConnect === 'boolean' ? saved.autoConnect : defaults.autoConnect,
      autoWrap: typeof saved.autoWrap === 'boolean' ? saved.autoWrap : defaults.autoWrap,
      backgroundMode: mode(saved.backgroundMode ?? saved.backgrounds?.[previousTheme]),
      imageBackground: saved.imageBackground !== undefined ? normalizeImageBackground(saved.imageBackground)
        : saved.imageBackgrounds?.[previousTheme] ? normalizeImageBackground(saved.imageBackgrounds[previousTheme], previousTheme) : defaultImageBackground(),
    }
  } catch { return defaults }
}
export function writeUiPreferences(storage: Pick<Storage, 'getItem' | 'setItem'> | undefined, value: UiPreferences) {
  if (!storage) return false
  try {
    let previous: Record<string, unknown> = {}
    try { const parsed = JSON.parse(storage.getItem(UI_PREFERENCES_KEY) || '{}'); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) previous = parsed } catch { /* Replace malformed saved settings after an explicit change. */ }
    delete previous.backgrounds; delete previous.imageBackgrounds
    storage.setItem(UI_PREFERENCES_KEY, JSON.stringify({ ...previous, ...value })); return true
  } catch { return false }
}
export function migrateUiPreferences(storage?: Pick<Storage, 'getItem' | 'setItem'>, systemDark = false): UiPreferences {
  const value = readUiPreferences(storage, systemDark)
  try {
    const saved = JSON.parse(storage?.getItem(UI_PREFERENCES_KEY) || '{}')
    if (saved && typeof saved === 'object' && ('backgrounds' in saved || 'imageBackgrounds' in saved)) writeUiPreferences(storage, value)
  } catch { /* Leave unavailable or malformed storage untouched until an explicit change. */ }
  return value
}
export const resolveTheme = (theme: ThemePreference, darkSystem: boolean): 'light' | 'dark' => theme === 'system' ? (darkSystem ? 'dark' : 'light') : theme
