import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CredentialStore } from '../../server/credentials'
import { createBridge } from '../../server/bridge'
import { parseHistoryInput } from '../../shared/input-history'
import { messageParts, toInputs, type PromptPart } from '../../src/lib/prompt'

const roots: string[] = []
const origin = 'http://history.test', secret = 'history-test-access-key'
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'codex-history-')); roots.push(root)
  const file = join(root, 'state.json'), store = new CredentialStore(file)
  const { profile } = await store.saveProfile({ name: 'history device', endpoint: 'ws://localhost:9999', cwd: '', token: 'private-daemon-token', rememberToken: true })
  return { file, store, profile }
}

test('shares durable bounded device input history across instances without losing credentials or attachments', async () => {
  const { file, store, profile } = await fixture(), second = new CredentialStore(file)
  const other = (await store.saveProfile({ name: 'other device', endpoint: 'ws://localhost:9998', cwd: '', token: '' })).profile
  const text = '中😀\n'.repeat(400) + '  \n'
  const parts: PromptPart[] = [{ type: 'text', text, pasteId: 'paste' }, { type: 'image', id: 'img', name: 'x.png', size: 4, url: 'data:image/png;base64,abcd' }, { type: 'skill', id: 'skill', name: 'audit', path: '/skills/audit.md' }]
  const input = toInputs(parts)
  await Promise.all([
    ...Array.from({ length: 103 }, (_, i) => (i % 2 ? store : second).rememberInput({ deviceId: profile.id, id: 'input-' + i, input: [{ type: 'text', text: String(i) }] })),
    second.rememberInput({ deviceId: other.id, id: 'other', input }),
  ])
  const entries = await second.inputHistory(profile.id)
  expect(entries).toHaveLength(100); expect(entries[0]!.id).toBe('input-3'); expect(entries.at(-1)!.id).toBe('input-102')
  await store.rememberInput({ deviceId: profile.id, id: 'mixed', input })
  expect((await new CredentialStore(file).inputHistory(profile.id)).at(-1)!.input).toEqual(input)
  expect(toInputs(messageParts(input))).toEqual(input)
  await second.rememberInput({ deviceId: profile.id, id: 'mixed', input })
  expect(await second.inputHistory(profile.id)).toHaveLength(100)
  await expect(second.rememberInput({ deviceId: profile.id, id: 'mixed', input: [{ type: 'text', text: 'changed' }] })).rejects.toMatchObject({ status: 409 })
  expect(await store.token(profile.credentialId!, profile.endpoint)).toBe('private-daemon-token')
  expect((await stat(file)).mode & 0o777).toBe(0o600)
  await second.removeProfile(profile.id)
  expect(JSON.parse(await readFile(file, 'utf8')).inputHistory.every((entry: any) => entry.deviceId === other.id)).toBe(true)
  expect((await store.inputHistory(other.id))[0]!.input).toEqual(input)
})

test('authenticates history access, rejects cross-origin/invalid input, and reloads after bridge restart', async () => {
  const { file, profile } = await fixture()
  const options = { port: 0, origins: [origin], accessKey: secret, credentialFile: file }
  let bridge = createBridge(options), base = 'http://127.0.0.1:' + bridge.server.port
  const post = (path: string, body: unknown, cookie = '', from = origin) => fetch(base + path, { method: 'POST', headers: { Origin: from, Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  try {
    const path = '/api/input-history?deviceId=' + profile.id
    expect((await fetch(base + path, { headers: { Origin: origin } })).status).toBe(401)
    const login = await post('/api/session', { key: secret }), cookie = login.headers.get('set-cookie')!.split(';')[0]!
    const input = [{ type: 'text', text: 'long text '.repeat(4000), text_elements: [] }], body = { deviceId: profile.id, id: 'durable', input }
    expect((await post('/api/input-history', body, cookie, 'http://attacker.test')).status).toBe(403)
    expect((await post('/api/input-history', { ...body, input: [{ type: 'text', text: 'abc', text_elements: [{ byteRange: { start: 0, end: 100 }, placeholder: 'x' }] }] }, cookie)).status).toBe(400)
    const saved = await post('/api/input-history', body, cookie)
    expect(saved.status).toBe(200); expect(saved.headers.get('cache-control')).toBe('no-store')
    const noOrigin = await fetch(base + path, { headers: { Cookie: cookie, 'X-Codex-Remote': '1' } })
    expect(noOrigin.status).toBe(200)
    expect(JSON.stringify(await noOrigin.json())).not.toContain('private-daemon-token')
    expect((await fetch(base + path, { headers: { Cookie: cookie, 'Sec-Fetch-Site': 'cross-site', 'X-Codex-Remote': '1' } })).status).toBe(403)
    expect((await post('/api/profiles', { name: 'too big', padding: 'x'.repeat(18000) }, cookie)).status).toBe(413)
    bridge.stop(); bridge = createBridge(options); base = 'http://127.0.0.1:' + bridge.server.port
    const next = await post('/api/session', { key: secret }), secondCookie = next.headers.get('set-cookie')!.split(';')[0]!
    const loaded = await fetch(base + path, { headers: { Cookie: secondCookie, 'X-Codex-Remote': '1' } })
    expect((await loaded.json()).entries).toMatchObject([{ id: 'durable', input }])
  } finally { bridge.stop() }
})

test('rejects invalid native input types and bounds total private history storage', async () => {
  for (const input of [[{ type: 'image', url: 'javascript:alert(1)' }], [{ type: 'tool', token: 'not-an-input' }], [{ type: 'text', text: '  ' }]]) expect(() => parseHistoryInput(input)).toThrow()
  const { store, file, profile } = await fixture()
  const text = 'x'.repeat(1024 * 1024)
  for (let i = 0; i < 17; i++) await store.rememberInput({ deviceId: profile.id, id: 'large-' + i, input: [{ type: 'text', text }] })
  const entries = await store.inputHistory(profile.id)
  expect(entries.length).toBeLessThan(17); expect(entries.at(-1)!.id).toBe('large-16')
  expect(Buffer.byteLength(JSON.stringify(JSON.parse(await readFile(file, 'utf8')).inputHistory))).toBeLessThanOrEqual(16 * 1024 * 1024)
})
