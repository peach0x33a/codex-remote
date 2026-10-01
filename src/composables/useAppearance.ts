import { computed, onUnmounted, ref, watch } from 'vue'
import { migrateUiPreferences, normalizeImageBackground, readUiPreferences, resolveTheme, UI_PREFERENCES_KEY, writeUiPreferences, type ThemePreference, type BackgroundMode, type ImageBackgroundSettings } from '../lib/ui-preferences'
import { BACKGROUND_CHANGED_KEY, deleteBackground, loadBackground, prepareBackground, saveBackground, type BackgroundImage } from '../lib/backgrounds'
export function useAppearance(report?: (message: string) => void) {
  let storage: Storage | undefined
  try { storage = localStorage } catch { /* Storage can be disabled. */ }
  const media = window.matchMedia('(prefers-color-scheme: dark)'), systemDark = ref(media.matches)
  const initial = migrateUiPreferences(storage, systemDark.value)
  const contentWidth = ref(initial.contentWidth), theme = ref<ThemePreference>(initial.theme), autoConnect = ref(initial.autoConnect), autoWrap = ref(initial.autoWrap)
  const backgroundMode = ref<BackgroundMode>(initial.backgroundMode), imageSettings = ref(initial.imageBackground)
  const backgroundUrl = ref(''), backgroundName = ref(''), backgroundBusy = ref(false), backgroundError = ref('')
  let imageGeneration = 0, disposed = false, imageIsPersisted = false
  const resolvedTheme = computed(() => resolveTheme(theme.value, systemDark.value))
  const imageBackground = computed({ get: () => imageSettings.value, set: value => { imageSettings.value = normalizeImageBackground(value) } })
  const widthPreview = ref<number | null>(null), imagePreview = ref<ImageBackgroundSettings | null>(null)
  const displayContentWidth = computed(() => widthPreview.value ?? contentWidth.value)
  const displayImageBackground = computed(() => imagePreview.value ?? imageSettings.value)
  function setWidthPreview(value: number | null) { widthPreview.value = value }
  function setImagePreview(value: ImageBackgroundSettings | null) { imagePreview.value = value === null ? null : normalizeImageBackground(value) }
  function replaceImage(image?: BackgroundImage, persisted = true) {
    imageIsPersisted = !!image && persisted
    const previous = backgroundUrl.value
    backgroundUrl.value = image ? URL.createObjectURL(image.blob) : ''; backgroundName.value = image?.name || ''
    if (previous) URL.revokeObjectURL(previous)
  }
  async function restoreImage() {
    const request = ++imageGeneration
    try { const saved = await loadBackground(); if (!disposed && request === imageGeneration) replaceImage(saved) }
    catch { /* A missing/unavailable saved image falls back to the plain surface. */ }
  }
  function notifyImageChange() { try { storage?.setItem(BACKGROUND_CHANGED_KEY, crypto.randomUUID()) } catch { /* Local image remains usable. */ } }
  async function uploadBackground(file: File) {
    if (backgroundBusy.value) return
    const request = ++imageGeneration
    backgroundBusy.value = true; backgroundError.value = ''
    try {
      const image = await prepareBackground(file)
      if (disposed || request !== imageGeneration) return
      let persisted = true
      try { await saveBackground(image) } catch { persisted = false }
      if (disposed || request !== imageGeneration) return
      replaceImage(image, persisted); backgroundMode.value = 'image'
      if (persisted) notifyImageChange()
      else report?.('背景已应用，但浏览器无法保存图片，刷新后需要重新上传。')
    } catch (error) { if (!disposed && request === imageGeneration) backgroundError.value = error instanceof Error ? error.message : '背景图片处理失败。' }
    finally { if (!disposed && request === imageGeneration) backgroundBusy.value = false }
  }
  async function removeBackground() {
    if (backgroundBusy.value) return
    const request = ++imageGeneration
    backgroundBusy.value = true; backgroundError.value = ''
    try {
      if (imageIsPersisted) await deleteBackground()
      if (disposed || request !== imageGeneration) return
      replaceImage(); if (backgroundMode.value === 'image') backgroundMode.value = 'none'
      notifyImageChange()
    } catch { if (!disposed && request === imageGeneration) backgroundError.value = '无法删除保存的背景，请重试。' }
    finally { if (!disposed && request === imageGeneration) backgroundBusy.value = false }
  }
  const changed = (event: MediaQueryListEvent) => { systemDark.value = event.matches }
  const storageChanged = (event: StorageEvent) => {
    if (event.key === UI_PREFERENCES_KEY) { const saved = readUiPreferences(storage, systemDark.value); contentWidth.value = saved.contentWidth; theme.value = saved.theme; autoConnect.value = saved.autoConnect; autoWrap.value = saved.autoWrap; backgroundMode.value = saved.backgroundMode; imageSettings.value = saved.imageBackground }
    if (event.key === BACKGROUND_CHANGED_KEY && !backgroundBusy.value) void restoreImage()
  }
  media.addEventListener('change', changed); window.addEventListener('storage', storageChanged)
  watch(resolvedTheme, value => { document.documentElement.dataset.theme = value; document.documentElement.style.colorScheme = value; document.querySelector('meta[name="theme-color"]')?.setAttribute('content', value === 'dark' ? '#161616' : '#ffffff') }, { immediate: true })
  watch([contentWidth, theme, autoConnect, autoWrap, backgroundMode, imageSettings], () => { if (!writeUiPreferences(storage, { contentWidth: contentWidth.value, theme: theme.value, autoConnect: autoConnect.value, autoWrap: autoWrap.value, backgroundMode: backgroundMode.value, imageBackground: imageSettings.value })) report?.('设置已调整，当前浏览器无法保存设置。') })
  void restoreImage()
  onUnmounted(() => { disposed = true; imageGeneration++; media.removeEventListener('change', changed); window.removeEventListener('storage', storageChanged); if (backgroundUrl.value) URL.revokeObjectURL(backgroundUrl.value) })
  return { displayContentWidth, displayImageBackground, setWidthPreview, setImagePreview, contentWidth, theme, resolvedTheme, autoConnect, autoWrap, backgroundMode, imageBackground, backgroundUrl, backgroundName, backgroundBusy, backgroundError, uploadBackground, removeBackground }
}
