import { onScopeDispose, ref } from 'vue'
import { AUTO_RETRY_CHANGED, AUTO_RETRY_KEY, normalizeAutoRetry, readAutoRetry, type AutoRetryPreferences } from '../lib/auto-retry'

export function useAutoRetryPreferences() {
  let storage: Storage | undefined
  try { storage = localStorage } catch { /* Current-page preferences remain usable. */ }
  const preferences = ref(readAutoRetry(storage)), error = ref('')
  function reload() { preferences.value = readAutoRetry(storage) }
  const changed = (event: StorageEvent) => { if (event.key === AUTO_RETRY_KEY) reload() }
  window.addEventListener('storage', changed)
  window.addEventListener(AUTO_RETRY_CHANGED, reload)
  onScopeDispose(() => { window.removeEventListener('storage', changed); window.removeEventListener(AUTO_RETRY_CHANGED, reload) })
  function update(patch: Partial<AutoRetryPreferences>) {
    const next = normalizeAutoRetry({ ...preferences.value, ...patch })
    error.value = ''
    try {
      if (!storage) throw new Error('storage unavailable')
      storage.setItem(AUTO_RETRY_KEY, JSON.stringify(next))
      window.dispatchEvent(new Event(AUTO_RETRY_CHANGED))
    } catch { error.value = '设置已应用，但当前浏览器无法保存；刷新后需要重新设置。' }
    preferences.value = next
  }
  return { preferences, error, update }
}
