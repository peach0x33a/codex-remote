import { randomId } from './random-id'
/** Remote-only Git access. The caller binds request and cwd to one device/thread. */
export type Request = (method: string, params: unknown, options?: { signal?: AbortSignal; timeoutMs?: number }) => Promise<unknown>
export type ChangeScope = { kind: 'unstaged' | 'staged' | 'uncommitted' } | { kind: 'commit'; oid: string } | { kind: 'branch'; ref: string } | { kind: 'lastTurn'; patch: string }
export type PatchFile = {
  path: string
  oldPath: string | null
  newPath: string | null
  kind: 'modified' | 'added' | 'deleted' | 'renamed' | 'copied'
  oldMode?: string
  newMode?: string
  binary: boolean
  added?: number
  removed?: number
  patch: string
}
export type ParsedGitPatch = { files: PatchFile[]; complete: boolean; reason?: string; totals?: { added: number; removed: number } }
export type ChangeSet = ParsedGitPatch & { cwd: string; scope: ChangeScope; patch: string; undoable: boolean; undoReason?: string }
export type GitCommit = { oid: string; parents: string[]; subject: string; timestamp: number }
export type GitBranch = { ref: string; name: string; oid: string; current: boolean }
export type UndoReceipt = { id: string; cwd: string; paths: readonly string[] }
export type ReadOptions = { signal?: AbortSignal }

export class WorktreeChangesError extends Error {
  constructor(public code: 'invalid-patch' | 'unsafe-path' | 'output-limit' | 'git-failed' | 'conflict' | 'busy' | 'invalid-receipt' | 'uncertain' | 'dependency-missing', message: string) {
    super(message); this.name = 'WorktreeChangesError'
  }
}

export const MAX_PATCH_BYTES = 2 * 1024 * 1024
export const MAX_UNDO_BYTES = 512 * 1024
const encoder = new TextEncoder()
const oidPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i
export const git = ['git', '--no-pager', '-c', 'core.quotePath=true', '-c', 'color.ui=false', '-c', 'core.fsmonitor=false']
const diffOptions = ['--no-ext-diff', '--no-textconv', '--no-color', '--binary', '--full-index', '--find-renames', '--src-prefix=a/', '--dst-prefix=b/', '--relative']
export const remoteEnv = {
  GIT_DIR: null, GIT_WORK_TREE: null, GIT_INDEX_FILE: null, GIT_COMMON_DIR: null,
  GIT_OBJECT_DIRECTORY: null, GIT_ALTERNATE_OBJECT_DIRECTORIES: null,
  GIT_CONFIG_COUNT: null, GIT_CONFIG_PARAMETERS: null, GIT_EXTERNAL_DIFF: null, GIT_DIFF_OPTS: null,
  GIT_LITERAL_PATHSPECS: '1', GIT_OPTIONAL_LOCKS: '0', GIT_PAGER: 'cat', LC_ALL: 'C',
}

/** Decode Git's C-quoted filenames, including octal UTF-8 bytes. */
function unquote(value: string): string {
  if (!value.startsWith('"')) return value
  if (!value.endsWith('"')) throw new Error('文件路径不完整。')
  const bytes: number[] = []
  const escapes: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 }
  for (let i = 1; i < value.length - 1; i++) {
    if (value[i] !== '\\') {
      const point = value.codePointAt(i)!
      bytes.push(...encoder.encode(String.fromCodePoint(point)))
      if (point > 0xffff) i++
    } else {
      const next = value[++i]!
      if (/[0-7]/.test(next)) {
        const octal = value.slice(i).match(/^[0-7]{1,3}/)![0]
        bytes.push(parseInt(octal, 8)); i += octal.length - 1
      } else if (Object.hasOwn(escapes, next)) bytes.push(escapes[next]!)
      else throw new Error('文件路径转义无效。')
    }
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes))
}

function markerPath(value: string, prefix: string): string | null {
  const path = unquote(value.replace(/\t$/, ''))
  if (path === '/dev/null') return null
  if (!path.startsWith(prefix)) throw new Error('补丁必须使用 a/ 和 b/ 路径。')
  return path.slice(2)
}

function headerPaths(header: string, oldHint?: string | null, newHint?: string | null): [string, string] {
  const candidates: [string, string][] = []
  for (let i = 1; i < header.length; i++) {
    if (header[i] !== ' ' || !/^(?:b\/|"b\/)/.test(header.slice(i + 1))) continue
    try {
      const a = unquote(header.slice(0, i)), b = unquote(header.slice(i + 1))
      if (!a.startsWith('a/') || !b.startsWith('b/')) continue
      const pair: [string, string] = [a.slice(2), b.slice(2)]
      if (oldHint != null && pair[0] !== oldHint || newHint != null && pair[1] !== newHint) continue
      candidates.push(pair)
    } catch { /* Another separator may be inside a quoted filename. */ }
  }
  const identical = candidates.filter(([a, b]) => a === b)
  if (candidates.length === 1) return candidates[0]!
  if (identical.length === 1) return identical[0]!
  throw new Error('无法确定补丁的文件路径。')
}

/** Display parser, not an apply implementation. Git performs the final apply validation. */
export function parseGitPatch(patch: string): ParsedGitPatch {
  if (encoder.encode(patch).length > MAX_PATCH_BYTES) return { files: [], complete: false, reason: '变更内容过大，请缩小查看范围。' }
  if (!patch) return { files: [], complete: true, totals: { added: 0, removed: 0 } }
  const files: PatchFile[] = []
  let reason: string | undefined
  if (!patch.startsWith('diff --git ') || !patch.endsWith('\n') || patch.includes('\0')) reason = '缺少完整 Git 补丁。'
  const sections = patch.split(/(?=^diff --git )/m)
  for (const section of sections) {
    if (!section.startsWith('diff --git ')) { reason ||= '缺少完整 Git 补丁。'; continue }
    try {
      const lines = section.split('\n')
      let oldPath: string | null | undefined, newPath: string | null | undefined
      let renameFrom: string | undefined, renameTo: string | undefined
      let oldMode: string | undefined, newMode: string | undefined
      let kind: PatchFile['kind'] = 'modified', binary = false, binaryPayload = false
      let added = 0, removed = 0, hunks = 0, before = 0, after = 0, inHunk = false
      let oldOid: string | undefined, newOid: string | undefined, similarity: number | undefined
      let metadataOnly = false, invalid = false
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i]!
        if (inHunk && (before || after)) {
          if (line === '\\ No newline at end of file') continue
          if (line.startsWith(' ')) { before--; after-- }
          else if (line.startsWith('+')) { after--; added++ }
          else if (line.startsWith('-')) { before--; removed++ }
          else { invalid = true; inHunk = false; continue }
          if (before < 0 || after < 0) { invalid = true; inHunk = false }
          continue
        }
        const hunk = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:.*)$/)
        if (hunk) { before = Number(hunk[2] ?? 1); after = Number(hunk[4] ?? 1); inHunk = true; hunks++; continue }
        inHunk = false
        if (line.startsWith('--- ')) { oldPath = markerPath(line.slice(4), 'a/'); continue }
        if (line.startsWith('+++ ')) { newPath = markerPath(line.slice(4), 'b/'); continue }
        if (line.startsWith('rename from ') || line.startsWith('copy from ')) { renameFrom = unquote(line.slice(line.startsWith('copy') ? 10 : 12)); kind = line.startsWith('copy') ? 'copied' : 'renamed'; continue }
        if (line.startsWith('rename to ') || line.startsWith('copy to ')) { renameTo = unquote(line.slice(line.startsWith('copy') ? 8 : 10)); continue }
        if (line.startsWith('new file mode ')) { newMode = line.slice(14); kind = 'added'; metadataOnly = true; continue }
        if (line.startsWith('deleted file mode ')) { oldMode = line.slice(18); kind = 'deleted'; metadataOnly = true; continue }
        if (line.startsWith('old mode ')) { oldMode = line.slice(9); metadataOnly = true; continue }
        if (line.startsWith('new mode ')) { newMode = line.slice(9); metadataOnly = true; continue }
        const index = line.match(/^index ([a-f0-9]+)\.\.([a-f0-9]+)(?: (\d{6}))?$/)
        if (index) { oldOid = index[1]; newOid = index[2]; oldMode ||= index[3]; newMode ||= index[3]; continue }
        const similar = line.match(/^(?:dis)?similarity index (\d+)%$/)
        if (similar) { if (!line.startsWith('dis')) similarity = Number(similar[1]); continue }
        if (line === 'GIT binary patch') { binary = true; binaryPayload = true; continue }
        if (line.startsWith('Binary files ')) { binary = true; invalid = true; continue }
        if (binaryPayload) continue
        if (line !== '' && line !== '\\ No newline at end of file') invalid = true
      }
      if (before || after) invalid = true
      const [headerOld, headerNew] = headerPaths(lines[0]!.slice(11), renameFrom ?? oldPath, renameTo ?? newPath)
      if (!safePath(headerOld) || !safePath(headerNew)) reason ||= '补丁包含工作目录外或不安全的路径。'
      if (renameFrom !== undefined && renameTo === undefined || renameTo !== undefined && renameFrom === undefined) invalid = true
      if (renameFrom !== undefined && oldPath != null && renameFrom !== oldPath || renameTo !== undefined && newPath != null && renameTo !== newPath) invalid = true
      oldPath ??= kind === 'added' ? null : headerOld
      newPath ??= kind === 'deleted' ? null : headerNew
      if (kind === 'added') oldPath = null
      if (kind === 'deleted') newPath = null
      if (hunks && (oldPath === undefined || newPath === undefined)) invalid = true
      // An index header alone is not evidence that all content was received.
      const emptyOid = (value?: string) => value === 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391' || value === '473a0f4c3be8a93681a267e3b1e9a7dcda1185436fe141f7749120a303721813'
      const emptyFile = kind === 'added' ? emptyOid(newOid) : kind === 'deleted' && emptyOid(oldOid)
      const onlyRename = (kind === 'renamed' || kind === 'copied') && similarity === 100
      const onlyMode = kind === 'modified' && metadataOnly && oldMode && newMode && oldMode !== newMode && (!oldOid || oldOid === newOid)
      if (!hunks && !binaryPayload && !emptyFile && !onlyRename && !onlyMode) invalid = true
      const file: PatchFile = { path: newPath ?? oldPath ?? headerNew, oldPath, newPath, kind, binary, patch: section }
      if (oldMode) file.oldMode = oldMode
      if (newMode) file.newMode = newMode
      if (!binary && !invalid) { file.added = added; file.removed = removed }
      files.push(file)
      if (invalid) reason ||= '补丁内容不完整，无法撤销。'
    } catch (error) { reason ||= error instanceof Error ? error.message : '补丁格式无效。' }
  }
  const result: ParsedGitPatch = { files, complete: !reason }
  if (reason) result.reason = reason
  if (!reason && files.every(file => file.added !== undefined && file.removed !== undefined)) {
    result.totals = files.reduce((sum, file) => ({ added: sum.added + file.added!, removed: sum.removed + file.removed! }), { added: 0, removed: 0 })
  }
  return result
}

function safePath(path: string): boolean {
  return !!path && !/[\\:\x00-\x1f\x7f]/.test(path) && !path.startsWith('/') && path.split('/').every(part => !!part && part !== '.' && part !== '..' && !/^\.git(?:[. ]|$)/i.test(part))
}

export function undoUnavailableReason(patch: string, parsed = parseGitPatch(patch)): string | undefined {
  if (!parsed.complete || !parsed.files.length) return parsed.reason || '没有可撤销的完整补丁。'
  if (encoder.encode(patch).length > MAX_UNDO_BYTES) return '补丁过大，无法在此撤销。'
  if (parsed.files.some(file => [file.oldPath, file.newPath].some(path => path !== null && !safePath(path)))) return '补丁包含工作目录外或不安全的路径。'
  if (parsed.files.some(file => [file.oldMode, file.newMode].some(mode => mode && mode !== '100644' && mode !== '100755'))) return '符号链接和子模块变更不能在此撤销。'
  if (parsed.files.some(file => file.kind === 'copied')) return '复制变更不能在此撤销。'
  const seen = new Set<string>()
  for (const file of parsed.files) {
    for (const path of new Set([file.oldPath, file.newPath])) {
      if (path === null) continue
      if (seen.has(path)) return '需要完整净变更补丁，不能撤销重复的文件记录。'
      seen.add(path)
    }
  }
  return undefined
}

// Fixed source, never interpolated with user data. argv carries only JSON and base64
// patch bytes. No streamStdin/process registration race; no shell or local bridge FS.
const APPLY_HELPER = String.raw`
import base64, json, os, stat, subprocess, sys

def fail(code, message):
    print(json.dumps({"ok": False, "code": code, "message": message}))
    sys.exit(1)

data = json.loads(sys.argv[1])
patch = base64.b64decode("".join(sys.argv[2:]), validate=True)
root = os.path.abspath(data["cwd"])
if os.path.realpath(root) != root or os.getcwd() != root:
    fail("unsafe-path", "工作目录包含符号链接。")
paths = data["paths"]
if not paths or len(patch) > 524288:
    fail("invalid-patch", "补丁范围无效。")
repo = subprocess.run(["git", "-c", "core.fsmonitor=false", "rev-parse", "--show-toplevel"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10)
if repo.returncode:
    fail("git-failed", "工作目录不在 Git 仓库中。")
repo_root = os.path.abspath(os.fsdecode(repo.stdout).rstrip("\n"))
if os.path.commonpath([repo_root, root]) != repo_root or os.path.realpath(repo_root) != repo_root:
    fail("unsafe-path", "无法确认工作目录的 Git 路径。")
prefix = os.path.relpath(root, repo_root)
directory = [] if prefix == "." else ["--directory=" + prefix]

def target(path):
    parts = path.split("/")
    if not path or any(not p or p in (".", "..") or p.lower().rstrip(". ") == ".git" for p in parts) or any(ord(c) < 32 or ord(c) == 127 or c in "\\:" for c in path):
        fail("unsafe-path", "补丁路径不安全。")
    full = os.path.abspath(os.path.join(root, path))
    if os.path.commonpath([root, full]) != root:
        fail("unsafe-path", "补丁路径超出工作目录。")
    current = root
    for part in parts:
        current = os.path.join(current, part)
        if os.path.islink(current):
            fail("unsafe-path", "变更路径包含符号链接。")
    return full

def snapshot(path):
    full = target(path)
    try:
        info = os.lstat(full)
    except FileNotFoundError:
        return None
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        fail("unsafe-path", "变更路径不是独立的普通文件。")
    if info.st_size > 16777216:
        fail("output-limit", "变更文件过大，无法安全撤销。")
    with open(full, "rb") as f:
        body = f.read(16777217)
    if len(body) > 16777216:
        fail("output-limit", "变更文件过大，无法安全撤销。")
    return (body, stat.S_IMODE(info.st_mode))

def run(args):
    return subprocess.run(["git", "--no-pager", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "apply", "--whitespace=nowarn"] + directory + args + ["-"], cwd=repo_root, input=patch, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20)

direction = ["--reverse"] if data["direction"] == "undo" else []
before = {path: snapshot(path) for path in paths}
if sum(len(value[0]) for value in before.values() if value) > 33554432:
    fail("output-limit", "变更文件过大，无法安全撤销。")
try:
    checked = run(direction + ["--check"])
    if checked.returncode:
        fail("conflict", "文件已改变或补丁无法完整应用，未修改文件。")
    if any(snapshot(path) != before[path] for path in paths):
        fail("conflict", "检查期间文件已改变，未修改文件。")
    applied = run(direction)
except subprocess.TimeoutExpired:
    fail("uncertain", "操作超时，请刷新变更后检查文件。")
if applied.returncode:
    # git apply without --reject checks the entire patch before writing. Do not
    # overwrite a concurrent writer by restoring a stale backup on failure.
    if any(snapshot(path) != before[path] for path in paths):
        fail("uncertain", "操作未完成，文件状态已改变，请刷新检查。")
    fail("conflict", "补丁无法完整应用，未修改文件。")
print(json.dumps({"ok": True}))
`

function base64(text: string): string {
  const bytes = encoder.encode(text)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(binary)
}

export function createWorktreeChanges(request: Request, { cwd }: { cwd: string }) {
  if (!cwd || !cwd.startsWith('/') || /[\0\r\n]/.test(cwd)) throw new WorktreeChangesError('unsafe-path', '需要有效的绝对工作目录。')
  const receipts = new Map<string, { patch: string; paths: string[] }>()
  let applying = false

  async function exec(command: string[], options: ReadOptions = {}, cap = MAX_PATCH_BYTES) {
    options.signal?.throwIfAborted()
    const raw = await request('command/exec', { command, cwd, env: remoteEnv, outputBytesCap: cap + 1, timeoutMs: 30_000 }, { signal: options.signal, timeoutMs: 35_000 })
    if (!raw || typeof raw !== 'object') throw new WorktreeChangesError('git-failed', '远端命令返回无效结果。')
    const result = raw as { exitCode?: number; stdout?: string; stderr?: string; stdoutTruncated?: boolean; stderrTruncated?: boolean }
    if (typeof result.exitCode !== 'number' || typeof result.stdout !== 'string' || typeof result.stderr !== 'string') throw new WorktreeChangesError('git-failed', '远端命令返回无效结果。')
    if (result.stdoutTruncated || result.stderrTruncated || encoder.encode(result.stdout).length > cap || encoder.encode(result.stderr).length > cap) throw new WorktreeChangesError('output-limit', '变更内容过大，请缩小查看范围。')
    return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }
  }

  async function checked(args: string[], options?: ReadOptions, cap?: number) {
    const result = await exec([...git, ...args], options, cap)
    if (result.exitCode !== 0) throw new WorktreeChangesError('git-failed', result.stderr.trim().slice(0, 1000) || '无法读取 Git 变更。')
    return result.stdout
  }

  async function listCommits(options?: ReadOptions): Promise<GitCommit[]> {
    const head = await exec([...git, 'rev-parse', '--verify', 'HEAD'], options, 4096)
    if (head.exitCode !== 0) { await checked(['rev-parse', '--show-toplevel'], options, 4096); return [] }
    const out = await checked(['log', '--max-count=50', '--format=%H%x00%P%x00%ct%x00%s', '--', '.'], options, 256 * 1024)
    return out.trimEnd().split('\n').filter(Boolean).map(line => {
      const [oid, parents, time, subject] = line.split('\0')
      if (!oidPattern.test(oid || '') || !/^\d+$/.test(time || '') || subject === undefined) throw new WorktreeChangesError('git-failed', '提交列表格式无效。')
      return { oid: oid!, parents: parents ? parents.split(' ') : [], timestamp: Number(time), subject }
    })
  }

  async function withUntracked(patch: string, options?: ReadOptions): Promise<string> {
    const listing = await checked(['ls-files', '--others', '--exclude-standard', '-z', '--', '.'], options, 64 * 1024)
    const paths = listing.split('\0').filter(Boolean)
    if (paths.length > 64) throw new WorktreeChangesError('output-limit', '未跟踪文件过多，请缩小工作目录范围。')
    let bytes = encoder.encode(patch).length
    // A bounded list, with bounded per-command output; paths are literal argv.
    for (const path of paths) {
      if (!safePath(path)) throw new WorktreeChangesError('unsafe-path', '未跟踪文件包含不安全的路径。')
      const result = await exec([...git, 'diff', '--no-index', ...diffOptions, '--', '/dev/null', path], options, MAX_PATCH_BYTES - bytes)
      // --no-index returns 1 for a normal difference, 0 for an empty file.
      if (result.exitCode !== 0 && result.exitCode !== 1 || result.stderr.trim()) throw new WorktreeChangesError('git-failed', result.stderr.trim().slice(0, 1000) || '无法读取未跟踪文件。')
      bytes += encoder.encode(result.stdout).length
      if (bytes > MAX_PATCH_BYTES) throw new WorktreeChangesError('output-limit', '变更内容过大，请缩小查看范围。')
      patch += result.stdout
    }
    return patch
  }

  async function listBranches(options?: ReadOptions): Promise<GitBranch[]> {
    const out = await checked(['for-each-ref', '--count=100', '--sort=-committerdate', '--format=%(refname)%00%(objectname)%00%(HEAD)%00%(symref)', 'refs/heads/', 'refs/remotes/'], options, 256 * 1024)
    return out.trimEnd().split('\n').filter(Boolean).flatMap(line => {
      const [ref, oid, head, symref] = line.split('\0')
      if (!ref || !/^refs\/(heads|remotes)\//.test(ref) || !oidPattern.test(oid || '')) throw new WorktreeChangesError('git-failed', '分支列表格式无效。')
      return symref ? [] : [{ ref, oid: oid!, name: ref.replace(/^refs\/(heads|remotes)\//, ''), current: head === '*' }]
    })
  }

  async function readChanges(scope: ChangeScope, options?: ReadOptions): Promise<ChangeSet> {
    options?.signal?.throwIfAborted()
    let patch: string
    switch (scope.kind) {
      case 'lastTurn': patch = scope.patch; break
      case 'unstaged': patch = await withUntracked(await checked(['diff', ...diffOptions, '--', '.'], options), options); break
      case 'staged': patch = await checked(['diff', '--cached', ...diffOptions, '--', '.'], options); break
      case 'uncommitted': {
        const head = await exec([...git, 'rev-parse', '--verify', 'HEAD'], options, 4096)
        if (head.exitCode === 0) patch = await checked(['diff', ...diffOptions, 'HEAD', '--', '.'], options)
        else {
          // stdin is closed in buffered command/exec. Hash zero bytes without -w:
          // this derives the correct empty-tree ID for SHA-1 or SHA-256.
          const emptyTree = (await checked(['hash-object', '-t', 'tree', '--stdin'], options, 4096)).trim()
          if (!oidPattern.test(emptyTree)) throw new WorktreeChangesError('git-failed', '无法读取空仓库。')
          patch = await checked(['diff', ...diffOptions, emptyTree, '--', '.'], options)
        }
        patch = await withUntracked(patch, options)
        break
      }
      case 'commit':
        if (!oidPattern.test(scope.oid)) throw new WorktreeChangesError('git-failed', '请选择有效的提交。')
        patch = await checked(['show', '--format=', '--first-parent', ...diffOptions, scope.oid, '--', '.'], options); break
      case 'branch': {
        if (!/^refs\/(heads|remotes)\/[^\s~^:?*\[\\]+$/.test(scope.ref) || scope.ref.includes('..') || scope.ref.includes('@{')) throw new WorktreeChangesError('git-failed', '请选择有效的分支。')
        const oid = (await checked(['rev-parse', '--verify', '--end-of-options', `${scope.ref}^{commit}`], options, 4096)).trim()
        if (!oidPattern.test(oid)) throw new WorktreeChangesError('git-failed', '分支指向无效。')
        const base = (await checked(['merge-base', oid, 'HEAD'], options, 4096)).trim()
        if (!oidPattern.test(base)) throw new WorktreeChangesError('git-failed', '无法确定分支的共同祖先。')
        patch = await withUntracked(await checked(['diff', ...diffOptions, base, '--', '.'], options), options); break
      }
    }
    if (encoder.encode(patch).length > MAX_PATCH_BYTES) throw new WorktreeChangesError('output-limit', '变更内容过大，请缩小查看范围。')
    const parsed = parseGitPatch(patch)
    const undoReason = scope.kind === 'lastTurn' ? undoUnavailableReason(patch, parsed) : '仅支持撤销当前预览的完整轮次补丁。'
    return { ...parsed, cwd, scope, patch, undoable: !undoReason, ...(undoReason ? { undoReason } : {}) }
  }

  async function apply(patch: string, direction: 'undo' | 'redo') {
    const parsed = parseGitPatch(patch), reason = undoUnavailableReason(patch, parsed)
    if (reason) throw new WorktreeChangesError(reason.includes('路径') ? 'unsafe-path' : 'invalid-patch', reason)
    if (applying) throw new WorktreeChangesError('busy', '上一项文件操作尚未完成。')
    applying = true
    try {
      const paths = [...new Set(parsed.files.flatMap(file => [file.oldPath, file.newPath]).filter((path): path is string => path !== null))]
      const encoded = base64(patch), chunks: string[] = []
      for (let i = 0; i < encoded.length; i += 48_000) chunks.push(encoded.slice(i, i + 48_000))
      // Mutation is deliberately not tied to UI AbortSignal: aborting a pending RPC
      // cannot cancel a remote write and must never be reported as "not applied".
      let result: Awaited<ReturnType<typeof exec>>
      try { result = await exec(['python3', '-I', '-S', '-c', APPLY_HELPER, JSON.stringify({ direction, paths, cwd }), ...chunks], {}, 16 * 1024) }
      catch { throw new WorktreeChangesError('uncertain', '未能确认操作结果，请刷新变更后检查文件。') }
      if ((result.exitCode === 127 || result.exitCode === 126) && !result.stdout.trim()) throw new WorktreeChangesError('dependency-missing', '远端需要可运行的 Python 3 才能撤销变更。')
      let report: { ok?: boolean; code?: WorktreeChangesError['code']; message?: string }
      try { report = JSON.parse(result.stdout) } catch { throw new WorktreeChangesError('uncertain', '未能确认操作结果，请刷新变更后检查文件。') }
      if (!report.ok || result.exitCode !== 0) throw new WorktreeChangesError(report.code || 'git-failed', report.message || '文件操作失败。')
      return paths
    } finally { applying = false }
  }

  return {
    readChanges, listCommits, listBranches,
    async undo(patch: string): Promise<UndoReceipt> {
      const paths = await apply(patch, 'undo'), id = randomId()
      receipts.set(id, { patch, paths })
      return { id, cwd, paths }
    },
    async redo(receipt: UndoReceipt): Promise<void> {
      const saved = receipts.get(receipt.id)
      if (!saved || receipt.cwd !== cwd) throw new WorktreeChangesError('invalid-receipt', '恢复记录已失效。')
      await apply(saved.patch, 'redo')
      receipts.delete(receipt.id)
    },
  }
}
