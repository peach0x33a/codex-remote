import { afterEach, expect, test } from 'bun:test'
import { fetchProfiles, saveServerProfile } from '../../src/lib/profile-api'

const original = globalThis.fetch
afterEach(() => { globalThis.fetch = original })
test('requests shared profiles without caching and supplies the LAN HTTP origin guard', async () => {
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    expect(url).toBe('/api/profiles')
    expect(init?.method).toBe('GET'); expect(init?.credentials).toBe('same-origin'); expect(init?.cache).toBe('no-store')
    expect(new Headers(init?.headers).get('X-Codex-Remote')).toBe('1')
    return Response.json({ profiles: [], selectedId: '' })
  }) as unknown as typeof fetch
  expect(await fetchProfiles()).toEqual({ profiles: [], selectedId: '' })
})
test('reports an old bridge instead of falling back to browser persistence', async () => {
  globalThis.fetch = (async () => Response.json({ error: '接口不存在。' }, { status: 404 })) as unknown as typeof fetch
  await expect(fetchProfiles()).rejects.toThrow('请更新并重启 Bun 后端')
})
test('rejects malformed save responses instead of reporting a saved device', async () => {
  globalThis.fetch = (async () => Response.json({ profiles: [], selectedId: '', profile: { token: 'must-not-persist' } })) as unknown as typeof fetch
  await expect(saveServerProfile({ name: 'A', endpoint: 'ws://localhost:4500', cwd: '', token: '' })).rejects.toThrow()
})
