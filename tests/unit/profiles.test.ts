import { describe, expect, test } from 'bun:test'
import { normalizeEndpoint, endpointLabel } from '../../shared/endpoint'
import { loadProfiles } from '../../src/lib/profiles'

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

  test('reports corrupted storage without overwriting the original', () => {
    let writes = 0
    const storage = { getItem: () => '{broken', setItem: () => { writes++ } }
    expect(loadProfiles(storage).error).toContain('原始数据未被修改')
    expect(writes).toBe(0)
  })

})
