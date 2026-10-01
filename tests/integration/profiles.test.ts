import * as fs from 'node:fs/promises'
import { CredentialStore } from '../../server/credentials'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createBridge } from '../../server/bridge'

const origin = 'https://app.example'
const accessKey = 'credentials-test-access-key'
const endpoint = 'wss://daemon.example/rpc'
const unknownId = 'f'.repeat(64)
const roots: string[] = []
const apps: ReturnType<typeof createBridge>[] = []
type Upgrade = { ticket: { endpoint: string; token: string; session: string; expires: number } }
type FakeServer = { port: number; requestIP(): { address: string }; stop(): void; upgrade(request: Request, options: { data: Upgrade }): boolean }
type Handler = { maxRequestBodySize: number; fetch(request: Request, server: FakeServer): Promise<Response | undefined> }
type RequestOptions = { cookie?: string; from?: string | null; contentType?: string | null; raw?: string; headers?: Record<string, string> }

// Capture the real handler. No listener, browser, fetch(), or upstream WebSocket
// is ever started; upgrades expose only server-internal state to these tests.
function harness(file: string, extra: Partial<Parameters<typeof createBridge>[0]> = {}) {
  let handler!: Handler
  let session = ''
  const upgrades: Upgrade[] = []
  const server: FakeServer = {
    port: 0, requestIP: () => ({ address: 'test-client' }), stop() {},
    upgrade(_request, options) { upgrades.push(options.data); return true },
  }
  const serve = spyOn(Bun, 'serve').mockImplementation(((options: Handler) => { handler = options; return server }) as unknown as typeof Bun.serve)
  let app: ReturnType<typeof createBridge>
  try {
    app = createBridge({ port: 0, origins: [origin], accessKey, credentialFile: file, ...extra })
    apps.push(app)
  } finally { serve.mockRestore() }
  const handle = (request: Request) => handler.fetch(request, server)
  const send = (method: string, path: string, body?: unknown, options: RequestOptions = {}) => {
    const headers = new Headers({ Cookie: options.cookie ?? session, ...options.headers })
    if (options.from !== null) headers.set('Origin', options.from ?? origin)
    if (options.contentType !== null) headers.set('Content-Type', options.contentType ?? 'application/json')
    return handle(new Request(origin + path, { method, headers, ...(method === 'GET' ? {} : { body: options.raw ?? JSON.stringify(body) }) }))
  }
  const api = async (method: string, path: string, body?: unknown, options?: RequestOptions) => {
    const response = await send(method, path, body, options)
    if (!response) throw new Error('Expected an HTTP response')
    return response
  }
  const login = async () => {
    const response = await api('POST', '/api/session', { key: accessKey })
    expect(response.status).toBe(200)
    session = response.headers.get('set-cookie')!.split(';')[0]!
    return session
  }
  return { app, handler, upgrades, handle, send, api, login }
}

async function fixture(extra: Partial<Parameters<typeof createBridge>[0]> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'codex-credentials-api-'))
  roots.push(root)
  const file = join(root, 'private', 'credentials.json')
  return { root, file, ...harness(file, extra) }
}

afterEach(async () => {
  for (const app of apps.splice(0)) app.stop()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('shared server device profiles', () => {
  const details = { name: 'Workstation', endpoint, cwd: '', token: 'server-secret', rememberToken: true }
  async function save(app: ReturnType<typeof harness>, input: object = details) {
    const response = await app.api('POST', '/api/profiles', input)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    return response.json()
  }
  test('protects list and mutations with session, origin and JSON checks', async () => {
    const app = await fixture()
    expect((await app.api('GET', '/api/profiles')).status).toBe(401)
    await app.login()
    expect((await app.api('GET', '/api/profiles', undefined, { from: 'https://evil.example' })).status).toBe(403)
    expect((await app.api('GET', '/api/profiles', undefined, { from: null })).status).toBe(403)
    expect((await app.api('GET', '/api/profiles', undefined, { from: null, contentType: null, headers: { 'sec-fetch-site': 'same-origin' } })).status).toBe(200)
    expect((await app.api('GET', '/api/profiles', undefined, { from: 'https://evil.example', headers: { 'sec-fetch-site': 'same-origin' } })).status).toBe(403)
    expect((await app.api('GET', '/api/profiles', undefined, { from: null, headers: { 'x-codex-remote': '1' } })).status).toBe(200)
    expect((await app.api('GET', '/api/profiles', undefined, { from: null, headers: { 'x-codex-remote': '1', 'sec-fetch-site': 'cross-site' } })).status).toBe(403)
    expect((await app.api('OPTIONS', '/api/profiles', undefined, { from: 'https://evil.example', headers: { 'Access-Control-Request-Headers': 'x-codex-remote' } })).status).toBe(403)
    expect((await app.api('POST', '/api/profiles', details, { contentType: 'text/plain' })).status).toBe(415)
    expect((await app.api('DELETE', '/api/profiles', {}, { contentType: null })).status).toBe(415)
    expect((await app.api('POST', '/api/profiles', {}, { raw: '{' })).status).toBe(400)
  })
  test('shares devices between independent clients, survives restart, and never returns tokens', async () => {
    const app = await fixture(); await app.login()
    const saved = await save(app), profile = saved.profile
    expect(profile.cwd).toBe('~/codex-remote')
    expect(profile.id).toMatch(/^[a-f0-9-]{36}$/)
    expect(JSON.stringify(saved)).not.toContain(details.token)
    const second = harness(app.file); await second.login()
    expect(await (await second.api('GET', '/api/profiles')).json()).toEqual({ profiles: [profile], selectedId: profile.id })
    expect(JSON.parse(await readFile(app.file, 'utf8')).version).toBe(2)
    expect((await stat(app.file)).mode & 0o777).toBe(0o600)
    expect(await new CredentialStore(app.file).token(profile.credentialId, endpoint)).toBe(details.token)
    const renamed = await save(second, { ...details, id: profile.id, name: 'Shared name', token: '' })
    expect(renamed.profile.credentialId).toBe(profile.credentialId)
    expect((await (await app.api('GET', '/api/profiles')).json()).profiles[0].name).toBe('Shared name')
    const restarted = harness(app.file); await restarted.login()
    expect((await (await restarted.api('GET', '/api/profiles')).json()).profiles).toEqual(renamed.profiles)
    const temporary = await save(second, { ...details, id: profile.id, rememberToken: false })
    expect(temporary.profile.credentialId).toBeUndefined()
    expect(JSON.parse(await readFile(app.file, 'utf8')).credentials).toEqual({})
  })
  test('commits credential rotation and deletion atomically with device metadata', async () => {
    const app = await fixture(); await app.login()
    const initial = await save(app), id = initial.profile.id, original = await readFile(app.file, 'utf8')
    const failure = spyOn(fs, 'rename').mockRejectedValue(new Error('synthetic failure'))
    try {
      expect((await app.api('POST', '/api/profiles', { ...details, id, token: 'replacement-secret', name: 'Changed' })).status).toBe(500)
      expect(await readFile(app.file, 'utf8')).toBe(original)
      expect((await app.api('DELETE', '/api/profiles', { id })).status).toBe(500)
      expect(await readFile(app.file, 'utf8')).toBe(original)
    } finally { failure.mockRestore() }
    const replacement = await save(app, { ...details, id, token: 'replacement-secret' })
    expect(replacement.profile.credentialId).not.toBe(initial.profile.credentialId)
    const disk = JSON.parse(await readFile(app.file, 'utf8'))
    expect(Object.keys(disk.credentials)).toEqual([replacement.profile.credentialId])
    expect((await app.api('DELETE', '/api/credentials', { credentialId: replacement.profile.credentialId })).status).toBe(409)
    expect((await app.api('DELETE', '/api/profiles', { id })).status).toBe(200)
    expect(JSON.parse(await readFile(app.file, 'utf8')).credentials).toEqual({})
    expect(await (await app.api('GET', '/api/profiles')).json()).toEqual({ profiles: [], selectedId: '' })
  })
  test('merges concurrent per-device changes without replacing other clients records', async () => {
    const app = await fixture(); await app.login()
    const second = harness(app.file); await second.login()
    const records = await Promise.all(Array.from({ length: 16 }, (_, i) => save(i % 2 ? app : second, { ...details, name: 'Device ' + i, endpoint: 'wss://device-' + i + '.example', token: '' })))
    const profiles = (await (await app.api('GET', '/api/profiles')).json()).profiles
    expect(profiles).toHaveLength(16)
    expect(new Set(profiles.map((p: { id: string }) => p.id)).size).toBe(16)
    await Promise.all(records.map((entry, i) => save(i % 2 ? app : second, { ...entry.profile, token: '', name: 'Renamed ' + i })))
    expect((await (await second.api('GET', '/api/profiles')).json()).profiles.every((p: { name: string }) => p.name.startsWith('Renamed '))).toBe(true)
    expect((await app.api('POST', '/api/profiles', { ...details, endpoint: profiles[0].endpoint })).status).toBe(409)
    await app.api('DELETE', '/api/profiles', { id: profiles[0].id })
    expect((await second.api('POST', '/api/profiles', { ...profiles[0], token: '' })).status).toBe(404)
  })
  test('imports existing browser records idempotently and preserves server edits and credentials', async () => {
    const app = await fixture(); await app.login()
    const credential = await (await app.api('POST', '/api/credentials', { endpoint, token: 'legacy-secret' })).json()
    const legacy = { id: 'legacy', name: 'Old browser', endpoint, cwd: '', createdAt: 123, ...credential, action: 'import' }
    const imported = await save(app, legacy)
    expect(imported.profile).toMatchObject({ id: 'legacy', createdAt: 123, cwd: '~/codex-remote', credentialId: credential.credentialId })
    const edited = await save(app, { ...details, id: 'legacy', name: 'New server name', token: '' })
    const repeated = await save(app, { ...legacy, id: 'other-browser-id' })
    expect(repeated.profiles).toEqual(edited.profiles)
    expect(repeated.profiles).toHaveLength(1)
    expect((await app.api('POST', '/api/profiles', { ...legacy, endpoint: 'wss://other.example' })).status).toBe(400)
    expect(await new CredentialStore(app.file).token(credential.credentialId, endpoint)).toBe('legacy-secret')
  })
  test('persists the selected default and applies endpoint restrictions to profiles too', async () => {
    const app = await fixture({ allowedHosts: ['daemon.example'], allowUnix: false }); await app.login()
    const saved = await save(app)
    expect((await app.api('PATCH', '/api/profiles', { selectedId: saved.profile.id })).status).toBe(200)
    expect((await app.api('PATCH', '/api/profiles', { selectedId: 'missing' })).status).toBe(404)
    expect((await app.api('POST', '/api/profiles', { ...details, endpoint: 'unix:///tmp/codex.sock' })).status).toBe(400)
    expect((await app.api('POST', '/api/profiles', { ...details, endpoint: 'wss://forbidden.example' })).status).toBe(400)
    for (const invalid of [{ name: '' }, { name: 'x'.repeat(49) }, { cwd: 'relative/path' }, { cwd: '/bad\npath' }, { rememberToken: 'yes' }, { token: 'bad\nvalue' }]) {
      expect((await app.api('POST', '/api/profiles', { ...details, ...invalid })).status).toBe(400)
    }
  })
})
