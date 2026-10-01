import { describe, expect, test } from 'bun:test'
import { normalizeEndpoint, endpointLabel } from '../../shared/endpoint'
import { loadProfiles, saveProfiles, STORAGE_KEY } from '../../src/lib/profiles'

describe('connection records', () => {
  test('normalizes TCP and absolute Unix endpoints', () => {
    expect(normalizeEndpoint(' ws://localhost:4500 ')).toBe('ws://localhost:4500/')
    expect(normalizeEndpoint('wss://host.example/codex')).toBe('wss://host.example/codex')
    expect(normalizeEndpoint('unix:///tmp/codex.sock')).toBe('unix:///tmp/codex.sock')
    expect(endpointLabel('ws://localhost:4500/')).toBe('localhost:4500')
  })
  test('rejects unsafe or unsupported addresses', () => {
    for (const address of ['', 'localhost:4500', 'https://host/', 'file:///etc/passwd', 'ws://user:pass@host', 'wss://host/?token=secret', 'wss://host/#secret', 'unix://remote/path', 'unix:///', 'unix:///tmp/%00sock']) expect(() => normalizeEndpoint(address)).toThrow()
  })
  test('round-trips profile identity without persisting extra secrets', () => {
    const values = new Map<string, string>()
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
    const record = { id: 'a', name: '工作站', endpoint: 'ws://localhost:4500', cwd: '/work', createdAt: 1, token: 'NEVER-PERSIST' }
    saveProfiles(storage, [record], 'a')
    expect(values.get(STORAGE_KEY)).not.toContain('NEVER-PERSIST')
    expect(loadProfiles(storage)).toEqual({ profiles: [{ id: 'a', name: '工作站', endpoint: 'ws://localhost:4500/', cwd: '/work', createdAt: 1 }], selectedId: 'a', error: '' })
  })
  test('reports corrupted storage without overwriting the original', () => {
    let writes = 0
    const storage = { getItem: () => '{broken', setItem: () => { writes++ } }
    expect(loadProfiles(storage).error).toContain('原始数据未被修改')
    expect(writes).toBe(0)
  })
  test('persists only the opaque server credential reference alongside profile metadata', () => {
    let value = ''
    const storage = { getItem: () => value, setItem: (_key: string, next: string) => { value = next } }
    const record = { id: 'a', name: 'Remote', endpoint: 'wss://host', cwd: '', createdAt: 1, credentialId: 'a'.repeat(64), token: 'private-bearer' }
    saveProfiles(storage, [record], 'a')
    expect(value).not.toContain('private-bearer')
    expect(loadProfiles(storage).profiles[0]?.credentialId).toBe(record.credentialId)
    value = value.replace(record.credentialId, '../credentials')
    expect(loadProfiles(storage).error).not.toBe('')
  })
  test('reports storage access denial', () => {
    expect(loadProfiles({ getItem: () => { throw new Error('denied') }, setItem: () => {} }).error).not.toBe('')
  })
})
