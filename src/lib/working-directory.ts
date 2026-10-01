import { DEFAULT_WORKING_DIRECTORY } from '../../shared/profiles'

export function deviceDirectory(cwd?: string): string { return cwd?.trim() || DEFAULT_WORKING_DIRECTORY }

/** Resolve ~ on the connected device, never on the bridge/browser machine. */
export async function resolveDeviceDirectory(cwd: string, run: (params: Record<string, unknown>) => Promise<{ stdout?: string; stdoutTruncated?: boolean; stderr?: string; exitCode?: number }>): Promise<string> {
  const path = deviceDirectory(cwd)
  if (path !== '~' && !path.startsWith('~/')) return path
  const script = 'test -n "$HOME" || exit 1; case "$1" in "~") target=$HOME ;; "~/"*) target=$HOME/$(printf "%s" "$1" | cut -c 3-) ;; *) exit 1 ;; esac; mkdir -p -- "$target" && printf "%s" "$target"'
  const result = await run({ command: ['sh', '-c', script, 'codex-remote-directory', path], outputBytesCap: 4096, timeoutMs: 10_000 })
  if (result.exitCode !== 0 || result.stdoutTruncated || typeof result.stdout !== 'string' || !result.stdout.startsWith('/') || /[\r\n\0]/.test(result.stdout)) throw new Error('无法在设备上准备默认工作目录，请检查目录权限或填写绝对路径。')
  return result.stdout
}
