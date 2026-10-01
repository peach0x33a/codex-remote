import { onUnmounted, ref, watch, type Ref } from 'vue'
export function useStoredChoice<T>(key: string | (() => string), fallback: T, valid: (value: unknown) => value is T): Ref<T> {
  let storage: Storage | undefined
  try { storage = localStorage } catch { /* Memory-only when storage is blocked. */ }
  const resolveKey = () => typeof key === 'function' ? key() : key
  const read = () => { try { const parsed: unknown = JSON.parse(storage?.getItem(resolveKey()) || 'null'); if (valid(parsed)) return parsed } catch { /* Invalid saved values use the default. */ }; return structuredClone(fallback) }
  const value = ref(read()) as Ref<T>
  let restoring = false
  const restore = () => { restoring = true; value.value = read(); restoring = false }
  watch(resolveKey, restore, { flush: 'sync' })
  watch(value, next => { if (!restoring && valid(next)) { try { storage?.setItem(resolveKey(), JSON.stringify(next)) } catch { /* Current selection remains usable. */ } } }, { deep: true, flush: 'sync' })
  const changed = (event: StorageEvent) => { if (event.key === resolveKey() || event.key === null) restore() }
  if (typeof window !== 'undefined') { window.addEventListener('storage', changed); onUnmounted(() => window.removeEventListener('storage', changed)) }
  return value
}
export const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean'
export const isStringList = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 1000 && value.every(item => typeof item === 'string' && item.length < 4096)
export const oneOf = <T extends string>(values: readonly T[]) => (value: unknown): value is T => typeof value === 'string' && values.includes(value as T)
