import type { ConnectionProfile } from '../../shared/protocol'
import { normalizeEndpoint } from '../../shared/endpoint'

export const STORAGE_KEY = 'codex-remote.connections.v1'
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>
export function loadProfiles(storage: StorageLike): { profiles: ConnectionProfile[]; selectedId: string; error: string } {
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return { profiles: [], selectedId: '', error: '' }
    const data = JSON.parse(raw)
    if (data.version !== 1 || !Array.isArray(data.profiles)) throw new Error('invalid')
    const profiles: ConnectionProfile[] = data.profiles.map((p: ConnectionProfile) => {
      if (!p || typeof p.id !== 'string' || typeof p.name !== 'string' || !p.name.trim() || typeof p.endpoint !== 'string' || typeof p.cwd !== 'string' || typeof p.createdAt !== 'number') throw new Error('invalid')
      if (p.credentialId !== undefined && (typeof p.credentialId !== 'string' || !/^[a-f0-9]{64}$/.test(p.credentialId))) throw new Error('invalid credential reference')
      return { id: p.id, name: p.name, endpoint: normalizeEndpoint(p.endpoint), cwd: p.cwd, createdAt: p.createdAt, ...(p.credentialId ? { credentialId: p.credentialId } : {}) }
    })
    if (new Set(profiles.map(p => p.id)).size !== profiles.length) throw new Error('duplicate')
    return { profiles, selectedId: profiles.some(p => p.id === data.selectedId) ? data.selectedId : profiles[0]?.id || '', error: '' }
  } catch { return { profiles: [], selectedId: '', error: '无法读取本机保存的连接。原始数据未被修改；请检查浏览器存储设置。' } }
}
export function saveProfiles(storage: StorageLike, profiles: ConnectionProfile[], selectedId: string) {
  // Deliberately serialize an allowlist: never persist transport tokens or chats.
  storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, selectedId, profiles: profiles.map(p => ({
    id: p.id, name: p.name, endpoint: normalizeEndpoint(p.endpoint), cwd: p.cwd, createdAt: p.createdAt, ...(p.credentialId ? { credentialId: p.credentialId } : {}),
  })) }))
}
