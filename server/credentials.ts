import { randomBytes } from 'node:crypto'
import { constants, type Stats } from 'node:fs'
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises'
import { basename, dirname, join, parse, resolve, sep } from 'node:path'
import { normalizeEndpoint } from '../shared/endpoint'

type Credential = { endpoint: string; token: string }
type Credentials = Record<string, Credential>
const pending = new Map<string, Promise<void>>()

export class CredentialError extends Error {
  constructor(message: string, readonly status = 400) { super(message) }
}

export function credentialId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new CredentialError('无效的保存凭证标识。')
  return value
}

function normalizedEndpoint(value: string): string {
  try { return normalizeEndpoint(value) } catch { throw new CredentialError('无效的连接地址。请使用不含认证信息的 ws://、wss:// 或 unix:/// 地址。') }
}

export function credentialEndpoint(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048) throw new CredentialError('无效的连接地址。')
  return normalizedEndpoint(value)
}

// Keep the bridge's existing token limit, newline rejection and trimming.
export function credentialToken(value: unknown, required = false): string {
  if (value === undefined && !required) return ''
  if (typeof value !== 'string' || value.length > 8192 || /[\r\n]/.test(value)) throw new CredentialError('无效的访问令牌。')
  return value.trim()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT'
const unavailable = () => new CredentialError('无法访问保存的连接凭证。请检查服务器凭证存储配置。', 500)

// Walk every component: O_NOFOLLOW on the file alone does not reject linked parents.
async function privateDirectory(directory: string, create: boolean): Promise<boolean> {
  const root = parse(directory).root
  let current = root
  for (const part of directory.slice(root.length).split(sep).filter(Boolean)) {
    current = join(current, part)
    let info
    try { info = await lstat(current) } catch (error) {
      if (!missing(error)) throw error
      if (!create) return false
      try { await mkdir(current, { mode: 0o700 }) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
      info = await lstat(current)
    }
    if (info.isSymbolicLink() || !info.isDirectory()) throw unavailable()
  }
  return true
}

function privateFile(info: Stats) {
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || (info.mode & 0o777) !== 0o600) throw unavailable()
}

export class CredentialStore {
  readonly file: string

  constructor(file: string) { this.file = resolve(file) }

  // Share the queue by path so multiple bridge instances in this process cannot
  // overwrite each other's read/modify/write operations. Failed writes do not poison it.
  private async serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = (pending.get(this.file) ?? Promise.resolve()).then(operation)
    const tail = result.then(() => {}, () => {})
    pending.set(this.file, tail)
    try { return await result } finally { if (pending.get(this.file) === tail) pending.delete(this.file) }
  }

  private async read(): Promise<Credentials> {
    try {
      if (!await privateDirectory(dirname(this.file), false)) return {}
      let handle
      try { handle = await open(this.file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK) } catch (error) {
        if (missing(error)) return {}
        throw error
      }
      let raw: string
      try {
        privateFile(await handle.stat())
        raw = await handle.readFile('utf8')
      } finally { await handle.close() }
      const data: unknown = JSON.parse(raw)
      if (!isRecord(data) || data.version !== 1 || !isRecord(data.credentials)) throw unavailable()
      for (const [id, value] of Object.entries(data.credentials)) {
        credentialId(id)
        if (!isRecord(value) || typeof value.endpoint !== 'string' || normalizeEndpoint(value.endpoint) !== value.endpoint) throw unavailable()
        if (credentialToken(value.token, true) !== value.token) throw unavailable()
      }
      return data.credentials as Credentials
    } catch { throw unavailable() }
  }

  private async write(credentials: Credentials): Promise<void> {
    const directory = dirname(this.file)
    const temporary = join(directory, '.' + basename(this.file) + '.' + randomBytes(16).toString('hex') + '.tmp')
    let handle: Awaited<ReturnType<typeof open>> | undefined
    let created = false
    try {
      await privateDirectory(directory, true)
      handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
      created = true
      await handle.chmod(0o600)
      await handle.writeFile(JSON.stringify({ version: 1, credentials }) + '\n', 'utf8')
      await handle.sync()
      await handle.close()
      handle = undefined
      // Recheck before publishing, including a target replaced since read().
      if (!await privateDirectory(directory, false)) throw unavailable()
      try { privateFile(await lstat(this.file)) } catch (error) { if (!missing(error)) throw error }
      await rename(temporary, this.file)
    } catch { throw unavailable() } finally {
      await handle?.close().catch(() => {})
      if (created) await unlink(temporary).catch(() => {})
    }
  }

  async save(endpoint: string, token: string, id?: string): Promise<string> {
    // HTTP input is bounded before normalization; URL escaping can expand it.
    const normalized = normalizedEndpoint(endpoint)
    const validatedToken = credentialToken(token, true)
    if (id !== undefined) credentialId(id)
    return this.serialized(async () => {
      const credentials = await this.read()
      if (id !== undefined && !Object.hasOwn(credentials, id)) throw new CredentialError('保存的连接凭证不存在。', 404)
      let key = id
      if (key === undefined) do { key = randomBytes(32).toString('hex') } while (Object.hasOwn(credentials, key))
      credentials[key] = { endpoint: normalized, token: validatedToken }
      await this.write(credentials)
      return key
    })
  }

  async token(id: string, endpoint: string): Promise<string> {
    credentialId(id)
    return this.serialized(async () => {
      const credentials = await this.read()
      const credential = credentials[id]
      if (!credential) throw new CredentialError('保存的连接凭证不存在。', 404)
      if (credential.endpoint !== normalizedEndpoint(endpoint)) throw new CredentialError('保存的连接凭证与此地址不匹配。')
      return credential.token
    })
  }

  async remove(id: string): Promise<void> {
    credentialId(id)
    return this.serialized(async () => {
      const credentials = await this.read()
      if (!Object.hasOwn(credentials, id)) return
      delete credentials[id]
      await this.write(credentials)
    })
  }
}
