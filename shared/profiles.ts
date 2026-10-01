import type { ConnectionProfile } from './protocol'
import { normalizeEndpoint } from './endpoint'

export const DEFAULT_WORKING_DIRECTORY = '~/codex-remote'
export type ProfileSnapshot = { profiles: ConnectionProfile[]; selectedId: string }
export type ProfileInput = { id?: string; name: string; endpoint: string; cwd: string; token: string; rememberToken?: boolean; clearToken?: boolean }
export const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
export function profileId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 128 || /[\x00-\x1f\x7f]/.test(value)) throw new Error('无效的设备标识。')
  return value
}
export function profileFields(value: unknown): Pick<ConnectionProfile, 'name' | 'endpoint' | 'cwd'> {
  if (!record(value) || typeof value.name !== 'string' || !value.name.trim() || value.name.trim().length > 48) throw new Error('请填写不超过 48 字符的设备名称。')
  if (typeof value.endpoint !== 'string' || value.endpoint.length > 2048) throw new Error('无效的连接地址。')
  if (typeof value.cwd !== 'string' || value.cwd.length > 2048 || /[\x00-\x1f\x7f]/.test(value.cwd)) throw new Error('无效的默认工作目录。')
  const cwd = value.cwd.trim() || DEFAULT_WORKING_DIRECTORY
  if (!(cwd.startsWith('/') || cwd === '~' || cwd.startsWith('~/') || /^[a-z]:[\\/]/i.test(cwd) || /^\\\\[^\\/]+[\\/][^\\/]+/.test(cwd))) throw new Error('默认工作目录须为绝对路径或 ~/ 开头的路径。')
  return { name: value.name.trim(), endpoint: normalizeEndpoint(value.endpoint), cwd }
}
/** Allowlist fields at every persistence/HTTP boundary; tokens are never returned. */
export function parseProfile(value: unknown): ConnectionProfile {
  const fields = profileFields(value)
  if (!record(value) || typeof value.createdAt !== 'number' || !Number.isFinite(value.createdAt) || value.createdAt < 0) throw new Error('无效的设备创建时间。')
  if (value.credentialId !== undefined && (typeof value.credentialId !== 'string' || !/^[a-f0-9]{64}$/.test(value.credentialId))) throw new Error('无效的保存凭证标识。')
  return { id: profileId(value.id), ...fields, createdAt: value.createdAt, ...(value.credentialId ? { credentialId: value.credentialId as string } : {}) }
}
export function parseProfileSnapshot(value: unknown): ProfileSnapshot {
  if (!record(value) || !Array.isArray(value.profiles) || value.profiles.length > 512 || typeof value.selectedId !== 'string') throw new Error('设备列表响应无效。')
  const profiles = value.profiles.map(parseProfile)
  if (new Set(profiles.map(profile => profile.id)).size !== profiles.length || new Set(profiles.map(profile => profile.endpoint)).size !== profiles.length) throw new Error('设备列表包含重复记录。')
  return { profiles, selectedId: profiles.some(profile => profile.id === value.selectedId) ? value.selectedId : profiles[0]?.id || '' }
}
