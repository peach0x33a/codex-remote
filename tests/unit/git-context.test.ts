import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describeGitContext, latestGitCommand, normalizeGitCwd, readGitContext, type GitRun } from '../../src/lib/git-context'
import type { Thread } from '../../shared/protocol'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
async function shell(cwd: string, ...command: string[]) {
  const proc = Bun.spawn(command, { cwd, stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' })
  const [exitCode, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  if (exitCode) throw new Error(`${command.join(' ')}: ${stderr}`)
  return stdout
}
async function temp() { const path = await realpath(await mkdtemp(join(tmpdir(), 'git-context-'))); roots.push(path); return path }
async function repo(commit = true) {
  const base = await temp(), cwd = join(base, 'repo')
  await mkdir(cwd)
  await shell(cwd, 'git', 'init', '-q', '-b', 'main')
  await shell(cwd, 'git', 'config', 'user.email', 'test@example.invalid')
  await shell(cwd, 'git', 'config', 'user.name', 'Test')
  if (commit) await shell(cwd, 'git', 'commit', '--allow-empty', '-qm', 'initial')
  return { base, cwd }
}
const calls: Record<string, unknown>[] = []
const run: GitRun = async params => {
  calls.push(params)
  const env = { ...process.env, LC_ALL: 'C' } as Record<string, string | undefined>
  for (const [key, value] of Object.entries(params.env as Record<string, string | null>)) { if (value === null) delete env[key]; else env[key] = value }
  const proc = Bun.spawn(params.command as string[], { cwd: params.cwd as string, env: env as Record<string, string>, stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' })
  const [exitCode, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  return { exitCode, stdout, stderr }
}

describe('git context', () => {
  test('reports a normal repository branch and is not a linked worktree', async () => {
    const { cwd } = await repo()
    expect(await readGitContext(run, cwd)).toEqual({ root: cwd, branch: 'main', head: null, linked: false })
  })

  test('resolves the repository from a subdirectory', async () => {
    const { cwd } = await repo()
    await mkdir(join(cwd, 'deep/er'), { recursive: true })
    expect(await readGitContext(run, join(cwd, 'deep/er'))).toEqual({ root: cwd, branch: 'main', head: null, linked: false })
  })

  test('detects a linked worktree and its own branch', async () => {
    const { base, cwd } = await repo()
    const linked = join(base, 'wt')
    await shell(cwd, 'git', 'worktree', 'add', '-q', '-b', 'feature/x', linked)
    expect(await readGitContext(run, linked)).toEqual({ root: linked, branch: 'feature/x', head: null, linked: true })
    await mkdir(join(linked, 'sub'))
    expect((await readGitContext(run, join(linked, 'sub')))?.linked).toBe(true)
    expect((await readGitContext(run, cwd))?.linked).toBe(false)
  })

  test('a detached worktree reports its short commit instead of a branch', async () => {
    const { base, cwd } = await repo()
    const linked = join(base, 'wt')
    await shell(cwd, 'git', 'worktree', 'add', '-q', '--detach', linked)
    const short = (await shell(linked, 'git', 'rev-parse', '--short', 'HEAD')).trim()
    expect(await readGitContext(run, linked)).toEqual({ root: linked, branch: null, head: short, linked: true })
  })

  test('a repository without commits still names its unborn branch', async () => {
    const { cwd } = await repo(false)
    expect(await readGitContext(run, cwd)).toEqual({ root: cwd, branch: 'main', head: null, linked: false })
  })

  test('returns null outside Git and for unsafe paths without running anything', async () => {
    const plain = await temp()
    expect(await readGitContext(run, plain)).toBeNull()
    const before = calls.length
    for (const unsafe of ['', 'relative/path', '/tmp/a\nb', '/tmp/a\0b']) expect(await readGitContext(run, unsafe)).toBeNull()
    expect(calls.length).toBe(before)
  })

  test('only issues bounded, read-only git commands with a cleared Git environment', async () => {
    const { cwd } = await repo()
    calls.length = 0
    await readGitContext(run, cwd)
    expect(calls.length).toBeGreaterThan(0)
    for (const call of calls) {
      const command = call.command as string[]
      expect(command[0]).toBe('git')
      expect(command.some(part => ['rev-parse', 'symbolic-ref'].includes(part))).toBe(true)
      expect(command.some(part => ['commit', 'checkout', 'add', 'apply', 'reset', 'worktree'].includes(part))).toBe(false)
      expect(call.cwd).toBe(cwd)
      expect(call.outputBytesCap).toBeGreaterThan(0); expect(call.timeoutMs).toBeGreaterThan(0)
      expect(call.env).toMatchObject({ GIT_DIR: null, GIT_WORK_TREE: null, GIT_OPTIONAL_LOCKS: '0' })
    }
  })

  test('malformed or failing command results degrade to no context', async () => {
    expect(await readGitContext(async () => null, '/tmp/x')).toBeNull()
    expect(await readGitContext(async () => ({ exitCode: 'x', stdout: 1 }), '/tmp/x')).toBeNull()
    expect(await readGitContext(async () => ({ exitCode: 0, stdout: 'true\n.git\n.git\n/tmp/x', stdoutTruncated: true }), '/tmp/x')).toBeNull()
    expect(await readGitContext(async () => ({ exitCode: 128, stdout: '', stderr: 'fatal' }), '/tmp/x')).toBeNull()
    expect(await readGitContext(async () => ({ exitCode: 0, stdout: 'false\n.\n.' }), '/tmp/x')).toBeNull()
    await expect(readGitContext(async () => { throw new Error('offline') }, '/tmp/x')).rejects.toThrow('offline')
  })

  test('labels distinguish branches, detached heads and linked worktrees', () => {
    expect(describeGitContext({ root: '/r', branch: 'main', head: null, linked: false })).toMatchObject({ text: 'main', linked: false })
    expect(describeGitContext({ root: '/w', branch: 'feat', head: null, linked: true }).title).toBe('工作树 · /w · 分支 feat')
    expect(describeGitContext({ root: '/w', branch: null, head: 'abc1234', linked: true }).text).toBe('已分离 abc1234')
    expect(describeGitContext({ root: '/w', branch: null, head: null, linked: false }).text).toBe('无提交')
  })

  test('normalizes local command directory URLs without accepting remote or malformed paths', () => {
    expect(normalizeGitCwd('/work/ready/sdk')).toBe('/work/ready/sdk')
    expect(normalizeGitCwd('file:///work/ready%20packet/sdk')).toBe('/work/ready packet/sdk')
    expect(normalizeGitCwd('file://localhost/work/ready/sdk')).toBe('/work/ready/sdk')
    for (const path of [undefined, '', 'relative', 'file://other-host/work/sdk', 'file:///work/%ZZ', 'file:///work/%00sdk', 'file:///work/sdk?query', '/work/\nsdk', 'https://example.com/sdk']) {
      expect(normalizeGitCwd(path)).toBeNull()
    }
  })

  test('uses the newest command directory across turns, ignoring message paths and invalid directories', () => {
    const thread: Thread = { id: 'ready', cwd: '/work/project', preview: '', createdAt: 0, updatedAt: 0, turns: [
      { id: 'older', status: 'completed', items: [{ id: 'old-command', type: 'commandExecution', cwd: '/work/project' }] },
      { id: 'latest', status: 'inProgress', items: [
        { id: 'command', type: 'commandExecution', cwd: 'file:///work/ready/sdk', status: 'completed' },
        { id: 'reply', type: 'agentMessage', text: 'A path /work/unrelated is only text', cwd: '/work/unrelated' },
        { id: 'invalid', type: 'commandExecution', cwd: 'relative/path' },
      ] },
    ] }
    expect(latestGitCommand(thread)).toEqual({ cwd: '/work/ready/sdk', revision: 'latest\0command\0completed' })
    expect(thread.cwd).toBe('/work/project')
    thread.turns.unshift({ id: 'earlier-page', status: 'completed', items: [{ id: 'early-command', type: 'commandExecution', cwd: '/work/old' }] })
    expect(latestGitCommand(thread)?.cwd).toBe('/work/ready/sdk')
    expect(latestGitCommand(null)).toBeNull()
    expect(latestGitCommand({ ...thread, turns: [] })).toBeNull()
  })
})
