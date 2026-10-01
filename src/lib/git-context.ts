import { git, remoteEnv } from './worktree-changes'

export type GitContext = { root: string; branch: string | null; head: string | null; linked: boolean }
export type GitRun = (params: Record<string, unknown>, options?: { signal?: AbortSignal; timeoutMs?: number }) => Promise<unknown>

const CAP = 4096

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
