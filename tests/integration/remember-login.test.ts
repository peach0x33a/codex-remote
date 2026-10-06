import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBridge } from '../../server/bridge'

const origin = 'http://remember-login.test'
const secureOrigin = 'https://remember-login.test'
const accessKey = 'integration-remember-login-password'
const roots: string[] = [], bridges: ReturnType<typeof createBridge>[] = []
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'codex-remember-login-api-'))
  roots.push(root)
  const file = join(root, 'credentials.json')
  function start(password = accessKey) {
    const bridge = createBridge({ host: '127.0.0.1', port: 0, origins: [origin, secureOrigin], accessKey: password, credentialFile: file })
    bridges.push(bridge)
    const base = 'http://127.0.0.1:' + bridge.server.port
    return {
      stop: () => bridge.stop(),
      login: (body: unknown = { key: password, remember: true }, cookie = '', from = origin) => fetch(base + '/api/session', { method: 'POST', headers: { Origin: from, Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      session: (cookie: string) => fetch(base + '/api/session', { headers: { Cookie: cookie } }).then(response => response.json()),
      logout: (cookie: string, from = origin) => fetch(base + '/api/session', { method: 'DELETE', headers: { Origin: from, Cookie: cookie } }),
    }
  }
  return { file, start, app: start() }
}
const cookieFrom = (response: Response) => response.headers.get('set-cookie')!.split(';')[0]!
afterEach(async () => { for (const bridge of bridges.splice(0)) bridge.stop(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

describe('remember password authentication', () => {
  test('remembers an opaque login for 30 days and restores it before the first request after restart', async () => {
    const { file, app, start } = await fixture()
    const response = await app.login(), cookie = cookieFrom(response), token = cookie.split('=')[1]!
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('set-cookie')).toContain('Max-Age=2592000')
    expect(response.headers.get('set-cookie')).toContain('HttpOnly; SameSite=Strict; Path=/')
    expect((await app.session(cookie)).authenticated).toBe(true)
    const raw = await readFile(file, 'utf8'), saved = JSON.parse(raw).rememberedSessions
    expect(raw).not.toContain(accessKey); expect(raw).not.toContain(token)
    expect(saved).toHaveLength(1); expect(saved[0].id).toMatch(/^[a-f0-9]{64}$/)
    expect(saved[0].expiresAt - Date.now()).toBeGreaterThan(29 * 24 * 60 * 60 * 1000)
    expect((await stat(file)).mode & 0o777).toBe(0o600)
    app.stop()
    expect((await start().session(cookie)).authenticated).toBe(true)
  })

  test('omitting or disabling remember uses a browser session cookie and never persists login', async () => {
    const { app, file, start } = await fixture()
    for (const body of [{ key: accessKey }, { key: accessKey, remember: false }]) {
      const response = await app.login(body), cookie = cookieFrom(response)
      expect(response.status).toBe(200)
      expect(response.headers.get('set-cookie')).not.toContain('Max-Age')
      expect(response.headers.get('set-cookie')).not.toContain('Expires')
      expect((await app.session(cookie)).authenticated).toBe(true)
      expect((await start().session(cookie)).authenticated).toBe(false)
    }
    await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  test('logout revokes remembered login durably, clears the cookie and rejects foreign origins', async () => {
    const { app, start, file } = await fixture()
    const cookie = cookieFrom(await app.login())
    expect((await app.logout(cookie, 'https://foreign.test')).status).toBe(403)
    expect((await app.session(cookie)).authenticated).toBe(true)
    const logout = await app.logout(cookie)
    expect(logout.status).toBe(200); expect(logout.headers.get('set-cookie')).toContain('Max-Age=0')
    expect((await app.session(cookie)).authenticated).toBe(false)
    expect(JSON.parse(await readFile(file, 'utf8')).rememberedSessions).toEqual([])
    app.stop(); expect((await start().session(cookie)).authenticated).toBe(false)
  })

  test('a fresh login rotates remembered tokens and turning remember off removes the old record', async () => {
    const { app, start, file } = await fixture()
    const old = cookieFrom(await app.login())
    const next = cookieFrom(await app.login({ key: accessKey, remember: true }, old))
    expect(next).not.toBe(old)
    expect((await app.session(old)).authenticated).toBe(false)
    expect(JSON.parse(await readFile(file, 'utf8')).rememberedSessions).toHaveLength(1)
    app.stop()
    const restarted = start()
    expect((await restarted.session(old)).authenticated).toBe(false)
    expect((await restarted.session(next)).authenticated).toBe(true)
    const short = cookieFrom(await restarted.login({ key: accessKey, remember: false }, next))
    expect((await restarted.session(next)).authenticated).toBe(false)
    expect((await restarted.session(short)).authenticated).toBe(true)
    expect(JSON.parse(await readFile(file, 'utf8')).rememberedSessions).toEqual([])
    restarted.stop(); expect((await start().session(short)).authenticated).toBe(false)
  })

  test('changing the access password invalidates remembered tokens without exposing a password verifier', async () => {
    const { app, start } = await fixture()
    const cookie = cookieFrom(await app.login())
    app.stop()
    const changed = start('new-integration-access-password')
    expect((await changed.session(cookie)).authenticated).toBe(false)
    expect((await changed.login({ key: accessKey, remember: true })).status).toBe(401)
    expect((await changed.login()).status).toBe(200)
  })

  test('HTTPS remembers a Secure cookie and refuses wrong passwords, invalid settings and arbitrary tokens', async () => {
    const { app, file } = await fixture()
    expect((await app.login({ key: accessKey, remember: 'true' })).status).toBe(400)
    const wrong = await app.login({ key: 'wrong', remember: true })
    expect(wrong.status).toBe(401); expect(wrong.headers.get('set-cookie')).toBeNull()
    await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' })
    const login = await app.login({ key: accessKey, remember: true }, '', secureOrigin)
    expect(login.status).toBe(200); expect(login.headers.get('set-cookie')).toContain('; Secure')
    expect((await app.session('codex_remote_session=' + 'f'.repeat(64))).authenticated).toBe(false)
  })

  test('expired remembered cookies fail authentication, and logout still clears them', async () => {
    const { app, start, file } = await fixture()
    const cookie = cookieFrom(await app.login()), saved = JSON.parse(await readFile(file, 'utf8'))
    saved.rememberedSessions[0].expiresAt = Date.now() - 1000
    await writeFile(file, JSON.stringify(saved))
    app.stop()
    const restarted = start()
    expect((await restarted.session(cookie)).authenticated).toBe(false)
    expect((await restarted.logout(cookie)).status).toBe(200)
    expect(JSON.parse(await readFile(file, 'utf8')).rememberedSessions).toEqual([])
  })

  test('failed persistence never issues a remembered cookie and failed logout can be retried', async () => {
    const { app, start, file } = await fixture()
    const failing = spyOn(fs, 'rename').mockRejectedValue(new Error('synthetic write failure'))
    try {
      const failed = await app.login()
      expect(failed.status).toBe(500); expect(failed.headers.get('set-cookie')).toBeNull()
      expect(await failed.json()).toEqual({ error: '无法保存登录状态，请检查服务器凭证存储配置后重试，或关闭“记住密码”。' })
      expect((await app.login({ key: accessKey, remember: false })).status).toBe(200)
    } finally { failing.mockRestore() }
    const cookie = cookieFrom(await app.login()), before = await readFile(file, 'utf8')
    const failingLogout = spyOn(fs, 'rename').mockRejectedValue(new Error('synthetic write failure'))
    try {
      const response = await app.logout(cookie)
      expect(response.status).toBe(500); expect(response.headers.get('set-cookie')).toBeNull()
      expect(await readFile(file, 'utf8')).toBe(before)
      expect((await app.session(cookie)).authenticated).toBe(true)
    } finally { failingLogout.mockRestore() }
    expect((await app.logout(cookie)).status).toBe(200)
    app.stop(); expect((await start().session(cookie)).authenticated).toBe(false)
  })
})
