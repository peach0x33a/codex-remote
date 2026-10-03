import { randomId } from '../lib/random-id'
import { computed, onUnmounted, ref, shallowRef, watch } from 'vue'
import { migrateUiPreferences, normalizeImageBackground, readUiPreferences, resolveTheme, UI_PREFERENCES_KEY, writeUiPreferences, type ThemePreference, type BackgroundMode, type ImageBackgroundSettings } from '../lib/ui-preferences'
import { BACKGROUND_CHANGED_KEY, deleteBackground, loadBackground, normalizeBackgroundUrl, prepareBackground, saveBackground, verifyBackground, type BackgroundSource } from '../lib/backgrounds'
import type { AppearancePreferences } from '../lib/appearance-transfer'
export function useAppearance(report?: (message: string) => void) {
  let storage: Storage | undefined
  try { storage = localStorage } catch { /* Storage can be disabled. */ }
  const media = window.matchMedia('(prefers-color-scheme: dark)'), systemDark = ref(media.matches)
  const initial = migrateUiPreferences(storage, systemDark.value)
  const contentWidth = ref(initial.contentWidth), theme = ref<ThemePreference>(initial.theme), autoConnect = ref(initial.autoConnect), autoWrap = ref(initial.autoWrap)
  const backgroundMode = ref<BackgroundMode>(initial.backgroundMode), imageSettings = ref(initial.imageBackground)
  const backgroundUrl = ref(''), backgroundName = ref(''), backgroundBusy = ref(false), backgroundError = ref('')
  const backgroundSource = shallowRef<BackgroundSource>()
  const backgroundRemoteUrl = computed(() => backgroundSource.value && 'url' in backgroundSource.value ? backgroundSource.value.url : '')
  let imageGeneration = 0, disposed = false, imageIsPersisted = false
  const resolvedTheme = computed(() => resolveTheme(theme.value, systemDark.value))
  const imageBackground = computed({ get: () => imageSettings.value, set: value => { imageSettings.value = normalizeImageBackground(value) } })
  const widthPreview = ref<number | null>(null), imagePreview = ref<ImageBackgroundSettings | null>(null)
  const displayContentWidth = computed(() => widthPreview.value ?? contentWidth.value)
  const displayImageBackground = computed(() => imagePreview.value ?? imageSettings.value)
  function setWidthPreview(value: number | null) { widthPreview.value = value }
  function setImagePreview(value: ImageBackgroundSettings | null) { imagePreview.value = value === null ? null : normalizeImageBackground(value) }
  function replaceImage(image?: BackgroundSource, persisted = true) {
    imageIsPersisted = !!image && persisted
    const previous = backgroundUrl.value
    backgroundSource.value = image
    backgroundUrl.value = image ? 'url' in image ? image.url : URL.createObjectURL(image.blob) : ''; backgroundName.value = image?.name || ''
    if (previous.startsWith('blob:')) URL.revokeObjectURL(previous)
  }
  async function restoreImage() {
    const request = ++imageGeneration
    try { const saved = await loadBackground(); if (!disposed && request === imageGeneration) replaceImage(saved) }
    catch { /* A missing/unavailable saved image falls back to the plain surface. */ }
  }
  function notifyImageChange() { try { storage?.setItem(BACKGROUND_CHANGED_KEY, randomId()) } catch { /* Local image remains usable. */ } }
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
  async function setBackgroundUrl(value: string) {
    if (backgroundBusy.value) return
    const request = ++imageGeneration
    backgroundBusy.value = true; backgroundError.value = ''
    try {
      const url = normalizeBackgroundUrl(value), image = { url, name: url }
      await verifyBackground(image)
      if (disposed || request !== imageGeneration) return
      let persisted = true
      try { await saveBackground(image) } catch { persisted = false }
      if (disposed || request !== imageGeneration) return
      replaceImage(image, persisted); backgroundMode.value = 'image'
      if (persisted) notifyImageChange()
      else report?.('背景已应用，但浏览器无法保存地址，刷新后需要重新填写。')
    } catch (error) { if (!disposed && request === imageGeneration) backgroundError.value = error instanceof Error ? error.message : '网络背景图片加载失败。' }
    finally { if (!disposed && request === imageGeneration) backgroundBusy.value = false }
  }
  async function applySettings(settings: AppearancePreferences, image?: BackgroundSource) {
    if (backgroundBusy.value) throw new Error('背景正在处理，请稍后再导入。')
    const request = ++imageGeneration
    backgroundBusy.value = true; backgroundError.value = ''
    try {
      if (image) await verifyBackground(image)
      if (disposed || request !== imageGeneration) throw new Error('外观设置已变化，请重新导入。')
      try { if (image) await saveBackground(image); else await deleteBackground() }
      catch { throw new Error('浏览器无法保存背景，外观设置未导入，请重试。') }
      if (disposed || request !== imageGeneration) throw new Error('外观设置已变化，请重新导入。')
      replaceImage(image); widthPreview.value = null; imagePreview.value = null
      contentWidth.value = settings.contentWidth; theme.value = settings.theme; autoWrap.value = settings.autoWrap
      backgroundMode.value = settings.backgroundMode; imageSettings.value = settings.imageBackground
      notifyImageChange()
    } finally { if (!disposed && request === imageGeneration) backgroundBusy.value = false }
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
  const ready = restoreImage()
  onUnmounted(() => { disposed = true; imageGeneration++; media.removeEventListener('change', changed); window.removeEventListener('storage', storageChanged); if (backgroundUrl.value.startsWith('blob:')) URL.revokeObjectURL(backgroundUrl.value) })
  return { ready, displayContentWidth, displayImageBackground, setWidthPreview, setImagePreview, contentWidth, theme, resolvedTheme, autoConnect, autoWrap, backgroundMode, imageBackground, backgroundUrl, backgroundName, backgroundSource, backgroundRemoteUrl, backgroundBusy, backgroundError, uploadBackground, setBackgroundUrl, removeBackground, applySettings }
}
