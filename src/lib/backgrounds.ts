export type BackgroundImage = { blob: Blob; name: string }
export const BACKGROUND_CHANGED_KEY = 'codex-remote.background.changed'
const DATABASE = 'codex-remote-backgrounds'
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_BYTES = 20 * 1024 * 1024

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
export async function loadBackground(): Promise<BackgroundImage | undefined> {
  const saved = await accessBackground<BackgroundImage | undefined>('readonly', store => store.get('current'))
  return saved?.blob instanceof Blob && TYPES.has(saved.blob.type) && typeof saved.name === 'string' ? saved : undefined
}
export async function saveBackground(image: BackgroundImage) { await accessBackground('readwrite', store => store.put(image, 'current')) }
export async function deleteBackground() { await accessBackground('readwrite', store => store.delete('current')) }
