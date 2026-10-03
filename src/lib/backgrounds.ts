export type BackgroundImage = { blob: Blob; name: string }
export type BackgroundSource = BackgroundImage | { url: string; name: string }
export const BACKGROUND_CHANGED_KEY = 'codex-remote.background.changed'
const DATABASE = 'codex-remote-backgrounds'
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_BYTES = 20 * 1024 * 1024

export function normalizeBackgroundUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 8192 || /[\x00-\x1f\x7f-\x9f]/.test(value)) throw new Error('请输入有效的 HTTP 或 HTTPS 图片地址。')
  let url: URL
  try { url = new URL(value.trim()) } catch { throw new Error('请输入完整的 HTTP 或 HTTPS 图片地址。') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('图片地址仅支持不含用户名和密码的 HTTP 或 HTTPS URL。')
  return url.href
}
export async function verifyBackground(source: BackgroundSource): Promise<void> {
  if ('blob' in source) validateBackgroundFile(source.blob)
  const url = 'url' in source ? normalizeBackgroundUrl(source.url) : URL.createObjectURL(source.blob)
  const image = new Image()
  image.referrerPolicy = 'no-referrer'
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    image.src = url
    await Promise.race([image.decode(), new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('图片加载超时。')), 15_000) })])
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('Invalid image')
  } catch { throw new Error('url' in source ? '无法加载网络图片，请检查地址和访问权限；HTTPS 页面请使用 HTTPS 图片地址。' : '无法读取背景图片，请选择有效的 JPG、PNG 或 WebP。') }
  finally { clearTimeout(timeout); image.src = ''; if ('blob' in source) URL.revokeObjectURL(url) }
}

export function validateBackgroundFile(file: Pick<File, 'type' | 'size'>) {
  if (!TYPES.has(file.type)) throw new Error('请选择 JPG、PNG 或 WebP 图片。')
  if (!file.size) throw new Error('图片文件为空，请重新选择。')
  if (file.size > MAX_BYTES) throw new Error('背景图片不能超过 20 MB。')
}
export async function prepareBackground(file: File): Promise<BackgroundImage> {
  validateBackgroundFile(file)
  const source = URL.createObjectURL(file)
  try {
    const image = new Image(); image.src = source
    try { await image.decode() } catch { throw new Error('无法读取这张图片，请换一张试试。') }
    const scale = Math.min(1, 2560 / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('当前浏览器无法处理图片。')
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('图片处理失败，请重新选择。')), 'image/webp', .86))
    return { blob, name: file.name }
  } finally { URL.revokeObjectURL(source) }
}
function accessBackground<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('浏览器未开放图片存储。')); return }
    const open = indexedDB.open(DATABASE, 1)
    let settled = false
    open.onupgradeneeded = () => { if (!open.result.objectStoreNames.contains('images')) open.result.createObjectStore('images') }
    open.onerror = () => { settled = true; reject(open.error) }
    open.onblocked = () => { settled = true; reject(new Error('图片存储正被其他页面占用。')) }
    open.onsuccess = () => {
      const db = open.result
      if (settled) { db.close(); return }
      db.onversionchange = () => db.close()
      try {
        const transaction = db.transaction('images', mode), request = operation(transaction.objectStore('images'))
        transaction.oncomplete = () => { db.close(); resolve(request.result) }
        transaction.onabort = transaction.onerror = () => { db.close(); reject(transaction.error || request.error || new Error('图片存储失败。')) }
      } catch (error) { db.close(); reject(error) }
    }
  })
}
export async function loadBackground(): Promise<BackgroundSource | undefined> {
  const saved = await accessBackground<BackgroundSource | undefined>('readonly', store => store.get('current'))
  if (saved && 'blob' in saved && saved.blob instanceof Blob && TYPES.has(saved.blob.type) && typeof saved.name === 'string') return saved
  if (saved && 'url' in saved) {
    try { const url = normalizeBackgroundUrl(saved.url); return { url, name: url } } catch { /* Ignore unsupported stored addresses. */ }
  }
}
export async function saveBackground(image: BackgroundSource) { await accessBackground('readwrite', store => store.put(image, 'current')) }
export async function deleteBackground() { await accessBackground('readwrite', store => store.delete('current')) }
