import { expect, test } from 'bun:test'
import { migrateUiPreferences, normalizeImageBackground, readUiPreferences, UI_PREFERENCES_KEY, writeUiPreferences } from '../../src/lib/ui-preferences'
import { validateBackgroundFile } from '../../src/lib/backgrounds'
import { nextApprovalSelection } from '../../src/lib/approvals'
const defaultImageBackgrounds = {
  light: { opacity: 35, blur: 0, color: '#ffffff', colorOpacity: 0 },
  dark: { opacity: 35, blur: 0, color: '#181818', colorOpacity: 0 },
}
const defaultPreferences = { contentWidth: 1080, theme: 'system' as const, autoConnect: true, autoWrap: false, backgroundMode: 'animated' as const, imageBackground: defaultImageBackgrounds.light }
function preferenceStorage(value: unknown) {
  const entries = new Map([[UI_PREFERENCES_KEY, JSON.stringify(value)]])
  return { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, raw: string) => { entries.set(key, raw) } }
}

test('appearance keeps the saved width and unrelated settings', () => {
  let raw = JSON.stringify({ contentWidth: 1280, otherPreference: 'keep' })
  const storage = { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value } }
  expect(readUiPreferences(storage)).toEqual({ ...defaultPreferences, contentWidth: 1280 })
  expect(writeUiPreferences(storage, { ...defaultPreferences, contentWidth: 1280, theme: 'dark' })).toBe(true)
  expect(JSON.parse(raw)).toEqual({ ...defaultPreferences, contentWidth: 1280, theme: 'dark', otherPreference: 'keep' })
})
test('bad preferences and unavailable storage have safe defaults', () => {
  for (const raw of ['null', '{', '[]', '"legacy"', '42', '{"theme":"neon","contentWidth":-12}']) {
    expect(readUiPreferences({ getItem: () => raw })).toEqual(defaultPreferences)
  }
  expect(readUiPreferences()).toEqual(defaultPreferences)
  expect(readUiPreferences({ getItem: () => { throw new Error('Storage disabled') } })).toEqual(defaultPreferences)
  expect(writeUiPreferences(undefined, { ...defaultPreferences, theme: 'dark' })).toBe(false)
  expect(writeUiPreferences({ getItem: () => null, setItem: () => { throw new Error('Storage full') } }, defaultPreferences)).toBe(false)
})

for (const theme of ['light', 'dark'] as const) {
  test(`image adjustments clamp and round numeric ranges for ${theme}`, () => {
    const cases = [
      { input: { opacity: -5, blur: -1, colorOpacity: -20 }, expected: { opacity: 0, blur: 0, colorOpacity: 0 } },
      { input: { opacity: 125, blur: 50, colorOpacity: 110 }, expected: { opacity: 100, blur: 32, colorOpacity: 100 } },
      { input: { opacity: 35.6, blur: 12.4, colorOpacity: 73.5 }, expected: { opacity: 36, blur: 12, colorOpacity: 74 } },
      { input: { opacity: 0, blur: 0, colorOpacity: 0 }, expected: { opacity: 0, blur: 0, colorOpacity: 0 } },
      { input: { opacity: 100, blur: 32, colorOpacity: 100 }, expected: { opacity: 100, blur: 32, colorOpacity: 100 } },
    ]
    for (const { input, expected } of cases) {
      expect(normalizeImageBackground(input, theme)).toEqual({ ...defaultImageBackgrounds[theme], ...expected })
    }
  })

  test(`invalid image adjustments use ${theme} defaults without coercion`, () => {
    for (const value of [undefined, null, false, 12, 'image', []]) {
      expect(normalizeImageBackground(value, theme)).toEqual(defaultImageBackgrounds[theme])
    }
    for (const value of [undefined, null, '70', true, NaN, Infinity, -Infinity, {}, []]) {
      expect(normalizeImageBackground({ opacity: value, blur: value, colorOpacity: value, color: '#AbC123' }, theme))
        .toEqual({ ...defaultImageBackgrounds[theme], color: '#abc123' })
    }
    expect(normalizeImageBackground({ opacity: '80', blur: 12, color: '#123456', colorOpacity: 25 }, theme))
      .toEqual({ opacity: 35, blur: 12, color: '#123456', colorOpacity: 25 })
  })

  test(`image colors sanitize to six-digit hex for ${theme}`, () => {
    for (const color of [undefined, null, 123456, '', '#fff', '#12345678', 'abcdef', '#gggggg', ' #abcdef ', 'red', 'rgba(0,0,0,.5)', 'url(https://example.invalid/image.png)']) {
      expect(normalizeImageBackground({ opacity: 80, blur: 12, color, colorOpacity: 25 }, theme))
        .toEqual({ opacity: 80, blur: 12, color: defaultImageBackgrounds[theme].color, colorOpacity: 25 })
    }
    const input = { opacity: 80, blur: 12, color: '#AbCdEf', colorOpacity: 25, unexpected: 'discard' }
    expect(normalizeImageBackground(input, theme)).toEqual({ opacity: 80, blur: 12, color: '#abcdef', colorOpacity: 25 })
    expect(input).toEqual({ opacity: 80, blur: 12, color: '#AbCdEf', colorOpacity: 25, unexpected: 'discard' })
  })
}

for (const [theme, systemDark, activeTheme] of [['light', true, 'light'], ['dark', false, 'dark'], ['system', true, 'dark'], ['system', false, 'light']] as const) {
  test('migrates current legacy background once: ' + theme + ', systemDark=' + systemDark, () => {
    const backgrounds = { light: 'image', dark: 'none' } as const
    const imageBackgrounds = { light: { opacity: 72, blur: 9, color: '#123456', colorOpacity: 28 }, dark: { opacity: 54, blur: 18, color: '#abcdef', colorOpacity: 61 } }
    const storage = preferenceStorage({ contentWidth: 1280, theme, backgrounds, imageBackgrounds, otherPreference: 'keep' })
    const migrated = migrateUiPreferences(storage, systemDark)
    expect(migrated).toEqual({ contentWidth: 1280, theme, autoConnect: true, autoWrap: false, backgroundMode: backgrounds[activeTheme], imageBackground: imageBackgrounds[activeTheme] })
    expect(JSON.parse(storage.getItem(UI_PREFERENCES_KEY)!)).toEqual({ ...migrated, otherPreference: 'keep' })
    expect(migrateUiPreferences(storage, !systemDark)).toEqual(migrated)
    expect(writeUiPreferences(storage, { ...migrated, theme: activeTheme === 'light' ? 'dark' : 'light' })).toBe(true)
    expect(readUiPreferences(storage).backgroundMode).toBe(migrated.backgroundMode)
    expect(readUiPreferences(storage).imageBackground).toEqual(migrated.imageBackground)
  })
}

test('canonical preferences win over legacy theme-specific values', () => {
  const effects = { opacity: 80, blur: 4, color: '#987654', colorOpacity: 12 }
  const storage = preferenceStorage({ theme: 'dark', backgroundMode: 'none', imageBackground: effects, backgrounds: { dark: 'animated' }, imageBackgrounds: { dark: { blur: 30 } } })
  expect(migrateUiPreferences(storage)).toEqual({ ...defaultPreferences, theme: 'dark', backgroundMode: 'none', imageBackground: effects })
})

test('migration leaves malformed storage untouched and tolerates unavailable writes', () => {
  for (const raw of ['null', '{', '[]', '42']) {
    let writes = 0
    expect(migrateUiPreferences({ getItem: () => raw, setItem: () => { writes++ } })).toEqual(defaultPreferences)
    expect(writes).toBe(0)
  }
  expect(migrateUiPreferences({ getItem: () => '{"theme":"dark","backgrounds":{"dark":"none"}}', setItem: () => { throw new Error('Storage full') } }).backgroundMode).toBe('none')
})

test('auto-connect is a persisted boolean with a default of enabled', () => {
  for (const value of [undefined, null, 0, 1, 'false', 'true']) expect(readUiPreferences(preferenceStorage({ autoConnect: value })).autoConnect).toBe(true)
  const storage = preferenceStorage({ autoConnect: false })
  expect(readUiPreferences(storage).autoConnect).toBe(false)
  expect(writeUiPreferences(storage, { ...readUiPreferences(storage), theme: 'dark' })).toBe(true)
  expect(readUiPreferences(storage).autoConnect).toBe(false)
})

test('the approval island advances only when the selected request disappears', () => {
  expect(nextApprovalSelection([1, 2, 3], [1, 2, 3], 2)).toBe(2)
  expect(nextApprovalSelection([1, 2, 3], [1, 3], 2)).toBe(3)
  expect(nextApprovalSelection([1, 2, 3], [1, 2], 3)).toBe(1)
  expect(nextApprovalSelection([1], [], 1)).toBeUndefined()
  expect(nextApprovalSelection([1, '1'], [1, '1'], '1')).toBe('1')
})

test('background uploads reject oversized, empty and non-raster files', () => {
  expect(() => validateBackgroundFile({ type: 'image/png', size: 1024 })).not.toThrow()
  expect(() => validateBackgroundFile({ type: 'image/webp', size: 20 * 1024 * 1024 })).not.toThrow()
  expect(() => validateBackgroundFile({ type: 'image/jpeg', size: 21 * 1024 * 1024 })).toThrow('20 MB')
  expect(() => validateBackgroundFile({ type: 'image/svg+xml', size: 1024 })).toThrow('JPG')
  expect(() => validateBackgroundFile({ type: 'text/html', size: 1024 })).toThrow('JPG')
  expect(() => validateBackgroundFile({ type: 'image/png', size: 0 })).toThrow('为空')
})
