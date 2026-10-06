import { randomId } from './random-id'
import type { PromptPart } from './prompt'
import type { WorkspaceRun } from './workspace-files'

export type FileAttachment = { type: 'file'; id: string; name: string; path: string; size: number; deviceId: string; image?: boolean }
export type AttachmentPart = Extract<PromptPart, { type: 'image' }> | FileAttachment
export type AttachmentReader = (files: File[], existing: PromptPart[], progress?: (text: string) => void, signal?: AbortSignal) => Promise<AttachmentPart[]>
const OPEN = '<codex_remote_file>'
const CLOSE = '</codex_remote_file>'
const INLINE_IMAGE_BYTES = 1024 * 1024
export const UPLOAD_CHUNK_BYTES = 256 * 1024
function imageMime(bytes: Uint8Array): string | undefined {
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) return 'image/png'
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg'
  const prefix = String.fromCharCode(...bytes)
  if (prefix.startsWith('GIF87a') || prefix.startsWith('GIF89a')) return 'image/gif'
  if (prefix.startsWith('RIFF') && prefix.slice(8, 12) === 'WEBP') return 'image/webp'
}

export function fileReference(file: FileAttachment) {
  return OPEN + '\n' + JSON.stringify({ name: file.name, path: file.path, size: file.size, deviceId: file.deviceId, ...(file.image ? { image: true } : {}) }) + '\n' + CLOSE
}
export function parseFileReference(text: string, placeholder?: string | null): FileAttachment | undefined {
  if (!text.startsWith(OPEN + '\n') || !text.endsWith('\n' + CLOSE)) return
  try {
    const file = JSON.parse(text.slice(OPEN.length, -CLOSE.length))
    if (!file || typeof file.name !== 'string' || !file.name || file.name.length > 4096 || placeholder !== undefined && placeholder !== file.name
      || typeof file.path !== 'string' || !file.path.startsWith('/') || file.path.length > 4096 || /[\x00-\x1f\x7f]/.test(file.path)
      || !Number.isSafeInteger(file.size) || file.size < 0 || typeof file.deviceId !== 'string' || !file.deviceId || file.deviceId.length > 512) return
    return { type: 'file', id: 'file-' + randomId(), name: file.name, path: file.path, size: file.size, deviceId: file.deviceId, ...(file.image === true ? { image: true } : {}) }
  } catch { return }
}
export function attachmentPreview(text: string): string {
  return text.replace(/<codex_remote_file>\s*\{"name":("(?:\\.|[^"\\])*")[^\n]*(?:\n<\/codex_remote_file>)?/g, (original, name: string) => {
    try { return '[' + JSON.parse(name) + ']' } catch { return original }
  })
}
export function formatFileSize(bytes: number) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  if (bytes < 1024 ** 3) return (bytes / (1024 ** 2)).toFixed(1) + ' MB'
  if (bytes < 1024 ** 4) return (bytes / (1024 ** 3)).toFixed(1) + ' GB'
  return (bytes / (1024 ** 4)).toFixed(1) + ' TB'
}
function base64(bytes: Uint8Array): string {
  let text = ''
  for (let offset = 0; offset < bytes.length; offset += 32768) text += String.fromCharCode(...bytes.subarray(offset, offset + 32768))
  return btoa(text)
}

// Fixed source, isolated Python, and separate argv. Uploads create private, unique
// directories on the selected Codex host; no uploaded file is executed or overwritten.
export const ATTACHMENT_UPLOAD_SCRIPT = String.raw`# codex-remote attachment upload
import base64, json, os, re, stat, sys, tempfile

CHUNK = 262144

def fail(message):
    raise ValueError(message)

def directory(path, token):
    root = os.path.realpath(tempfile.gettempdir())
    if os.path.dirname(path) != root or not os.path.basename(path).startswith("codex-remote-attachment-" + token + "-"):
        fail("上传目录无效。")
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    info = os.fstat(fd)
    if info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) & 0o077:
        os.close(fd)
        fail("上传目录权限无效。")
    return fd

def main():
    operation, token, path, name, total, offset = sys.argv[1:7]
    if not re.fullmatch(r"[a-zA-Z0-9_-]{1,128}", token):
        fail("上传标识无效。")
    total, offset = int(total), int(offset)
    if not 0 <= offset <= total <= 9007199254740991:
        fail("文件大小或上传位置无效。")
    if operation == "begin":
        path = tempfile.mkdtemp(prefix="codex-remote-attachment-" + token + "-")
        fd = os.open(os.path.join(path, "upload.part"), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        os.close(fd)
        return {"directory": path, "offset": 0}
    parent = directory(path, token)
    try:
        if operation == "discard":
            try: os.unlink("upload.part", dir_fd=parent)
            except FileNotFoundError: pass
            os.rmdir(path)
            return {}
        fd = os.open("upload.part", os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or info.st_size != offset:
                fail("文件已变化或上传位置不匹配，请重新添加文件。")
            if operation == "chunk":
                data = base64.b64decode("".join(sys.argv[7:]), validate=True)
                if not 0 < len(data) <= CHUNK or offset + len(data) > total:
                    fail("上传分块大小无效。")
                os.lseek(fd, offset, os.SEEK_SET)
                view = memoryview(data)
                while view:
                    written = os.write(fd, view)
                    if not written: fail("文件写入未完成。")
                    view = view[written:]
                return {"offset": offset + len(data)}
            if operation != "finish" or offset != total:
                fail("文件上传尚未完成。")
            os.fsync(fd)
        finally:
            os.close(fd)
        name = re.sub(r"[/\\\x00-\x1f\x7f]", "_", name).strip() or "attachment"
        while len(name.encode("utf-8")) > 200: name = name[:-1]
        if name in (".", "..", "upload.part"): name = "attachment-" + name.replace(".", "_")
        # link() is exclusive; it cannot replace an existing destination.
        os.link("upload.part", name, src_dir_fd=parent, dst_dir_fd=parent, follow_symlinks=False)
        os.unlink("upload.part", dir_fd=parent)
        return {"path": os.path.join(path, name), "size": total}
    finally:
        os.close(parent)

try:
    print(json.dumps({"ok": True, **main()}, ensure_ascii=True, separators=(",", ":")))
except Exception as error:
    print(json.dumps({"ok": False, "message": str(error)}, ensure_ascii=True, separators=(",", ":")))
`

export async function uploadAttachment(file: File, deviceId: string, run: WorkspaceRun, progress?: (text: string) => void): Promise<FileAttachment> {
  if (!deviceId) throw new Error('请先连接设备，再添加文件。')
  if (!Number.isSafeInteger(file.size) || file.size < 0) throw new Error('文件大小无法准确读取。')
  const token = randomId(), name = file.name || 'attachment'
  if (name.length > 4096) throw new Error('文件名过长，请缩短名称后重新添加。')
  let directory = '', offset = 0
  async function request(operation: string, chunks: string[] = []) {
    const result = await run({ command: ['python3', '-I', '-S', '-c', ATTACHMENT_UPLOAD_SCRIPT, operation, token, directory, name, String(file.size), String(offset), ...chunks], timeoutMs: 15_000 }, { timeoutMs: 20_000 }) as { exitCode?: number; stdout?: string; stderr?: string }
    if (!result || result.exitCode !== 0 || typeof result.stdout !== 'string' || result.stdout.length > 16384) throw new Error('无法上传文件，请确认设备可以运行 Python 3 并写入临时目录。')
    let report: Record<string, unknown>
    try { report = JSON.parse(result.stdout) } catch { throw new Error('设备返回了无效的文件上传结果。') }
    if (!report || report.ok !== true) throw new Error(typeof report?.message === 'string' ? report.message : '文件上传失败，请重试。')
    return report
  }
  try {
    progress?.('正在上传 ' + name + ' · 0%')
    const start = await request('begin')
    if (typeof start.directory !== 'string' || !start.directory.startsWith('/') || start.directory.length > 4096 || /[\x00-\x1f\x7f]/.test(start.directory)
      || start.directory.split('/').some(part => part === '.' || part === '..') || !start.directory.split('/').at(-1)?.startsWith('codex-remote-attachment-' + token + '-') || start.offset !== 0) throw new Error('设备返回了无效的上传目录。')
    directory = start.directory
    while (offset < file.size) {
      const bytes = new Uint8Array(await file.slice(offset, offset + UPLOAD_CHUNK_BYTES).arrayBuffer())
      if (!bytes.length || bytes.length !== Math.min(UPLOAD_CHUNK_BYTES, file.size - offset)) throw new Error('文件读取未完成，请重新添加。')
      const encoded = base64(bytes), chunks = encoded.match(/.{1,65536}/g) || []
      const report = await request('chunk', chunks)
      if (report.offset !== offset + bytes.length) throw new Error('文件上传位置未确认，请重新添加。')
      offset += bytes.length
      progress?.('正在上传 ' + name + ' · ' + Math.floor(offset / file.size * 100) + '%')
    }
    const report = await request('finish')
    if (typeof report.path !== 'string' || !report.path.startsWith(directory + '/') || /[\x00-\x1f\x7f]/.test(report.path) || report.size !== file.size) throw new Error('文件上传结果未确认，请重新添加。')
    return { type: 'file', id: 'file-' + token, name, path: report.path, size: file.size, deviceId }
  } catch (cause) {
    if (directory) { try { await request('discard') } catch { /* Cleanup uses only this upload's private directory. */ } }
    throw new Error(name + '：' + (cause instanceof Error ? cause.message : '文件上传失败。'))
  }
}

export async function readAttachments(files: File[], existing: PromptPart[], upload: (file: File) => Promise<FileAttachment>): Promise<AttachmentPart[]> {
  const result: AttachmentPart[] = []
  let inlineBytes = existing.reduce((sum, part) => sum + (part.type === 'image' && part.url.startsWith('data:') ? Math.ceil((part.url.length - part.url.indexOf(',') - 1) * .75) : 0), 0)
  for (const file of files) {
    const mime = imageMime(new Uint8Array(await file.slice(0, 16).arrayBuffer()))
    if (mime && file.size > 0 && inlineBytes + file.size <= INLINE_IMAGE_BYTES) {
      const url = 'data:' + mime + ';base64,' + base64(new Uint8Array(await file.arrayBuffer()))
      result.push({ type: 'image', id: randomId(), name: file.name || '粘贴的图片', url, size: file.size })
      inlineBytes += file.size
    } else { const attachment = await upload(file); result.push(mime ? { ...attachment, image: true } : attachment) }
  }
  return result
}
