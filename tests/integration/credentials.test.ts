import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createBridge } from '../../server/bridge'
import { INPUT_HISTORY_BODY_LIMIT } from '../../shared/input-history'

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

async function saved(app: ReturnType<typeof harness>, token = 'saved-bearer-secret', target = endpoint) {
  const response = await app.api('POST', '/api/credentials', { endpoint: target, token })
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  const body = await response.json()
  expect(Object.keys(body)).toEqual(['credentialId'])
  expect(body.credentialId).toMatch(/^[a-f0-9]{64}$/)
  expect(JSON.stringify(body)).not.toContain(token)
  return body.credentialId as string
}

async function upgraded(app: ReturnType<typeof harness>, body: unknown, expectedToken: string, target = endpoint) {
  const response = await app.api('POST', '/api/connect', body)
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  const data = await response.json()
  expect(Object.keys(data)).toEqual(['ticket'])
  expect(data.ticket).toMatch(/^[a-f0-9]{64}$/)
  if (expectedToken) expect(JSON.stringify(data)).not.toContain(expectedToken)
  expect(await app.send('GET', '/api/socket?ticket=' + data.ticket)).toBeUndefined()
  expect(app.upgrades.at(-1)?.ticket.token).toBe(expectedToken)
  expect(app.upgrades.at(-1)?.ticket.endpoint).toBe(target)
  expect((await app.api('GET', '/api/socket?ticket=' + data.ticket)).status).toBe(401)
}

describe('server-only credential API without network', () => {
  test('persists privately and resolves only the stored token into one-use server tickets', async () => {
    const app = await fixture()
    await app.login()
    const id = await saved(app, 'server-only-token', ' WSS://DAEMON.EXAMPLE:443/rpc ')
    expect(app.handler.maxRequestBodySize).toBe(INPUT_HISTORY_BODY_LIMIT)
    expect((await stat(app.file)).mode & 0o777).toBe(0o600)
    expect((await stat(dirname(app.file))).mode & 0o777).toBe(0o700)
    await upgraded(app, { endpoint, credentialId: id, token: 'must-not-be-used' }, 'server-only-token')
    await upgraded(app, { endpoint, credentialId: id, token: null }, 'server-only-token')
    expect((await app.api('GET', '/api/credentials')).status).toBe(404)
  })

  test('survives bridge restart, rotates the existing ID and persistently deletes idempotently', async () => {
    const first = await fixture()
    const session = await first.login()
    const id = await saved(first, 'first-secret')
    first.app.stop()
    const second = harness(first.file)
    expect((await second.api('POST', '/api/connect', { endpoint, credentialId: id }, { cookie: session })).status).toBe(401)
    await second.login()
    await upgraded(second, { endpoint, credentialId: id }, 'first-secret')
    const update = await second.api('POST', '/api/credentials', { endpoint, token: 'rotated-secret', credentialId: id })
    expect(update.status).toBe(200)
    expect(await update.json()).toEqual({ credentialId: id })
    second.app.stop()
    const third = harness(first.file)
    await third.login()
    await upgraded(third, { endpoint, credentialId: id }, 'rotated-secret')
    for (let i = 0; i < 2; i++) {
      const response = await third.api('DELETE', '/api/credentials', { credentialId: id })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ ok: true })
      expect(response.headers.get('cache-control')).toBe('no-store')
    }
    third.app.stop()
    const fourth = harness(first.file)
    await fourth.login()
    expect((await fourth.api('POST', '/api/connect', { endpoint, credentialId: id, token: 'no-fallback' })).status).toBe(404)
    const failedUpdate = await fourth.api('POST', '/api/credentials', { endpoint, token: 'cannot-recreate', credentialId: id })
    expect(failedUpdate.status).toBe(404)
    expect(JSON.parse(await readFile(first.file, 'utf8')).credentials).toEqual({})
  })

  test('rejects unknown IDs and exact endpoint mismatches without falling back to the body token', async () => {
    const app = await fixture()
    await app.login()
    const id = await saved(app)
    for (const wrong of ['ws://daemon.example/rpc', 'wss://daemon.example:444/rpc', 'wss://daemon.example/rpc/', 'wss://other.example/rpc']) {
      expect((await app.api('POST', '/api/connect', { endpoint: wrong, credentialId: id, token: 'no-fallback' })).status).toBe(400)
    }
    expect((await app.api('POST', '/api/connect', { endpoint, credentialId: unknownId, token: 'no-fallback' })).status).toBe(404)
    expect((await app.api('POST', '/api/credentials', { endpoint, token: 'unknown-update', credentialId: unknownId })).status).toBe(404)
    const removed = await app.api('DELETE', '/api/credentials', { credentialId: unknownId })
    expect(removed.status).toBe(200)
    expect(await removed.json()).toEqual({ ok: true })
    await upgraded(app, { endpoint: ' WSS://DAEMON.EXAMPLE:443/rpc ', credentialId: id }, 'saved-bearer-secret')
  })

  test('an explicit save can rebind an existing ID, and the old endpoint then fails', async () => {
    const app = await fixture()
    await app.login()
    const id = await saved(app)
    const target = 'wss://replacement.example/new-path'
    const response = await app.api('POST', '/api/credentials', { endpoint: target, token: 'replacement-secret', credentialId: id })
    expect(await response.json()).toEqual({ credentialId: id })
    expect((await app.api('POST', '/api/connect', { endpoint, credentialId: id })).status).toBe(400)
    await upgraded(app, { endpoint: target, credentialId: id }, 'replacement-secret', target)
  })

  test('normalization can expand a valid Unicode endpoint without corrupting the store', async () => {
    const app = await fixture()
    await app.login()
    const target = 'wss://daemon.example/' + '界'.repeat(700)
    expect(target.length).toBeLessThan(2048)
    const normalized = new URL(target).toString()
    expect(normalized.length).toBeGreaterThan(2048)
    const id = await saved(app, 'unicode-secret', target)
    app.app.stop()
    const restarted = harness(app.file)
    await restarted.login()
    await upgraded(restarted, { endpoint: target, credentialId: id }, 'unicode-secret', normalized)
    const other = await saved(restarted)
    await upgraded(restarted, { endpoint, credentialId: other }, 'saved-bearer-secret')
  })

  test('preserves legacy manual tokens and optional empty tokens without creating a store', async () => {
    const app = await fixture()
    await app.login()
    await upgraded(app, { endpoint, token: '  manual-secret  ' }, 'manual-secret')
    await upgraded(app, { endpoint, token: '' }, '')
    await upgraded(app, { endpoint }, '')
    await expect(lstat(dirname(app.file))).rejects.toMatchObject({ code: 'ENOENT' })
    const id = await saved(app)
    // A broken credential file cannot interfere with legacy manual-token connects.
    await writeFile(app.file, 'broken-store')
    await upgraded(app, { endpoint, token: 'still-manual' }, 'still-manual')
    expect((await app.api('POST', '/api/connect', { endpoint, credentialId: id })).status).toBe(500)
  })

  test('requires the existing session and same-origin guards for save, delete and connect', async () => {
    const app = await fixture()
    await app.login()
    const id = await saved(app, 'guarded-secret')
    const operations = [
      ['POST', '/api/credentials', { endpoint, token: 'unauthorized-secret', credentialId: id }],
      ['DELETE', '/api/credentials', { credentialId: id }],
      ['POST', '/api/connect', { endpoint, credentialId: id }],
    ] as const
    const original = await readFile(app.file, 'utf8')
    for (const [method, path, body] of operations) {
      expect((await app.api(method, path, body, { cookie: '' })).status).toBe(401)
      expect((await app.api(method, path, body, { cookie: 'codex_remote_session=forged' })).status).toBe(401)
      expect((await app.api(method, path, body, { from: 'https://attacker.example' })).status).toBe(403)
      expect((await app.api(method, path, body, { from: null })).status).toBe(403)
    }
    expect(await readFile(app.file, 'utf8')).toBe(original)
    await app.api('DELETE', '/api/session')
    for (const [method, path, body] of operations) expect((await app.api(method, path, body)).status).toBe(401)
  })

  test('retains the existing optional-access-key deployment behavior', async () => {
    const app = await fixture({ accessKey: '' })
    const id = await saved(app)
    await upgraded(app, { endpoint, credentialId: id }, 'saved-bearer-secret')
    expect((await app.api('DELETE', '/api/credentials', { credentialId: id }, { from: 'https://attacker.example' })).status).toBe(403)
  })

  test('applies host and Unix policies on save, update and use after a policy change', async () => {
    const unrestricted = await fixture()
    await unrestricted.login()
    const id = await saved(unrestricted, 'policy-secret')
    const unixId = await saved(unrestricted, 'unix-secret', 'unix:///tmp/daemon.sock')
    unrestricted.app.stop()
    const restricted = harness(unrestricted.file, { allowedHosts: ['allowed.example'], allowUnix: false })
    await restricted.login()
    for (const [target, credentialId] of [[endpoint, id], ['unix:///tmp/daemon.sock', unixId]]) {
      expect((await restricted.api('POST', '/api/connect', { endpoint: target, credentialId })).status).toBe(400)
      expect((await restricted.api('POST', '/api/credentials', { endpoint: target, token: 'blocked-secret' })).status).toBe(400)
      expect((await restricted.api('POST', '/api/credentials', { endpoint: target, token: 'blocked-secret', credentialId })).status).toBe(400)
    }
    const allowed = await saved(restricted, 'allowed-secret', 'wss://allowed.example/rpc')
    await upgraded(restricted, { endpoint: 'wss://allowed.example/rpc', credentialId: allowed }, 'allowed-secret', 'wss://allowed.example/rpc')
    expect((await restricted.api('DELETE', '/api/credentials', { credentialId: unixId })).status).toBe(200)
  })

  test('validates token types, lengths and newlines on save and legacy connect', async () => {
    const app = await fixture()
    await app.login()
    for (const token of [null, 42, {}, [], 'bad\rsecret', 'bad\nsecret', 'x'.repeat(8193)]) {
      for (const path of ['/api/credentials', '/api/connect']) {
        const response = await app.api('POST', path, { endpoint, token })
        expect(response.status).toBe(400)
        const raw = await response.text()
        expect(raw).not.toContain('secret')
        expect(raw).not.toContain('x'.repeat(100))
      }
    }
    expect((await app.api('POST', '/api/credentials', { endpoint })).status).toBe(400)
    const token = 'x'.repeat(8192)
    const id = await saved(app, token)
    await upgraded(app, { endpoint, credentialId: id }, token)
    await upgraded(app, { endpoint, token }, token)
    const empty = await app.api('POST', '/api/credentials', { endpoint, token: '' })
    expect(empty.status).toBe(200)
    await upgraded(app, { endpoint, credentialId: (await empty.json()).credentialId }, '')
  })

  test('rejects malformed IDs, endpoints and bodies with fixed, secret-free errors', async () => {
    const app = await fixture()
    await app.login()
    for (const credentialId of [null, 42, {}, [], '', 'a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), '../secret']) {
      for (const [method, path] of [['POST', '/api/credentials'], ['DELETE', '/api/credentials'], ['POST', '/api/connect']]) {
        expect((await app.api(method!, path!, { endpoint, token: 'private-secret', credentialId })).status).toBe(400)
      }
    }
    expect((await app.api('DELETE', '/api/credentials', {})).status).toBe(400)
    for (const target of [null, 7, '', 'https://host', 'wss://user:private-secret@host', 'wss://host/?token=private-secret', 'wss://host/#private-secret', 'wss://host/' + 'x'.repeat(2048)]) {
      for (const path of ['/api/credentials', '/api/connect']) {
        const response = await app.api('POST', path, { endpoint: target, token: 'private-secret' })
        expect(response.status).toBe(400)
        expect(await response.text()).not.toContain('private-secret')
      }
    }
    for (const [method, path] of [['POST', '/api/credentials'], ['DELETE', '/api/credentials'], ['POST', '/api/connect']]) {
      for (const raw of ['null', '[]', '42', '{}', '{ invalid-private-secret']) {
        const response = await app.api(method!, path!, undefined, { raw })
        expect(response.status).toBe(400)
        expect(await response.text()).not.toContain('invalid-private-secret')
      }
    }
    await expect(lstat(app.file)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  test('enforces JSON content type and the body byte limit even in the mocked handler', async () => {
    const app = await fixture()
    await app.login()
    for (const [method, path] of [['POST', '/api/credentials'], ['DELETE', '/api/credentials'], ['POST', '/api/connect']]) {
      for (const contentType of [null, 'text/plain']) expect((await app.api(method!, path!, { endpoint, token: 'private-secret' }, { contentType })).status).toBe(415)
      const oversized = await app.api(method!, path!, { endpoint, token: 'private-secret', padding: '字'.repeat(6000) })
      expect(oversized.status).toBe(413)
      expect(await oversized.text()).not.toContain('private-secret')
      expect((await app.api(method!, path!, {}, { headers: { 'Content-Length': String(16 * 1024 + 1) } })).status).toBe(413)
    }
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(8192)); controller.enqueue(new Uint8Array(8193)) },
      cancel() { cancelled = true },
    })
    const response = await app.handle(new Request(origin + '/api/credentials', {
      method: 'POST', headers: { Origin: origin, Cookie: await app.login(), 'Content-Type': 'application/json' }, body: stream,
    }))
    expect(response?.status).toBe(413)
    expect(cancelled).toBe(true)
    await expect(lstat(app.file)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  test('returns sanitized storage errors instead of reporting unsaved credentials as successful', async () => {
    const app = await fixture()
    await app.login()
    const id = await saved(app)
    await chmod(app.file, 0o644)
    const response = await app.api('POST', '/api/credentials', { endpoint, token: 'unsaved-secret', credentialId: id })
    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain('unsaved-secret')
    await chmod(app.file, 0o600)
    await writeFile(app.file, '{ invalid-storage-secret')
    for (const [method, path] of [['POST', '/api/credentials'], ['DELETE', '/api/credentials'], ['POST', '/api/connect']]) {
      const response = await app.api(method!, path!, { endpoint, token: 'request-secret', credentialId: id })
      expect(response.status).toBe(500)
      const raw = await response.text()
      for (const secret of ['invalid-storage-secret', 'request-secret', app.file]) expect(raw).not.toContain(secret)
      expect(response.headers.get('cache-control')).toBe('no-store')
    }
  })

  test('rejects symlinked storage through the API and refuses storage in the static directory', async () => {
    const app = await fixture()
    await app.login()
    await mkdir(dirname(app.file), { mode: 0o700 })
    const target = join(app.root, 'target')
    await writeFile(target, 'outside-secret', { mode: 0o600 })
    await symlink(target, app.file)
    const response = await app.api('POST', '/api/credentials', { endpoint, token: 'request-secret' })
    expect(response.status).toBe(500)
    const raw = await response.text()
    expect(raw).not.toContain('request-secret')
    expect(raw).not.toContain(target)
    expect(await readFile(target, 'utf8')).toBe('outside-secret')
    expect(() => harness(join(app.root, 'assets', 'credentials.json'), { staticDir: join(app.root, 'assets') })).toThrow('凭证文件必须位于静态资源目录之外。')
  })
})
