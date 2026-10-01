import { DEFAULT_WORKING_DIRECTORY } from '../../shared/profiles'
import { RpcError } from './rpc'

export function deviceDirectory(cwd?: string): string { return cwd?.trim() || DEFAULT_WORKING_DIRECTORY }
type DirectoryRpc = (method: string, params: Record<string, unknown>) => Promise<unknown>

async function directoryCommand(request: DirectoryRpc, path: string, create: boolean): Promise<string> {
  // Bootstrap from an existing root, never from the directory being prepared.
  // Paths are positional arguments; shell metacharacters are never evaluated.
  const resolve = 'case "$1" in "~") test -n "$HOME" || exit 1; target=$HOME ;; "~/"*) test -n "$HOME" || exit 1; target=$HOME/$(printf "%s" "$1" | cut -c 3-) ;; /*) target=$1 ;; *) exit 1 ;; esac; '
  const script = resolve + (create ? 'mkdir -p -- "$target" && ' : '') + 'printf "%s" "$target"'
  const result = await request('command/exec', { command: ['sh', '-c', script, 'codex-remote-directory', path], cwd: '/', outputBytesCap: 4096, timeoutMs: 10_000 }) as { exitCode?: number; stdout?: string; stdoutTruncated?: boolean } | null
  if (!result || result.exitCode !== 0 || result.stdoutTruncated || typeof result.stdout !== 'string' || !result.stdout.startsWith('/') || /[\r\n\0]/.test(result.stdout)) throw new Error('无法解析或创建默认工作目录。')
  return result.stdout
}

/** Prepare only on an explicit new-session action, on the connected device. */
export async function prepareDeviceDirectory(cwd: string, request: DirectoryRpc): Promise<string> {
  const configured = deviceDirectory(cwd)
  const path = configured === '~' || configured.startsWith('~/') ? await directoryCommand(request, configured, false) : configured
  try {
    const acknowledgement = await request('fs/createDirectory', { path, recursive: true })
    if (!acknowledgement || typeof acknowledgement !== 'object' || Array.isArray(acknowledgement)) throw new Error('设备未确认创建默认工作目录。')
  } catch (cause) {
    // Fall back only for an absent API, never around an actual permission denial.
    const unsupported = cause instanceof RpcError && (cause.code === -32601 || cause.code === -32600 && /unknown variant/.test(cause.message) && cause.message.includes('fs/createDirectory'))
    if (!unsupported || !path.startsWith('/')) throw cause
    await directoryCommand(request, path, true)
  }
  return path
}
