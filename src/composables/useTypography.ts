import { computed, onUnmounted, ref, watch } from 'vue'
import { fontStack, normalizeTypography, readTypography, TYPOGRAPHY_KEY, type TypographyPreferences } from '../lib/typography'
export function useTypography(report?: (message: string) => void) {
  let storage: Storage | undefined
  try { storage = localStorage } catch { /* Browser storage may be disabled. */ }
  const preferences = ref(readTypography(storage)), preview = ref<Partial<TypographyPreferences>>({})
  const effective = computed(() => normalizeTypography({ ...preferences.value, ...preview.value }))
  function update(patch: Partial<TypographyPreferences>) { preview.value = {}; preferences.value = normalizeTypography({ ...preferences.value, ...patch }) }
  function previewSize(key: 'uiSize' | 'codeSize', value: number | null) { preview.value = value === null ? {} : { [key]: value } }
  function clearPreview() { preview.value = {} }
  watch(effective, value => {
    const style = document.documentElement.style
    style.setProperty('--ui-font-family', fontStack(value.uiFont, 'ui'))
    style.setProperty('--ui-font-scale', String(value.uiSize / 14))
    style.setProperty('--code-font-family', fontStack(value.codeFont, 'code'))
    style.setProperty('--code-font-size', value.codeSize + 'px')
  }, { immediate: true })
  watch(preferences, value => { try { storage?.setItem(TYPOGRAPHY_KEY, JSON.stringify(value)) } catch { report?.('字体设置已应用，但当前浏览器无法保存。') } }, { deep: true })
  const changed = (event: StorageEvent) => { if (event.key === TYPOGRAPHY_KEY) { clearPreview(); preferences.value = readTypography(storage) } }
  window.addEventListener('storage', changed)
  onUnmounted(() => window.removeEventListener('storage', changed))
  return { preferences, effective, update, previewSize, clearPreview }
}
export type TypographyControls = ReturnType<typeof useTypography>
