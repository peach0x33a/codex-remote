import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CredentialStore } from '../../server/credentials'

const roots: string[] = []
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'codex-remembered-login-'))
  roots.push(root)
  const file = join(root, 'credentials.json')
  return { file, store: new CredentialStore(file) }
}
const session = (id: string, expiresAt = Date.now() + 60_000) => ({ id: id.repeat(64), expiresAt })
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

describe('private remembered login records', () => {
  test('reads a missing store without creating it, and retains private atomic storage', async () => {
    const { file, store } = await fixture()
    expect(await store.rememberedSessions()).toEqual([])
    await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' })
    await store.removeRememberedSession('f'.repeat(64))
    await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' })
    const saved = session('a')
    await store.saveRememberedSession(saved)
    expect(await new CredentialStore(file).rememberedSessions()).toEqual([saved])
    expect((await stat(file)).mode & 0o777).toBe(0o600)
  })

  test('concurrent credential and login writes retain both records across instances', async () => {
    const { file, store } = await fixture(), other = new CredentialStore(file)
    const saved = session('a'), second = session('b')
    const [id] = await Promise.all([
      store.save('wss://example.test/rpc', 'upstream-token'),
      other.saveRememberedSession(saved), store.saveRememberedSession(second),
    ])
    expect(await other.token(id, 'wss://example.test/rpc')).toBe('upstream-token')
    expect(await store.rememberedSessions()).toEqual([saved, second])
    await other.saveRememberedSession(session('c'), saved.id)
    expect((await store.rememberedSessions()).map(entry => entry.id)).toEqual([second.id, 'c'.repeat(64)])
    await store.removeRememberedSession(second.id)
    expect(await other.token(id, 'wss://example.test/rpc')).toBe('upstream-token')
    expect((await store.rememberedSessions()).map(entry => entry.id)).toEqual(['c'.repeat(64)])
  })

  test('filters expired records, prunes on mutation and bounds active records without eviction', async () => {
    const { file, store } = await fixture()
    const active = Array.from({ length: 1024 }, (_, i) => ({ id: i.toString(16).padStart(64, '0'), expiresAt: Date.now() + 60_000 }))
    await writeFile(file, JSON.stringify({ version: 1, credentials: {}, rememberedSessions: active }), { mode: 0o600 })
    const previous = await readFile(file, 'utf8')
    await expect(store.saveRememberedSession(session('f'))).rejects.toMatchObject({ status: 429 })
    expect(await readFile(file, 'utf8')).toBe(previous)
    await store.saveRememberedSession(session('f'), active[0]!.id)
    expect(await store.rememberedSessions()).toHaveLength(1024)
    await writeFile(file, JSON.stringify({ version: 1, credentials: {}, rememberedSessions: [session('a', Date.now() - 1000), session('b')] }))
    expect((await store.rememberedSessions()).map(entry => entry.id)).toEqual(['b'.repeat(64)])
    await store.saveRememberedSession(session('c'))
    expect(JSON.parse(await readFile(file, 'utf8')).rememberedSessions.map((entry: { id: string }) => entry.id)).toEqual(['b'.repeat(64), 'c'.repeat(64)])
  })

  test('rejects malformed session records and unsafe file permissions without overwriting', async () => {
    const { file, store } = await fixture()
    for (const records of [{}, [{ id: 'invalid', expiresAt: Date.now() }], [{ id: 'a'.repeat(64), expiresAt: 'tomorrow' }], [session('a'), session('a')]]) {
      const raw = JSON.stringify({ version: 1, credentials: {}, rememberedSessions: records })
      await writeFile(file, raw, { mode: 0o600 })
      await expect(store.rememberedSessions()).rejects.toMatchObject({ status: 500 })
      await expect(store.saveRememberedSession(session('b'))).rejects.toMatchObject({ status: 500 })
      expect(await readFile(file, 'utf8')).toBe(raw)
    }
    await writeFile(file, JSON.stringify({ version: 1, credentials: {}, rememberedSessions: [] }))
    await chmod(file, 0o644)
    await expect(store.rememberedSessions()).rejects.toMatchObject({ status: 500 })
  })
})
