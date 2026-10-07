import { git, remoteEnv } from './worktree-changes'
import type { Thread } from '../../shared/protocol'

export type GitContext = { root: string; branch: string | null; head: string | null; linked: boolean }
export type GitRun = (params: Record<string, unknown>, options?: { signal?: AbortSignal; timeoutMs?: number }) => Promise<unknown>

const CAP = 4096

export function normalizeGitCwd(value: string | undefined): string | null {
  if (!value) return null
  if (value.startsWith('file:')) {
    try {
      const url = new URL(value)
      if (url.protocol !== 'file:' || url.hostname && url.hostname !== 'localhost' || url.search || url.hash) return null
      value = decodeURIComponent(url.pathname)
    } catch { return null }
  }
  return value.startsWith('/') && !/[\x00-\x1f\x7f]/.test(value) ? value : null
}

export function latestGitCommand(thread: Thread | null) {
  if (!thread) return null
  for (let turnIndex = thread.turns.length - 1; turnIndex >= 0; turnIndex--) {
    const turn = thread.turns[turnIndex]!
    for (let itemIndex = turn.items.length - 1; itemIndex >= 0; itemIndex--) {
      const item = turn.items[itemIndex]!
      if (item.type !== 'commandExecution') continue
      const cwd = normalizeGitCwd(item.cwd)
      if (cwd) return { cwd, revision: [turn.id, item.id, item.status || ''].join('\0') }
    }
  }
  return null
}

function resolve(cwd: string, path: string): string {
  const parts: string[] = []
  for (const part of (path.startsWith('/') ? path : cwd + '/' + path).split('/')) {
    if (part === '..') parts.pop()
    else if (part && part !== '.') parts.push(part)
  }
  return '/' + parts.join('/')
}

export async function readGitContext(run: GitRun, cwd: string, signal?: AbortSignal): Promise<GitContext | null> {
  if (!cwd.startsWith('/') || /[\0\r\n]/.test(cwd)) return null
  async function exec(args: string[]) {
    const raw = await run({ command: [...git, ...args], cwd, env: remoteEnv, outputBytesCap: CAP, timeoutMs: 10_000 }, { signal, timeoutMs: 15_000 }) as
      { exitCode?: unknown; stdout?: unknown; stdoutTruncated?: unknown } | null
    if (!raw || typeof raw.exitCode !== 'number' || typeof raw.stdout !== 'string' || raw.stdoutTruncated) return null
    return { exitCode: raw.exitCode, stdout: raw.stdout.trimEnd() }
  }
  const [layout, symbolic] = await Promise.all([
    exec(['rev-parse', '--is-inside-work-tree', '--git-dir', '--git-common-dir', '--show-toplevel']),
    exec(['symbolic-ref', '--quiet', 'HEAD']),
  ])
  if (!layout || layout.exitCode !== 0) return null
  const [inside, gitDir, commonDir, root] = layout.stdout.split('\n')
  if (inside !== 'true' || !gitDir || !commonDir || !root) return null
  const resolvedDir = resolve(cwd, gitDir)
  const linked = resolvedDir !== resolve(cwd, commonDir) && /\/worktrees\/[^/]+$/.test(resolvedDir)
  if (symbolic?.exitCode === 0 && symbolic.stdout) {
    return { root, linked, head: null, branch: symbolic.stdout.replace(/^refs\/heads\//, '') }
  }
  const head = await exec(['rev-parse', '--short', 'HEAD'])
  return { root, linked, branch: null, head: head?.exitCode === 0 && head.stdout ? head.stdout : null }
}

export function describeGitContext(context: GitContext) {
  const text = context.branch ?? (context.head ? `已分离 ${context.head}` : '无提交')
  const title = [context.linked ? '工作树' : 'Git 仓库', context.root, context.branch ? '分支 ' + context.branch : text].join(' · ')
  return { text, title, linked: context.linked }
}
