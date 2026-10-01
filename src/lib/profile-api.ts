import type { ConnectionProfile } from '../../shared/protocol'
import { parseProfile, parseProfileSnapshot, type ProfileInput, type ProfileSnapshot } from '../../shared/profiles'

export class ProfileApiError extends Error { constructor(message: string, readonly status: number) { super(message) } }

async function request(method: string, body?: object): Promise<unknown> {
  let response: Response
  try {
    response = await fetch('/api/profiles', { method, credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-Codex-Remote': '1' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10_000) })
  } catch { throw new Error('设备配置未同步，请检查 Bun 服务后重试。') }
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    if (response.status === 404 && (!data?.error || /^(接口不存在[。.]?|not found[.]?)$/i.test(data.error))) throw new Error('当前 Bun 后端未提供设备配置接口（/api/profiles）。请更新并重启 Bun 后端后重试。')
    throw new ProfileApiError(typeof data?.error === 'string' ? data.error : '设备配置未同步，请重试。', response.status)
  }
  return data
}
export async function fetchProfiles(): Promise<ProfileSnapshot> { return parseProfileSnapshot(await request('GET')) }
export async function saveServerProfile(input: ProfileInput): Promise<ProfileSnapshot & { profile: ConnectionProfile }> {
  const data = await request('POST', input)
  const snapshot = parseProfileSnapshot(data)
  const profile = parseProfile((data as { profile?: unknown }).profile)
  if (!snapshot.profiles.some(item => JSON.stringify(item) === JSON.stringify(profile))) throw new Error('保存设备的响应无效。')
  return { ...snapshot, profile }
}
export async function importServerProfile(profile: ConnectionProfile): Promise<ProfileSnapshot> { return parseProfileSnapshot(await request('POST', { ...profile, action: 'import' })) }
export async function removeServerProfile(id: string): Promise<ProfileSnapshot> { return parseProfileSnapshot(await request('DELETE', { id })) }
export async function selectServerProfile(selectedId: string): Promise<void> { parseProfileSnapshot(await request('PATCH', { selectedId })) }
