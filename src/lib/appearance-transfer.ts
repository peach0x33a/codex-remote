import { normalizeBackgroundUrl, validateBackgroundFile, type BackgroundSource } from './backgrounds'
import { normalizeTypography, type TypographyPreferences } from './typography'
import { normalizeImageBackground, type UiPreferences } from './ui-preferences'

export type AppearancePreferences = Omit<UiPreferences, 'autoConnect'>
export type AppearanceBundle = { appearance: AppearancePreferences; typography: TypographyPreferences; background?: BackgroundSource }
export const APPEARANCE_FILE_LIMIT = 32 * 1024 * 1024
const FORMAT = 'codex-remote-appearance'
const invalid = () => new Error('外观设置文件无效，请选择从 Codex Remote 导出的 JSON 文件。')
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const integer = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
const font = (value: unknown): value is string => typeof value === 'string' && value.length <= 160 && !/[\x00-\x1f\x7f-\x9f]/.test(value)

export async function exportAppearance(bundle: AppearanceBundle): Promise<Blob> {
  let background: unknown = null
  if (bundle.background) {
    if ('url' in bundle.background) background = { type: 'url', url: normalizeBackgroundUrl(bundle.background.url) }
    else {
      validateBackgroundFile(bundle.background.blob)
      const bytes = new Uint8Array(await bundle.background.blob.arrayBuffer()), chunks: string[] = []
      for (let i = 0; i < bytes.length; i += 32_768) chunks.push(String.fromCharCode(...bytes.subarray(i, i + 32_768)))
      background = { type: 'image', name: bundle.background.name, dataUrl: 'data:' + bundle.background.blob.type + ';base64,' + btoa(chunks.join('')) }
    }
  }
  // Select only appearance fields; connection preferences and credentials never travel with this file.
  const { theme, contentWidth, autoWrap, backgroundMode, imageBackground } = bundle.appearance
  return new Blob([JSON.stringify({ format: FORMAT, version: 1, appearance: { theme, contentWidth, autoWrap, backgroundMode, imageBackground }, typography: normalizeTypography(bundle.typography), background }, null, 2) + '\n'], { type: 'application/json' })
}

export async function importAppearance(file: Blob): Promise<AppearanceBundle> {
  if (!file.size || file.size > APPEARANCE_FILE_LIMIT) throw new Error('外观设置文件为空或超过 32 MB。')
  let parsed: unknown
  try { parsed = JSON.parse(await file.text()) } catch { throw invalid() }
  if (!record(parsed) || parsed.format !== FORMAT) throw invalid()
  if (parsed.version !== 1) throw new Error('此外观设置文件的版本不受支持，请更新应用后重试。')
  const a = parsed.appearance, t = parsed.typography
  if (!record(a) || !record(t) || !['system', 'light', 'dark'].includes(String(a.theme)) || typeof a.theme !== 'string' ||
    !(a.contentWidth === 0 || integer(a.contentWidth, 720, 1600)) || typeof a.autoWrap !== 'boolean' ||
    typeof a.backgroundMode !== 'string' || !['animated', 'image', 'none'].includes(a.backgroundMode) || !record(a.imageBackground) ||
    !integer(a.imageBackground.opacity, 0, 100) || !integer(a.imageBackground.blur, 0, 32) || !integer(a.imageBackground.colorOpacity, 0, 100) ||
    typeof a.imageBackground.color !== 'string' || !/^#[\da-f]{6}$/i.test(a.imageBackground.color) ||
    !font(t.uiFont) || !font(t.codeFont) || !integer(t.uiSize, 12, 20) || !integer(t.codeSize, 10, 24)) throw invalid()
  let background: BackgroundSource | undefined
  const b = parsed.background
  if (b !== null) {
    if (!record(b)) throw invalid()
    if (b.type === 'url') { const url = normalizeBackgroundUrl(b.url); background = { url, name: url } }
    else if (b.type === 'image') {
      if (typeof b.name !== 'string' || !b.name || b.name.length > 1024 || /[\x00-\x1f\x7f-\x9f]/.test(b.name) || typeof b.dataUrl !== 'string') throw invalid()
      const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(b.dataUrl)
      if (!match || match[2]!.length % 4 || match[2]!.length > Math.ceil(20 * 1024 * 1024 / 3) * 4) throw invalid()
      let binary: string
      try { binary = atob(match[2]!) } catch { throw invalid() }
      const blob = new Blob([Uint8Array.from(binary, char => char.charCodeAt(0))], { type: match[1] })
      validateBackgroundFile(blob); background = { blob, name: b.name }
    } else throw invalid()
  }
  return {
    appearance: { theme: a.theme as AppearancePreferences['theme'], contentWidth: a.contentWidth as number, autoWrap: a.autoWrap, backgroundMode: a.backgroundMode as AppearancePreferences['backgroundMode'], imageBackground: normalizeImageBackground(a.imageBackground) },
    typography: normalizeTypography(t), background,
  }
}
