import { randomBytes, randomUUID } from 'node:crypto'
import { constants, type Stats } from 'node:fs'
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises'
import { basename, dirname, join, parse, resolve, sep } from 'node:path'
import { normalizeEndpoint } from '../shared/endpoint'

import type { ConnectionProfile } from '../shared/protocol'
import { parseProfile, parseProfileSnapshot, profileFields, profileId, record, type ProfileSnapshot } from '../shared/profiles'
import { INPUT_HISTORY_LIMIT, INPUT_HISTORY_STORAGE_LIMIT, parseHistoryEntries, parseHistoryInput, type InputHistoryEntry } from '../shared/input-history'

export type RememberedSession = { id: string; expiresAt: number }
type StoreData = { version: 1 | 2; credentials: Credentials; profiles?: ConnectionProfile[]; selectedId?: string; inputHistory?: InputHistoryEntry[]; rememberedSessions?: RememberedSession[] }
type Credential = { endpoint: string; token: string }
type Credentials = Record<string, Credential>
const pending = new Map<string, Promise<void>>()
const REMEMBERED_SESSION_LIMIT = 1024

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

function parseRememberedSessions(value: unknown): RememberedSession[] {
  if (!Array.isArray(value) || value.length > REMEMBERED_SESSION_LIMIT) throw unavailable()
  const ids = new Set<string>()
  return value.map(session => {
    if (!isRecord(session) || typeof session.id !== 'string' || !/^[a-f0-9]{64}$/.test(session.id) ||
      typeof session.expiresAt !== 'number' || !Number.isSafeInteger(session.expiresAt) || session.expiresAt <= 0 || ids.has(session.id)) throw unavailable()
    ids.add(session.id)
    return { id: session.id, expiresAt: session.expiresAt }
  })
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

  private async read(): Promise<StoreData> {
    try {
      if (!await privateDirectory(dirname(this.file), false)) return { version: 1, credentials: {} }
      let handle
      try { handle = await open(this.file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK) } catch (error) {
        if (missing(error)) return { version: 1, credentials: {} }
        throw error
      }
      let raw: string
      try {
        privateFile(await handle.stat())
        raw = await handle.readFile('utf8')
      } finally { await handle.close() }
      const data: unknown = JSON.parse(raw)
      if (!isRecord(data) || (data.version !== 1 && data.version !== 2) || !isRecord(data.credentials)) throw unavailable()
      for (const [id, value] of Object.entries(data.credentials)) {
        credentialId(id)
        if (!isRecord(value) || typeof value.endpoint !== 'string' || normalizeEndpoint(value.endpoint) !== value.endpoint) throw unavailable()
        if (credentialToken(value.token, true) !== value.token) throw unavailable()
      }
      if (data.version === 2 || data.profiles !== undefined) parseProfileSnapshot(data)
      if (data.inputHistory !== undefined) parseHistoryEntries(data.inputHistory)
      if (data.rememberedSessions !== undefined) parseRememberedSessions(data.rememberedSessions)
      return data as StoreData
    } catch { throw unavailable() }
  }

  private async write(data: StoreData): Promise<void> {
    // A pre-profile bridge must reject this format instead of overwriting metadata.
    if (data.profiles !== undefined) data.version = 2
    const directory = dirname(this.file)
    const temporary = join(directory, '.' + basename(this.file) + '.' + randomBytes(16).toString('hex') + '.tmp')
    let handle: Awaited<ReturnType<typeof open>> | undefined
    let created = false
    try {
      await privateDirectory(directory, true)
      handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
      created = true
      await handle.chmod(0o600)
      await handle.writeFile(JSON.stringify(data) + '\n', 'utf8')
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
      const data = await this.read(), credentials = data.credentials
      if (id !== undefined && !Object.hasOwn(credentials, id)) throw new CredentialError('保存的连接凭证不存在。', 404)
      let key = id
      if (key === undefined) do { key = randomBytes(32).toString('hex') } while (Object.hasOwn(credentials, key))
      if (data.profiles?.some(profile => profile.credentialId === key && profile.endpoint !== normalized)) throw new CredentialError('请通过设备配置修改已绑定的凭证。', 409)
      credentials[key] = { endpoint: normalized, token: validatedToken }
      await this.write(data)
      return key
    })
  }

  async token(id: string, endpoint: string): Promise<string> {
    credentialId(id)
    return this.serialized(async () => {
      const data = await this.read(), credentials = data.credentials
      const credential = credentials[id]
      if (!credential) throw new CredentialError('保存的连接凭证不存在。', 404)
      if (credential.endpoint !== normalizedEndpoint(endpoint)) throw new CredentialError('保存的连接凭证与此地址不匹配。')
      return credential.token
    })
  }

  async remove(id: string): Promise<void> {
    credentialId(id)
    return this.serialized(async () => {
      const data = await this.read(), credentials = data.credentials
      if (!Object.hasOwn(credentials, id)) return
      if (data.profiles?.some(profile => profile.credentialId === id)) throw new CredentialError('请在设备配置中清除已保存的令牌。', 409)
      delete credentials[id]
      await this.write(data)
    })
  }

  async rememberedSessions(): Promise<RememberedSession[]> {
    return this.serialized(async () => {
      const data = await this.read()
      return (data.rememberedSessions ?? []).filter(session => session.expiresAt > Date.now()).map(session => ({ ...session }))
    })
  }

  async saveRememberedSession(session: RememberedSession, previousId?: string): Promise<void> {
    const validated = parseRememberedSessions([session])[0]!
    if (previousId !== undefined) credentialId(previousId)
    return this.serialized(async () => {
      const data = await this.read()
      const sessions = (data.rememberedSessions ?? []).filter(entry => entry.expiresAt > Date.now() && entry.id !== previousId && entry.id !== validated.id)
      if (sessions.length >= REMEMBERED_SESSION_LIMIT) throw new CredentialError('记住登录的设备数量已达上限，请关闭“记住密码”后登录。', 429)
      data.rememberedSessions = [...sessions, validated]
      await this.write(data)
    })
  }

  async removeRememberedSession(id: string): Promise<void> {
    credentialId(id)
    return this.serialized(async () => {
      const data = await this.read()
      if (!data.rememberedSessions?.some(session => session.id === id)) return
      data.rememberedSessions = data.rememberedSessions.filter(session => session.id !== id && session.expiresAt > Date.now())
      await this.write(data)
    })
  }

  private snapshot(data: StoreData): ProfileSnapshot {
    return parseProfileSnapshot({ profiles: data.profiles ?? [], selectedId: data.selectedId ?? '' })
  }

  async profiles(): Promise<ProfileSnapshot> {
    return this.serialized(async () => this.snapshot(await this.read()))
  }

  async saveProfile(input: unknown, importing = false): Promise<ProfileSnapshot & { profile: ConnectionProfile }> {
    if (!record(input)) throw new CredentialError('无效的设备配置。')
    let fields: ReturnType<typeof profileFields>, id: string | undefined
    try { fields = profileFields(input); id = input.id === undefined ? undefined : profileId(input.id) }
    catch (error) { throw new CredentialError((error as Error).message) }
    const token = credentialToken(input.token)
    for (const key of ['rememberToken', 'clearToken']) if (input[key] !== undefined && typeof input[key] !== 'boolean') throw new CredentialError('无效的令牌保存设置。')
    return this.serialized(async () => {
      const data = await this.read(), profiles = data.profiles ?? []
      const duplicate = profiles.find(profile => profile.endpoint === fields.endpoint)
      if (importing && duplicate) return { ...this.snapshot(data), profile: duplicate }
      if (!importing && duplicate && duplicate.id !== id) throw new CredentialError('这个地址已保存，请直接连接已有设备。', 409)
      const old = importing ? undefined : profiles.find(profile => profile.id === id)
      if (!importing && id && !old) throw new CredentialError('设备已被移除，请刷新设备列表。', 404)
      if (!old && profiles.length >= 512) throw new CredentialError('保存的设备数量已达上限。')
      const remember = input.rememberToken ?? !!old?.credentialId
      if (old?.credentialId && old.endpoint !== fields.endpoint && !token && remember && !input.clearToken) throw new CredentialError('地址已更改，请填写新令牌，或清除已保存的令牌。')
      const profile: ConnectionProfile = { id: old?.id ?? (importing && id && !profiles.some(p => p.id === id) ? id : randomUUID()), ...fields, createdAt: old?.createdAt ?? Date.now() }
      if (importing) {
        let legacy: ConnectionProfile
        try { legacy = parseProfile(input) } catch (error) { throw new CredentialError((error as Error).message) }
        profile.createdAt = legacy.createdAt
        if (legacy.credentialId) {
          const credential = data.credentials[legacy.credentialId]
          if (!credential || credential.endpoint !== profile.endpoint) throw new CredentialError('旧设备的令牌不存在或地址不匹配，请编辑设备后重新保存。')
          profile.credentialId = legacy.credentialId
        }
      } else {
        if (remember && !input.clearToken && old?.endpoint === fields.endpoint && old.credentialId) profile.credentialId = old.credentialId
        if (remember && token) {
          do { profile.credentialId = randomBytes(32).toString('hex') } while (Object.hasOwn(data.credentials, profile.credentialId))
          data.credentials[profile.credentialId] = { endpoint: fields.endpoint, token }
        }
      }
      data.profiles = old ? profiles.map(p => p.id === old.id ? profile : p) : [...profiles, profile]
      data.selectedId = data.selectedId || profile.id
      if (old?.credentialId && old.credentialId !== profile.credentialId && !data.profiles.some(p => p.credentialId === old.credentialId)) delete data.credentials[old.credentialId]
      await this.write(data)
      return { ...this.snapshot(data), profile }
    })
  }

  async removeProfile(value: unknown): Promise<ProfileSnapshot> {
    let id: string
    try { id = profileId(value) } catch (error) { throw new CredentialError((error as Error).message) }
    return this.serialized(async () => {
      const data = await this.read(), profile = data.profiles?.find(p => p.id === id)
      if (!profile) return this.snapshot(data)
      data.profiles = data.profiles!.filter(p => p.id !== id)
      if (data.inputHistory) data.inputHistory = data.inputHistory.filter(entry => entry.deviceId !== id)
      if (profile.credentialId && !data.profiles.some(p => p.credentialId === profile.credentialId)) delete data.credentials[profile.credentialId]
      if (data.selectedId === id) data.selectedId = data.profiles[0]?.id || ''
      await this.write(data)
      return this.snapshot(data)
    })
  }

  async selectProfile(value: unknown): Promise<ProfileSnapshot> {
    let id: string
    try { id = value === '' ? '' : profileId(value) } catch (error) { throw new CredentialError((error as Error).message) }
    return this.serialized(async () => {
      const data = await this.read()
      if (id && !data.profiles?.some(profile => profile.id === id)) throw new CredentialError('设备已被移除，请刷新设备列表。', 404)
      data.profiles ??= []
      data.selectedId = id || data.profiles[0]?.id || ''
      await this.write(data)
      return this.snapshot(data)
    })
  }

  async inputHistory(device: unknown): Promise<InputHistoryEntry[]> {
    let id: string
    try { id = profileId(device) } catch (error) { throw new CredentialError((error as Error).message) }
    return this.serialized(async () => {
      const data = await this.read()
      if (!data.profiles?.some(profile => profile.id === id)) throw new CredentialError('设备已被移除，请刷新设备列表。', 404)
      return (data.inputHistory ?? []).filter(entry => entry.deviceId === id).slice(-INPUT_HISTORY_LIMIT)
    })
  }

  async rememberInput(value: unknown): Promise<InputHistoryEntry[]> {
    let id: string, input: ReturnType<typeof parseHistoryInput>, entryId: string
    try {
      if (!record(value)) throw new Error('输入历史格式无效。')
      id = profileId(value.deviceId); input = parseHistoryInput(value.input)
      entryId = profileId(value.id)
    } catch (error) { throw new CredentialError((error as Error).message) }
    return this.serialized(async () => {
      const data = await this.read()
      if (!data.profiles?.some(profile => profile.id === id)) throw new CredentialError('设备已被移除，请刷新设备列表。', 404)
      const entries = data.inputHistory ?? []
      const old = entries.find(entry => entry.deviceId === id && entry.id === entryId)
      if (old && JSON.stringify(old.input) !== JSON.stringify(input)) throw new CredentialError('输入历史标识已被使用。', 409)
      if (!old) {
        const sameDevice = entries.filter(entry => entry.deviceId === id).slice(-(INPUT_HISTORY_LIMIT - 1))
        const retained = new Set(sameDevice.map(entry => entry.id))
        data.inputHistory = [...entries.filter(entry => entry.deviceId !== id || retained.has(entry.id)), { id: entryId, deviceId: id, createdAt: Date.now(), input }]
        const sizes = data.inputHistory.map(entry => Buffer.byteLength(JSON.stringify(entry)) + 1)
        let size = sizes.reduce((sum, bytes) => sum + bytes, 2), remove = 0
        while (size > INPUT_HISTORY_STORAGE_LIMIT) size -= sizes[remove++]!
        if (remove) data.inputHistory.splice(0, remove)
        await this.write(data)
      }
      return (data.inputHistory ?? entries).filter(entry => entry.deviceId === id)
    })
  }
}
