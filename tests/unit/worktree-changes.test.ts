import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, writeFile, mkdir, rm, rename, symlink, link, chmod, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorktreeChanges, parseGitPatch, undoUnavailableReason, MAX_PATCH_BYTES, type Request } from '../../src/lib/worktree-changes'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
async function shell(cwd: string, ...command: string[]) {
  const proc = Bun.spawn(command, { cwd, stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' })
  const [exitCode, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  if (exitCode) throw new Error(`${command.join(' ')}: ${stderr}`)
  return stdout
}
async function fixture(files: Record<string, string | Uint8Array> = { 'a.txt': 'first\nsecond\nthird\n' }) {
  const cwd = await mkdtemp(join(tmpdir(), 'worktree-changes-')); roots.push(cwd)
  await shell(cwd, 'git', 'init', '-q', '-b', 'main')
  await shell(cwd, 'git', 'config', 'user.email', 'test@example.invalid')
  await shell(cwd, 'git', 'config', 'user.name', 'Test')
  for (const [path, body] of Object.entries(files)) {
    await mkdir(join(cwd, path, '..'), { recursive: true })
    await writeFile(join(cwd, path), body)
  }
  await shell(cwd, 'git', 'add', '.')
  await shell(cwd, 'git', 'commit', '--allow-empty', '-qm', 'initial')
  const calls: { method: string; command: string[]; cwd: string; env: Record<string, string | null>; outputBytesCap: number; timeoutMs: number }[] = []
  const request: Request = async (method, value, options) => {
    options?.signal?.throwIfAborted()
    expect(method).toBe('command/exec')
    const params = value as Omit<(typeof calls)[number], 'method'>
    calls.push({ method, ...params })
    const env = { ...process.env }
    for (const [key, value] of Object.entries(params.env)) { if (value === null) delete env[key]; else env[key] = value }
    const proc = Bun.spawn(params.command, { cwd: params.cwd, env, stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' })
    const [exitCode, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()])
    return { exitCode, stdout, stderr }
  }
  return { cwd, request, calls, service: createWorktreeChanges(request, { cwd }) }
}

describe('remote worktree read scopes', () => {
  test('reads actual staged, unstaged and combined HEAD changes without touching the index', async () => {
    const { cwd, service, calls } = await fixture()
    await writeFile(join(cwd, 'a.txt'), 'staged\nsecond\nthird\n')
    await shell(cwd, 'git', 'add', 'a.txt')
    await writeFile(join(cwd, 'a.txt'), 'staged\nsecond\nworktree\n')
    const indexBefore = await readFile(join(cwd, '.git/index'))
    const staged = await service.readChanges({ kind: 'staged' })
    const unstaged = await service.readChanges({ kind: 'unstaged' })
    const all = await service.readChanges({ kind: 'uncommitted' })
    expect(staged.patch).toContain('+staged'); expect(staged.patch).not.toContain('+worktree')
    expect(unstaged.patch).toContain('+worktree'); expect(unstaged.patch).not.toContain('+staged')
    expect(all.totals).toEqual({ added: 2, removed: 2 })
    expect(staged.complete && unstaged.complete && all.complete).toBe(true)
    expect(await readFile(join(cwd, '.git/index'))).toEqual(indexBefore)
    expect(calls.every(call => call.cwd === cwd && call.command[0] === 'git' && call.outputBytesCap > 0 && call.timeoutMs > 0)).toBe(true)
    expect(calls.filter(call => call.command.includes('diff')).every(call => call.command.includes('--no-ext-diff') && call.command.includes('--no-textconv'))).toBe(true)
  })

  test('bounded commit/ref lists and comparisons use real refs, including a root commit', async () => {
    const { cwd, service, calls } = await fixture()
    const root = (await service.listCommits())[0]!
    expect(root.subject).toBe('initial'); expect(root.parents).toEqual([])
    expect((await service.readChanges({ kind: 'commit', oid: root.oid })).files[0]?.kind).toBe('added')
    await shell(cwd, 'git', 'branch', 'base')
    await writeFile(join(cwd, 'a.txt'), 'changed\n')
    await shell(cwd, 'git', 'commit', '-qam', 'second')
    const refs = await service.listBranches()
    expect(refs.map(ref => ref.ref).sort()).toEqual(['refs/heads/base', 'refs/heads/main'])
    expect(refs.find(ref => ref.name === 'main')?.current).toBe(true)
    expect((await service.readChanges({ kind: 'branch', ref: 'refs/heads/base' })).totals).toEqual({ added: 1, removed: 3 })
    expect(calls.some(call => call.command.includes('--max-count=50'))).toBe(true)
    expect(calls.some(call => call.command.includes('--count=100'))).toBe(true)
    const count = calls.length
    await expect(service.readChanges({ kind: 'commit', oid: '--output=/tmp/evil' })).rejects.toMatchObject({ code: 'git-failed' })
    await expect(service.readChanges({ kind: 'branch', ref: 'refs/heads/main; touch /tmp/evil' })).rejects.toMatchObject({ code: 'git-failed' })
    expect(calls.length).toBe(count)
  })

  test('cwd in a subdirectory only reads and reverses files in that directory', async () => {
    const { cwd, request } = await fixture({ 'outside.txt': 'outside\n', 'nested/inside.txt': 'inside\n' })
    await writeFile(join(cwd, 'outside.txt'), 'outside changed\n')
    await writeFile(join(cwd, 'nested/inside.txt'), 'inside changed\n')
    const service = createWorktreeChanges(request, { cwd: join(cwd, 'nested') })
    const changes = await service.readChanges({ kind: 'unstaged' })
    expect(changes.files.map(file => file.path)).toEqual(['inside.txt'])
    await service.undo(changes.patch)
    expect(await readFile(join(cwd, 'nested/inside.txt'), 'utf8')).toBe('inside\n')
    expect(await readFile(join(cwd, 'outside.txt'), 'utf8')).toBe('outside changed\n')
  })

  test('last turn is parsed without querying or substituting current working-tree data', async () => {
    const { cwd, service, calls } = await fixture()
    await writeFile(join(cwd, 'a.txt'), 'new\n')
    const current = await service.readChanges({ kind: 'unstaged' }), count = calls.length
    const last = await service.readChanges({ kind: 'lastTurn', patch: current.patch })
    expect(last.undoable).toBe(true); expect(calls.length).toBe(count)
    const raw = await service.readChanges({ kind: 'lastTurn', patch: '@@ -1 +1 @@\n-old\n+new\n' })
    expect(raw.undoable).toBe(false); expect(raw.undoReason).toBeTruthy()
  })

  test('unborn branches compare staged and working files against the empty tree', async () => {
    const { cwd, service } = await fixture()
    await shell(cwd, 'git', 'checkout', '--orphan', 'empty')
    await writeFile(join(cwd, 'a.txt'), 'new branch\n')
    expect((await service.readChanges({ kind: 'uncommitted' })).totals).toEqual({ added: 1, removed: 0 })
  })

  test('includes untracked regular, empty and binary files in unstaged and uncommitted only', async () => {
    const { cwd, service } = await fixture()
    await writeFile(join(cwd, 'untracked 文本.txt'), 'untracked\n')
    await writeFile(join(cwd, 'empty.txt'), '')
    await writeFile(join(cwd, 'raw.bin'), new Uint8Array([0, 200, 1]))
    await writeFile(join(cwd, '.gitignore'), 'ignored.txt\n')
    await writeFile(join(cwd, 'ignored.txt'), 'ignored\n')
    for (const kind of ['unstaged', 'uncommitted'] as const) {
      const read = await service.readChanges({ kind })
      expect(read.files.map(file => file.path).sort()).toEqual(['.gitignore', 'empty.txt', 'raw.bin', 'untracked 文本.txt'].sort())
      expect(read.complete).toBe(true)
      expect(read.files.find(file => file.path === 'empty.txt')).toMatchObject({ kind: 'added', added: 0, removed: 0 })
      expect(read.files.find(file => file.path === 'raw.bin')?.binary).toBe(true)
    }
    expect((await service.readChanges({ kind: 'staged' })).files).toEqual([])
  })

  test('SHA-256 unborn repository derives the empty tree with the installed Git', async () => {
    const { cwd, request } = await fixture()
    const sha = join(cwd, 'sha256'); await mkdir(sha)
    await shell(sha, 'git', 'init', '-q', '--object-format=sha256')
    await writeFile(join(sha, 'new.txt'), 'new\n')
    await writeFile(join(sha, 'empty.txt'), '')
    await shell(sha, 'git', 'add', '.')
    const service = createWorktreeChanges(request, { cwd: sha })
    const read = await service.readChanges({ kind: 'uncommitted' })
    expect(read.complete).toBe(true)
    expect(read.totals).toEqual({ added: 1, removed: 0 })
    expect(await service.listCommits()).toEqual([])
    const receipt = await service.undo(read.patch)
    expect(await Bun.file(join(sha, 'new.txt')).exists()).toBe(false)
    await service.redo(receipt)
    expect(await readFile(join(sha, 'new.txt'), 'utf8')).toBe('new\n')
  })

  test('merge commit shows its actual first-parent delta', async () => {
    const { cwd, service } = await fixture({ 'main.txt': 'base\n', 'side.txt': 'base\n' })
    await shell(cwd, 'git', 'checkout', '-qb', 'side')
    await writeFile(join(cwd, 'side.txt'), 'side change\n'); await shell(cwd, 'git', 'commit', '-qam', 'side work')
    await shell(cwd, 'git', 'checkout', '-q', 'main')
    await writeFile(join(cwd, 'main.txt'), 'main change\n'); await shell(cwd, 'git', 'commit', '-qam', 'main work')
    await shell(cwd, 'git', 'merge', '--no-ff', '-qm', 'merged', 'side')
    const commits = await service.listCommits(), merge = commits.find(commit => commit.subject === 'merged')!
    expect(merge.parents).toHaveLength(2)
    const delta = await service.readChanges({ kind: 'commit', oid: merge.oid })
    expect(delta.complete).toBe(true)
    expect(delta.files.map(file => file.path)).toEqual(['side.txt'])
  })

  test('branch scope compares the merge base to current working files, including staged and untracked changes', async () => {
    const { cwd, service } = await fixture({ 'a.txt': 'initial a\n', 'b.txt': 'initial b\n', 'base.txt': 'initial base\n' })
    await shell(cwd, 'git', 'checkout', '-qb', 'base')
    await writeFile(join(cwd, 'base.txt'), 'base branch only\n'); await shell(cwd, 'git', 'commit', '-qam', 'base advanced')
    await shell(cwd, 'git', 'checkout', '-q', 'main')
    await writeFile(join(cwd, 'a.txt'), 'committed a\n'); await shell(cwd, 'git', 'commit', '-qam', 'main advanced')
    await writeFile(join(cwd, 'a.txt'), 'working a\n')
    await writeFile(join(cwd, 'b.txt'), 'staged b\n'); await shell(cwd, 'git', 'add', 'b.txt')
    await writeFile(join(cwd, 'new.txt'), 'untracked\n')
    const index = await readFile(join(cwd, '.git/index'))
    const diff = await service.readChanges({ kind: 'branch', ref: 'refs/heads/base' })
    expect(diff.complete).toBe(true)
    expect(diff.files.map(file => file.path)).toEqual(['a.txt', 'b.txt', 'new.txt'])
    expect(diff.patch).toContain('-initial a\n+working a')
    expect(diff.patch).toContain('-initial b\n+staged b')
    expect(diff.patch).not.toContain('committed a')
    expect(diff.patch).not.toContain('base branch only')
    expect(diff.totals).toEqual({ added: 3, removed: 2 })
    expect(await readFile(join(cwd, '.git/index'))).toEqual(index)
  })

  test('rejects capped output, malformed responses and read cancellation', async () => {
    for (const stdout of ['x'.repeat(MAX_PATCH_BYTES + 1), 'é'.repeat(MAX_PATCH_BYTES / 2 + 1)]) {
      const service = createWorktreeChanges(async () => ({ exitCode: 0, stdout, stderr: '' }), { cwd: '/remote' })
      await expect(service.readChanges({ kind: 'unstaged' })).rejects.toMatchObject({ code: 'output-limit' })
    }
    const truncated = createWorktreeChanges(async () => ({ exitCode: 0, stdout: '', stderr: '', stdoutTruncated: true }), { cwd: '/remote' })
    await expect(truncated.readChanges({ kind: 'unstaged' })).rejects.toMatchObject({ code: 'output-limit' })
    const invalid = createWorktreeChanges(async () => ({ stdout: '' }), { cwd: '/remote' })
    await expect(invalid.readChanges({ kind: 'unstaged' })).rejects.toMatchObject({ code: 'git-failed' })
    let requests = 0
    const cancelled = createWorktreeChanges(async () => { requests++; return {} }, { cwd: '/remote' })
    await expect(cancelled.readChanges({ kind: 'unstaged' }, { signal: AbortSignal.abort() })).rejects.toMatchObject({ name: 'AbortError' })
    expect(requests).toBe(0)
  })
})

describe('complete Git patch parser', () => {
  test('preserves spaces, quoted UTF-8 and patch text; counts real complete hunks', async () => {
    const { cwd, service } = await fixture({ 'space file.txt': 'old\n', '中文.txt': 'one\n', 'weird b/space.txt': 'before\n' })
    for (const file of ['space file.txt', '中文.txt', 'weird b/space.txt']) await writeFile(join(cwd, file), 'new\nextra\n')
    const changes = await service.readChanges({ kind: 'unstaged' })
    expect(changes.complete).toBe(true)
    expect(changes.files.map(file => file.path).sort()).toEqual(['space file.txt', 'weird b/space.txt', '中文.txt'].sort())
    expect(changes.totals).toEqual({ added: 6, removed: 3 })
    expect(changes.files.map(file => file.patch).join('')).toBe(changes.patch)
    await service.undo(changes.patch)
    expect(await readFile(join(cwd, '中文.txt'), 'utf8')).toBe('one\n')
  })

  test('retains rename, binary, modes and empty-file metadata without invented binary totals', async () => {
    const { cwd, service } = await fixture({ 'old name.txt': 'preserve\n', 'binary.bin': new Uint8Array([0, 1, 2, 3]) })
    await rename(join(cwd, 'old name.txt'), join(cwd, 'new name.txt'))
    await writeFile(join(cwd, 'empty.txt'), '')
    await writeFile(join(cwd, 'binary.bin'), new Uint8Array([0, 255, 2, 3]))
    await shell(cwd, 'git', 'add', '.')
    const changes = await service.readChanges({ kind: 'staged' })
    expect(changes.complete).toBe(true)
    expect(changes.files.find(file => file.path === 'new name.txt')).toMatchObject({ kind: 'renamed', oldPath: 'old name.txt', newPath: 'new name.txt', added: 0, removed: 0 })
    expect(changes.files.find(file => file.path === 'binary.bin')).toMatchObject({ binary: true })
    expect(changes.files.find(file => file.path === 'binary.bin')?.added).toBeUndefined()
    expect(changes.files.find(file => file.path === 'empty.txt')).toMatchObject({ kind: 'added', added: 0, removed: 0 })
    expect(changes.totals).toBeUndefined()
    const receipt = await service.undo(changes.patch)
    expect(await readFile(join(cwd, 'binary.bin'))).toEqual(Buffer.from([0, 1, 2, 3]))
    expect(await readFile(join(cwd, 'old name.txt'), 'utf8')).toBe('preserve\n')
    await service.redo(receipt)
    expect(await readFile(join(cwd, 'new name.txt'), 'utf8')).toBe('preserve\n')
  })

  test('does not manufacture totals from truncated or headerless hunks', () => {
    const full = 'diff --git a/a b/a\nindex 1111111..2222222 100644\n--- a/a\n+++ b/a\n@@ -1,2 +1,2 @@\n-old\n+new\n same\n'
    expect(parseGitPatch(full).totals).toEqual({ added: 1, removed: 1 })
    for (const bad of [full.slice(0, -6), full.slice(0, -1), '@@ -1 +1 @@\n-a\n+b\n', 'diff --git a/a b/a\nindex 1111111..2222222 100644\n']) {
      expect(parseGitPatch(bad).complete).toBe(false)
      expect(parseGitPatch(bad).totals).toBeUndefined()
      expect(undoUnavailableReason(bad)).toBeTruthy()
    }
  })

  test('handles no-newline markers and mode-only updates', async () => {
    const { cwd, service } = await fixture({ 'run.sh': 'echo before' })
    await writeFile(join(cwd, 'run.sh'), 'echo after')
    expect((await service.readChanges({ kind: 'unstaged' })).totals).toEqual({ added: 1, removed: 1 })
    await writeFile(join(cwd, 'run.sh'), 'echo before')
    await chmod(join(cwd, 'run.sh'), 0o755)
    const mode = await service.readChanges({ kind: 'unstaged' })
    expect(mode.complete).toBe(true)
    expect(mode.files[0]).toMatchObject({ oldMode: '100644', newMode: '100755', added: 0, removed: 0 })
    await service.undo(mode.patch)
    expect((await stat(join(cwd, 'run.sh'))).mode & 0o111).toBe(0)
  })
})

describe('safe remote reverse and redo', () => {
  test('undo and redo preserve unrelated same-file edits and staged bytes', async () => {
    const original = Array.from({ length: 30 }, (_, i) => `line ${i}\n`).join('')
    const { cwd, service, calls } = await fixture({ 'a.txt': original, 'other.txt': 'base\n' })
    const staged = original.replace('line 29', 'staged 29')
    await writeFile(join(cwd, 'a.txt'), staged)
    await shell(cwd, 'git', 'add', 'a.txt')
    await writeFile(join(cwd, 'a.txt'), staged.replace('line 1\n', 'turn 1\n'))
    const turn = await service.readChanges({ kind: 'unstaged' })
    await writeFile(join(cwd, 'a.txt'), staged.replace('line 1\n', 'turn 1\n').replace('line 20', 'later 20'))
    await writeFile(join(cwd, 'other.txt'), 'unrelated\n')
    const index = await readFile(join(cwd, '.git/index'))
    const receipt = await service.undo(turn.patch)
    expect(await readFile(join(cwd, 'a.txt'), 'utf8')).toBe(staged.replace('line 20', 'later 20'))
    expect(await readFile(join(cwd, 'other.txt'), 'utf8')).toBe('unrelated\n')
    expect(await readFile(join(cwd, '.git/index'))).toEqual(index)
    await service.redo(receipt)
    expect(await readFile(join(cwd, 'a.txt'), 'utf8')).toBe(staged.replace('line 1\n', 'turn 1\n').replace('line 20', 'later 20'))
    expect(await readFile(join(cwd, '.git/index'))).toEqual(index)
    await expect(service.redo(receipt)).rejects.toMatchObject({ code: 'invalid-receipt' })
    expect(calls.filter(call => call.command[0] === 'python3').every(call => call.command.includes('-I') && call.command.includes('-c') && !call.command.includes('sh'))).toBe(true)
  })

  test('one conflicted file prevents every file in a multi-file undo from changing', async () => {
    const { cwd, service } = await fixture({ 'a.txt': 'a\n', 'b.txt': 'b\n' })
    await writeFile(join(cwd, 'a.txt'), 'turn a\n'); await writeFile(join(cwd, 'b.txt'), 'turn b\n')
    const turn = await service.readChanges({ kind: 'unstaged' })
    await writeFile(join(cwd, 'b.txt'), 'concurrent b\n')
    await expect(service.undo(turn.patch)).rejects.toMatchObject({ code: 'conflict' })
    expect(await readFile(join(cwd, 'a.txt'), 'utf8')).toBe('turn a\n')
    expect(await readFile(join(cwd, 'b.txt'), 'utf8')).toBe('concurrent b\n')
  })

  test('redo refuses conflicting newer edits and retains its retry receipt', async () => {
    const { cwd, service } = await fixture()
    await writeFile(join(cwd, 'a.txt'), 'changed\n')
    const turn = await service.readChanges({ kind: 'unstaged' }), receipt = await service.undo(turn.patch)
    await writeFile(join(cwd, 'a.txt'), 'other writer\n')
    await expect(service.redo(receipt)).rejects.toMatchObject({ code: 'conflict' })
    expect(await readFile(join(cwd, 'a.txt'), 'utf8')).toBe('other writer\n')
    await writeFile(join(cwd, 'a.txt'), 'first\nsecond\nthird\n')
    await service.redo(receipt)
    expect(await readFile(join(cwd, 'a.txt'), 'utf8')).toBe('changed\n')
  })

  test('rejects traversal, absolute and Git metadata targets before any remote command', async () => {
    let calls = 0
    const service = createWorktreeChanges(async () => { calls++; return {} }, { cwd: '/remote' })
    for (const path of ['../outside', '/tmp/outside', '.git/config', 'nested/../../outside', '.GIT/config', 'C:/outside']) {
      const patch = `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old\n+new\n`
      await expect(service.undo(patch)).rejects.toMatchObject({ code: 'unsafe-path' })
    }
    expect(calls).toBe(0)
  })

  test('rejects symlink files and parent directories without touching their targets', async () => {
    const { cwd, service } = await fixture({ 'safe/a.txt': 'old\n' })
    await writeFile(join(cwd, 'safe/a.txt'), 'new\n')
    const patch = (await service.readChanges({ kind: 'unstaged' })).patch
    const outside = await mkdtemp(join(tmpdir(), 'worktree-outside-')); roots.push(outside)
    await writeFile(join(outside, 'a.txt'), 'new\n')
    await rm(join(cwd, 'safe'), { recursive: true })
    await symlink(outside, join(cwd, 'safe'))
    await expect(service.undo(patch)).rejects.toMatchObject({ code: 'unsafe-path' })
    expect(await readFile(join(outside, 'a.txt'), 'utf8')).toBe('new\n')
    await rm(join(cwd, 'safe')); await mkdir(join(cwd, 'safe'))
    await symlink(join(outside, 'a.txt'), join(cwd, 'safe/a.txt'))
    await expect(service.undo(patch)).rejects.toMatchObject({ code: 'unsafe-path' })
    expect(await readFile(join(outside, 'a.txt'), 'utf8')).toBe('new\n')
  })

  test('new symlink and submodule patches never reach the executor', async () => {
    let calls = 0
    const service = createWorktreeChanges(async () => { calls++; return {} }, { cwd: '/remote' })
    for (const mode of ['120000', '160000']) {
      const patch = `diff --git a/link b/link\nnew file mode ${mode}\n--- /dev/null\n+++ b/link\n@@ -0,0 +1 @@\n+../outside\n`
      await expect(service.undo(patch)).rejects.toMatchObject({ code: 'invalid-patch' })
    }
    expect(calls).toBe(0)
  })

  test('rejects concatenated same-file history instead of pretending it is a net turn patch', async () => {
    let calls = 0
    const service = createWorktreeChanges(async () => { calls++; return {} }, { cwd: '/remote' })
    const patch = 'diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old\n+new\n'
    await expect(service.undo(patch + patch.replace('-old\n+new', '-new\n+newer'))).rejects.toMatchObject({ code: 'invalid-patch' })
    expect(calls).toBe(0)
  })

  test('refuses a symlink working directory and multiply linked target files', async () => {
    const { cwd, request, service } = await fixture()
    await writeFile(join(cwd, 'a.txt'), 'changed\n')
    const patch = (await service.readChanges({ kind: 'unstaged' })).patch
    const parent = await mkdtemp(join(tmpdir(), 'worktree-link-')); roots.push(parent)
    await symlink(cwd, join(parent, 'project'))
    await expect(createWorktreeChanges(request, { cwd: join(parent, 'project') }).undo(patch)).rejects.toMatchObject({ code: 'unsafe-path' })
    await link(join(cwd, 'a.txt'), join(parent, 'shared'))
    await expect(service.undo(patch)).rejects.toMatchObject({ code: 'unsafe-path' })
    expect(await readFile(join(parent, 'shared'), 'utf8')).toBe('changed\n')
  })

  test('Python helper cannot import a repository file as a standard library module', async () => {
    const { cwd, service } = await fixture()
    await writeFile(join(cwd, 'a.txt'), 'changed\n')
    const patch = (await service.readChanges({ kind: 'unstaged' })).patch
    await writeFile(join(cwd, 'subprocess.py'), 'raise RuntimeError("untrusted workspace code")\n')
    await service.undo(patch)
    expect(await readFile(join(cwd, 'a.txt'), 'utf8')).toBe('first\nsecond\nthird\n')
  })

  test('overlapping mutation calls are refused and forged receipts cannot be replayed', async () => {
    const patch = 'diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old\n+new\n'
    let complete!: (value: unknown) => void
    const service = createWorktreeChanges(() => new Promise(resolve => { complete = resolve }), { cwd: '/remote' })
    const pending = service.undo(patch)
    await expect(service.undo(patch)).rejects.toMatchObject({ code: 'busy' })
    await expect(service.redo({ id: 'forged', cwd: '/remote', paths: ['a'] })).rejects.toMatchObject({ code: 'invalid-receipt' })
    complete({ exitCode: 0, stdout: '{"ok":true}', stderr: '' })
    const receipt = await pending
    await expect(service.redo({ ...receipt, cwd: '/different' })).rejects.toMatchObject({ code: 'invalid-receipt' })
  })

  test('transport failure after dispatch is uncertain, never reported as a safe cancellation', async () => {
    const patch = 'diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old\n+new\n'
    const service = createWorktreeChanges(async () => { throw new DOMException('Disconnected', 'AbortError') }, { cwd: '/remote' })
    await expect(service.undo(patch)).rejects.toMatchObject({ code: 'uncertain' })
  })

  test('missing Python executable is a known dependency error, with no possible apply', async () => {
    const patch = 'diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old\n+new\n'
    const service = createWorktreeChanges(async () => ({ exitCode: 127, stdout: '', stderr: 'python3: not found' }), { cwd: '/remote' })
    await expect(service.undo(patch)).rejects.toMatchObject({ code: 'dependency-missing' })
  })
})
