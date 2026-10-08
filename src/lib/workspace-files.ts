/** Bounded file access on the device bound to run. Unix + Python 3. */
export type WorkspaceRun = (params: Record<string, unknown>, options?: { signal?: AbortSignal; timeoutMs?: number }) => Promise<unknown>
export type WorkspaceEntry = { name: string; path: string; kind: 'file' | 'directory' | 'other'; size: number }
export type WorkspaceFile = WorkspaceEntry & {
  fingerprint: string
  entries?: WorkspaceEntry[]
  truncated?: boolean
  preview?: { kind: 'text' | 'image' | 'pdf' | 'audio' | 'binary'; text?: string; dataBase64?: string; mime?: string; truncated?: boolean }
}

export const FILE_CHUNK_BYTES = 256 * 1024
const TEXT_BYTES = 128 * 1024
const IMAGE_BYTES = 8 * 1024 * 1024
const MEDIA_BYTES = 32 * 1024 * 1024
const OUTPUT_BYTES = 960 * 1024
const MAX_ENTRIES = 500
const encoder = new TextEncoder()
const controls = /[\x00-\x1f\x7f-\x9f\ud800-\udfff]/u
const imageMimes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'])
const audioMimes = new Set(['audio/wav', 'audio/mpeg', 'audio/ogg', 'audio/flac', 'audio/mp4', 'audio/webm'])

class WorkspaceFilesError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'WorkspaceFilesError' }
}
function fail(code: string, message: string): never { throw new WorkspaceFilesError(code, message) }
function malformed(): never { return fail('invalid-response', '远端文件读取命令返回了无效结果。') }
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) }
function size(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 }
function validPath(value: unknown, absolute = false): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096 && !controls.test(value) && encoder.encode(value).length <= 4096 && (!absolute || value.startsWith('/'))
}
export function validateWorkspaceName(value: string): string {
  if (!validPath(value) || value === '.' || value === '..' || value.includes('/') || encoder.encode(value).length > 255) fail('unsafe-name', '请输入单个文件或文件夹名称，不能包含 /、控制字符或超过 255 字节。')
  return value
}
function validFingerprint(value: unknown, bytes: number): value is string {
  return typeof value === 'string' && value.length <= 192 && /^\d+:\d+:\d+:-?\d+:-?\d+$/.test(value) && value.split(':')[2] === String(bytes)
}
function abortReason(signal: AbortSignal): unknown {
  const reason: unknown = signal.reason
  return reason !== undefined && !(reason instanceof DOMException && reason.name === 'AbortError') ? reason : new DOMException('已取消读取远端文件。', 'AbortError')
}
function checkAbort(signal?: AbortSignal) { if (signal?.aborted) throw abortReason(signal) }

// Fixed source only; paths, fingerprints and offsets travel in separate argv.
// -I -S also prevent workspace modules and Python startup hooks from executing.
const SCRIPT = String.raw`# codex-remote workspace files
import base64, codecs, json, os, stat, sys

CHUNK = 262144
TEXT = 131072
IMAGE = 8388608
MEDIA = 33554432
OUTPUT = 983040
MAX_SIZE = 9007199254740991

class ReadError(Exception):
    def __init__(self, code, message):
        self.code, self.message = code, message

def fail(code, message):
    raise ReadError(code, message)

def encode(value):
    return json.dumps(value, ensure_ascii=True, separators=(",", ":"))

def valid_path(path):
    return isinstance(path, str) and 0 < len(path) <= 4096 and not any(ord(c) < 32 or 127 <= ord(c) < 160 or 0xd800 <= ord(c) <= 0xdfff for c in path) and len(path.encode("utf-8")) <= 4096

def fingerprint(s):
    return ":".join(str(n) for n in (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns))

def kind(s):
    return "file" if stat.S_ISREG(s.st_mode) else "directory" if stat.S_ISDIR(s.st_mode) else "other"

def metadata(path, s):
    if not 0 <= s.st_size <= MAX_SIZE:
        fail("unsupported-size", "文件大小超出了可安全处理的范围。")
    return {"path": path, "name": os.path.basename(path) or "/", "kind": kind(s), "size": s.st_size}

def verify(path, expected, fd=None):
    try:
        current = os.stat(path)
        opened = os.fstat(fd) if fd is not None else None
        if fingerprint(current) != expected or (opened is not None and (not stat.S_ISREG(opened.st_mode) or fingerprint(opened) != expected)):
            fail("file-changed", "远端文件已发生变化，请刷新后重新读取。")
    except OSError:
        fail("file-changed", "读取期间远端文件已被删除或无法访问，请刷新后重试。")

def read_bytes(path, initial, offset, count):
    # Preflight avoids opening known devices/FIFOs. NONBLOCK closes the FIFO
    # replacement race between stat and open; fstat is checked before any read.
    if not stat.S_ISREG(initial.st_mode):
        fail("not-regular-file", "仅支持读取普通文件，不能读取目录、管道或设备文件。")
    expected = fingerprint(initial)
    flags = os.O_RDONLY | os.O_NONBLOCK | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOCTTY", 0)
    fd = os.open(path, flags)
    try:
        verify(path, expected, fd)
        os.lseek(fd, offset, os.SEEK_SET)
        result = bytearray()
        while len(result) < count:
            part = os.read(fd, count - len(result))
            if not part:
                fail("file-changed", "远端文件的实际内容短于声明大小，请刷新后重新读取。")
            result.extend(part)
        if offset + count == initial.st_size and os.read(fd, 1):
            fail("file-changed", "远端文件的实际内容超出了声明大小，请刷新后重新读取。")
        verify(path, expected, fd)
        return bytes(result)
    finally:
        os.close(fd)

def image_mime(data):
    if data.startswith(b"\x89PNG\r\n\x1a\n"): return "image/png"
    if data.startswith(b"\xff\xd8\xff"): return "image/jpeg"
    if data[:6] in (b"GIF87a", b"GIF89a"): return "image/gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP": return "image/webp"
    return None

def inspect(path, initial):
    result = dict(metadata(path, initial), fingerprint=fingerprint(initial))
    if result["kind"] == "directory":
        result.update(entries=[], truncated=False)
        used = len(encode({"ok": True, "file": result})) + 64
        with os.scandir(path) as entries:
            for index, entry in enumerate(entries):
                if index >= 500:
                    result["truncated"] = True
                    break
                if not valid_path(entry.path):
                    result["truncated"] = True
                    continue
                try:
                    try:
                        entry_stat = entry.stat(follow_symlinks=True)
                    except OSError:
                        entry_stat = entry.stat(follow_symlinks=False)
                    item = metadata(entry.path, entry_stat)
                except (OSError, ReadError):
                    result["truncated"] = True
                    continue
                used += len(encode(item)) + 1
                if used >= OUTPUT:
                    result["truncated"] = True
                    break
                result["entries"].append(item)
        result["entries"].sort(key=lambda entry: entry["name"])
        verify(path, result["fingerprint"])
        return result
    data = read_bytes(path, initial, 0, min(TEXT, initial.st_size))
    mime = image_mime(data)
    if not mime and path.lower().endswith(".svg") and (data.lstrip().startswith(b"<svg") or data.lstrip().startswith(b"<?xml")):
        mime = "image/svg+xml"
    media_kind = "image"
    if data.startswith(b"%PDF-"):
        mime, media_kind = "application/pdf", "pdf"
    elif data.startswith(b"RIFF") and data[8:12] == b"WAVE":
        mime, media_kind = "audio/wav", "audio"
    elif data.startswith(b"ID3") or (len(data) > 3 and data[0] == 255 and data[1] & 224 == 224 and data[1] & 24 != 8 and data[1] & 6 != 0 and data[2] & 240 not in (0, 240) and data[2] & 12 != 12):
        mime, media_kind = "audio/mpeg", "audio"
    elif data.startswith(b"OggS"):
        mime, media_kind = "audio/ogg", "audio"
    elif data.startswith(b"fLaC"):
        mime, media_kind = "audio/flac", "audio"
    elif data[4:8] == b"ftyp" and path.lower().endswith((".m4a", ".mp4")):
        mime, media_kind = "audio/mp4", "audio"
    elif data.startswith(b"\x1a\x45\xdf\xa3") and path.lower().endswith((".weba", ".webm")):
        mime, media_kind = "audio/webm", "audio"
    if mime:
        # Small images are assembled by the client with fingerprinted chunks.
        result["preview"] = {"kind": media_kind, "mime": mime} if initial.st_size <= (IMAGE if media_kind == "image" else MEDIA) else {"kind": "binary"}
    else:
        truncated = initial.st_size > TEXT
        try:
            text = codecs.getincrementaldecoder("utf-8")("strict").decode(data, final=not truncated)
            if any((ord(c) < 32 and c not in "\t\r\n") or 127 <= ord(c) < 160 for c in text):
                raise ValueError()
            result["preview"] = {"kind": "text", "text": text, "mime": "text/plain", "truncated": truncated}
        except (UnicodeError, ValueError):
            result["preview"] = {"kind": "binary"}
    return result

def main():
    if os.name != "posix":
        fail("unsupported-platform", "远端文件读取目前仅支持安装了 Python 3 的 Unix 系统。")
    action, cwd, requested = sys.argv[1:4]
    if (cwd and (not valid_path(cwd) or not os.path.isabs(cwd))) or not valid_path(requested):
        fail("unsafe-path", "请提供有效的 Unix 路径和绝对工作目录。")
    if requested == "~" or requested.startswith("~/"):
        requested = os.path.expanduser(requested)
        if not os.path.isabs(requested):
            fail("unsafe-path", "无法确定远端用户的主目录。")
    if not os.path.isabs(requested) and not cwd:
        fail("unsafe-path", "未设置工作目录，请提供绝对路径或以 ~/ 开头的路径。")
    path = os.path.abspath(os.path.join(cwd, requested))
    if not valid_path(path):
        fail("unsafe-path", "解析后的路径过长或包含控制字符。")
    initial = os.stat(path)
    if action in ("create-directory", "create-file"):
        if not stat.S_ISDIR(initial.st_mode):
            fail("not-directory", "只能在文件夹中新建文件或文件夹。")
        name = sys.argv[4]
        if not valid_path(name) or name in (".", "..") or "/" in name or len(name.encode("utf-8")) > 255:
            fail("unsafe-name", "请输入单个文件或文件夹名称，不能包含 /、控制字符或超过 255 字节。")
        directory = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NONBLOCK)
        try:
            opened = os.fstat(directory)
            if (opened.st_dev, opened.st_ino) != (initial.st_dev, initial.st_ino):
                fail("file-changed", "文件夹已发生变化，请刷新后重试。")
            if action == "create-directory":
                os.mkdir(name, dir_fd=directory)
            else:
                created = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o666, dir_fd=directory)
                os.close(created)
        except FileExistsError:
            fail("already-exists", "同名文件或文件夹已存在，请使用其他名称。")
        except PermissionError:
            fail("permission-denied", "没有在此文件夹中创建文件或文件夹的权限。")
        finally:
            os.close(directory)
        return {"ok": True, "path": os.path.join(path, name), "name": name, "kind": "directory" if action == "create-directory" else "file"}
    if action == "inspect":
        return {"ok": True, "file": inspect(path, initial)}
    if action != "chunk":
        fail("invalid-request", "不支持此文件读取操作。")
    if not stat.S_ISREG(initial.st_mode):
        fail("not-regular-file", "仅支持读取普通文件，不能读取目录、管道或设备文件。")
    expected, expected_size, offset = sys.argv[4], int(sys.argv[5]), int(sys.argv[6])
    if fingerprint(initial) != expected or initial.st_size != expected_size:
        fail("file-changed", "远端文件已发生变化，请刷新后重新读取。")
    if not 0 <= offset <= expected_size <= MAX_SIZE:
        fail("invalid-offset", "读取位置超出了文件范围。")
    data = read_bytes(path, initial, offset, min(CHUNK, expected_size - offset))
    return {"ok": True, "path": path, "fingerprint": expected, "size": expected_size, "offset": offset, "dataBase64": base64.b64encode(data).decode("ascii")}

try:
    report = main()
except ReadError as error:
    report = {"ok": False, "code": error.code, "message": error.message}
except OSError as error:
    messages = {2: "远端路径不存在或已被删除。", 13: "没有读取远端路径的权限。", 1: "没有读取远端路径的权限。", 20: "远端路径中的某一级不是目录。"}
    report = {"ok": False, "code": "read-failed", "message": messages.get(error.errno, "无法读取远端路径（系统错误 " + str(error.errno) + "）。")}
except (ValueError, IndexError, OverflowError):
    report = {"ok": False, "code": "invalid-request", "message": "远端文件读取请求无效。"}
output = encode(report)
if len(output) + 1 > OUTPUT:
    output = encode({"ok": False, "code": "output-limit", "message": "远端文件读取结果超出了大小限制。"})
sys.stdout.write(output + "\n")
`

function parseFile(value: unknown): WorkspaceFile {
  if (!record(value) || !validPath(value.path, true) || !size(value.size) || !validFingerprint(value.fingerprint, value.size)) return malformed()
  const name = value.path === '/' ? '/' : value.path.slice(value.path.lastIndexOf('/') + 1)
  if (!name || value.name !== name || (value.kind !== 'file' && value.kind !== 'directory')) return malformed()
  const file: WorkspaceFile = { path: value.path, name, kind: value.kind as WorkspaceFile['kind'], size: value.size, fingerprint: value.fingerprint }
  if (file.kind === 'directory') {
    if (!Array.isArray(value.entries) || value.entries.length > MAX_ENTRIES || typeof value.truncated !== 'boolean' || value.preview !== undefined) return malformed()
    const names = new Set<string>()
    file.entries = value.entries.map(entry => {
      if (!record(entry) || !validPath(entry.name) || entry.name.includes('/') || entry.name === '.' || entry.name === '..' || names.has(entry.name) || !size(entry.size) || (entry.kind !== 'file' && entry.kind !== 'directory' && entry.kind !== 'other')) return malformed()
      if (!validPath(entry.path, true) || entry.path !== (file.path === '/' ? '/' : file.path + '/') + entry.name) return malformed()
      names.add(entry.name)
      return { name: entry.name, path: entry.path, kind: entry.kind as WorkspaceEntry['kind'], size: entry.size }
    })
    file.truncated = value.truncated
  } else {
    if (value.entries !== undefined || value.truncated !== undefined || !record(value.preview)) return malformed()
    const preview = value.preview
    if (preview.kind === 'text') {
      if (typeof preview.text !== 'string' || preview.mime !== 'text/plain' || typeof preview.truncated !== 'boolean' || preview.dataBase64 !== undefined) return malformed()
      const bytes = encoder.encode(preview.text).length
      if (bytes > TEXT_BYTES || bytes > file.size || preview.truncated !== (file.size > TEXT_BYTES) || (!preview.truncated && bytes !== file.size)) return malformed()
      file.preview = { kind: 'text', text: preview.text, mime: 'text/plain', truncated: preview.truncated }
    } else if (preview.kind === 'image' || preview.kind === 'pdf' || preview.kind === 'audio') {
      if (file.size === 0 || file.size > (preview.kind === 'image' ? IMAGE_BYTES : MEDIA_BYTES) || typeof preview.mime !== 'string' || !(preview.kind === 'image' ? imageMimes.has(preview.mime) : preview.kind === 'pdf' ? preview.mime === 'application/pdf' : audioMimes.has(preview.mime)) || preview.dataBase64 !== undefined || preview.text !== undefined || preview.truncated !== undefined) return malformed()
      file.preview = { kind: preview.kind, mime: preview.mime }
    } else if (preview.kind === 'binary') {
      if (preview.text !== undefined || preview.dataBase64 !== undefined || preview.mime !== undefined || preview.truncated !== undefined) return malformed()
      file.preview = { kind: 'binary' }
    } else return malformed()
  }
  return file
}

function decodeChunk(value: unknown, length: number): Uint8Array {
  if (typeof value !== 'string' || value.length !== 4 * Math.ceil(length / 3) || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return malformed()
  let binary: string
  try { binary = atob(value) } catch { return malformed() }
  if (binary.length !== length || btoa(binary) !== value) return malformed()
  return Uint8Array.from(binary, char => char.charCodeAt(0))
}
function encodeImage(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(binary)
}

export function createWorkspaceFiles(run: WorkspaceRun, { cwd }: { cwd: string }) {
  if (cwd !== '' && !validPath(cwd, true)) fail('unsafe-path', '请提供有效的 Unix 绝对工作目录。')

  async function command(args: string[], signal?: AbortSignal): Promise<Record<string, unknown>> {
    checkAbort(signal)
    let removeAbort = () => {}
    let raw: unknown
    try {
      const pending = run({ command: ['python3', '-I', '-S', '-c', SCRIPT, ...args], ...(cwd ? { cwd } : {}), outputBytesCap: OUTPUT_BYTES, timeoutMs: 10_000 }, { signal, timeoutMs: 10_000 })
      raw = signal ? await Promise.race([pending, new Promise<never>((_resolve, reject) => {
        const abort = () => reject(abortReason(signal))
        signal.addEventListener('abort', abort, { once: true })
        removeAbort = () => signal.removeEventListener('abort', abort)
        if (signal.aborted) abort()
      })]) : await pending
      checkAbort(signal)
    } catch (error) {
      checkAbort(signal)
      const message = error instanceof Error ? error.message : String(error)
      if (record(error) && error.code === -32601 || /method not found|unknown method|command\/exec.*(?:unsupported|not supported)/i.test(message)) fail('unsupported-api', '此设备不支持 command/exec，无法读取远端文件。')
      if (/python3.*(?:not found|no such file|ENOENT|not recognized)|(?:ENOENT|spawn).*python3/i.test(message)) fail('dependency-missing', '远端设备需要安装可运行的 Python 3 才能读取文件。')
      throw error
    } finally { removeAbort() }
    if (!record(raw) || !Number.isSafeInteger(raw.exitCode) || typeof raw.stdout !== 'string' || typeof raw.stderr !== 'string') return malformed()
    for (const key of ['stdoutTruncated', 'stderrTruncated']) {
      if (raw[key] === true) fail('output-limit', '远端文件读取结果已被截断，请缩小读取范围。')
      if (raw[key] !== undefined && typeof raw[key] !== 'boolean') return malformed()
    }
    if (raw.stdout.length > OUTPUT_BYTES || raw.stderr.length > OUTPUT_BYTES || encoder.encode(raw.stdout).length + encoder.encode(raw.stderr).length > OUTPUT_BYTES) fail('output-limit', '远端文件读取结果超出了大小限制。')
    if ((raw.exitCode === 126 || raw.exitCode === 127) && !raw.stdout.trim()) fail('dependency-missing', '远端设备需要安装可运行的 Python 3 才能读取文件。')
    if (raw.exitCode !== 0) fail('read-failed', raw.exitCode === 124 ? '远端文件读取超时，请重试。' : '远端文件读取命令执行失败（退出码 ' + raw.exitCode + '）。')
    let report: unknown
    try { report = JSON.parse(raw.stdout) } catch { return malformed() }
    if (!record(report) || typeof report.ok !== 'boolean') return malformed()
    if (!report.ok) {
      if (typeof report.code !== 'string' || !/^[a-z-]{1,64}$/.test(report.code) || typeof report.message !== 'string' || !report.message || report.message.length > 1000) return malformed()
      fail(report.code, report.message)
    }
    return report
  }

  async function readChunk(file: WorkspaceFile, offset: number, options: { signal?: AbortSignal } = {}): Promise<Uint8Array> {
    checkAbort(options.signal)
    if (!record(file) || file.kind !== 'file') fail('not-regular-file', '仅支持读取普通文件，不能读取目录、管道或设备文件。')
    // Snapshot the descriptor before awaiting the remote command.
    const { path, size: bytes, fingerprint } = file
    if (!validPath(path, true) || !size(bytes) || !validFingerprint(fingerprint, bytes)) fail('invalid-request', '文件信息无效，请刷新后重新读取。')
    if (!size(offset) || offset > bytes) fail('invalid-offset', '读取位置超出了文件范围。')
    const report = await command(['chunk', cwd, path, fingerprint, String(bytes), String(offset)], options.signal)
    if (report.path !== path || report.size !== bytes || report.fingerprint !== fingerprint || report.offset !== offset) return malformed()
    return decodeChunk(report.dataBase64, Math.min(FILE_CHUNK_BYTES, bytes - offset))
  }

  async function inspect(path: string, options: { signal?: AbortSignal } = {}): Promise<WorkspaceFile> {
    checkAbort(options.signal)
    if (!validPath(path)) fail('unsafe-path', '请提供不含控制字符的非空 Unix 路径。')
    const report = await command(['inspect', cwd, path], options.signal)
    const file = parseFile(report.file)
    if (file.preview && ['image', 'pdf', 'audio'].includes(file.preview.kind)) {
      // At most 8 MiB total, never a >1 MiB base64 command response.
      const bytes = new Uint8Array(file.size)
      for (let offset = 0; offset < file.size; offset += FILE_CHUNK_BYTES) bytes.set(await readChunk(file, offset, options), offset)
      file.preview.dataBase64 = encodeImage(bytes)
    }
    checkAbort(options.signal)
    return file
  }

  async function create(directory: string, name: string, kind: 'file' | 'directory', options: { signal?: AbortSignal } = {}) {
    if (!validPath(directory, true)) fail('unsafe-path', '请提供有效的 Unix 绝对文件夹路径。')
    validateWorkspaceName(name)
    if (kind !== 'file' && kind !== 'directory') fail('invalid-request', '不支持此新建操作。')
    const path = (directory === '/' ? '/' : directory.replace(/\/+$/, '') + '/') + name
    if (!validPath(path, true)) fail('unsafe-path', '新建路径过长，请使用更短的名称。')
    const report = await command(['create-' + kind, '', directory, name], options.signal)
    if (report.path !== path || report.name !== name || report.kind !== kind) return malformed()
    return { path, name, kind }
  }

  return { inspect, readChunk, create }
}
