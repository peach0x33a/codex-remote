import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import { chmod, link, lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { CredentialError, CredentialStore, credentialEndpoint, credentialId, credentialToken } from '../../server/credentials'

const endpoint = 'wss://daemon.example/rpc'
const unknownId = 'f'.repeat(64)
const roots: string[] = []
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'codex-credentials-'))
  roots.push(root)
  const file = join(root, 'private', 'nested', 'credentials.json')
  return { root, file, store: new CredentialStore(file) }
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

async function storageError(operation: Promise<unknown>, ...secrets: string[]) {
  const error = await operation.then(() => undefined, error => error)
  expect(error).toBeInstanceOf(CredentialError)
  expect(error.status).toBe(500)
  for (const secret of secrets) expect(error.message).not.toContain(secret)
}

describe('private persistent credentials', () => {
  test('creates opaque IDs and private files/directories, retaining existing ancestor modes', async () => {
    const { root, file, store } = await fixture()
    await chmod(root, 0o755)
    const id = await store.save(' WSS://DAEMON.EXAMPLE:443/rpc ', '  secret-token  ')
    expect(id).toMatch(/^[a-f0-9]{64}$/)
    expect(await store.token(id, endpoint)).toBe('secret-token')
    expect((await stat(file)).mode & 0o777).toBe(0o600)
    expect((await stat(dirname(file))).mode & 0o777).toBe(0o700)
    expect((await stat(join(root, 'private'))).mode & 0o777).toBe(0o700)
    expect((await stat(root)).mode & 0o777).toBe(0o755)
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ version: 1, credentials: { [id]: { endpoint, token: 'secret-token' } } })
    expect(await readdir(dirname(file))).toEqual(['credentials.json'])
  })

  test('survives a fresh process and durably deletes without recreating unknown IDs', async () => {
    const { file, store } = await fixture()
    const id = await store.save(endpoint, 'restart-secret')
    const source = new URL('../../server/credentials.ts', import.meta.url).href
    const child = Bun.spawnSync([process.execPath, '--eval',
      'import { CredentialStore } from ' + JSON.stringify(source) + ';' +
      'const store = new CredentialStore(' + JSON.stringify(file) + ');' +
      'console.log(await store.token(' + JSON.stringify(id) + ',' + JSON.stringify(endpoint) + '));' +
      'await store.remove(' + JSON.stringify(id) + ');'], { stdout: 'pipe', stderr: 'pipe' })
    expect(child.exitCode).toBe(0)
    expect(child.stderr.toString()).toBe('')
    expect(child.stdout.toString().trim()).toBe('restart-secret')
    const restarted = new CredentialStore(file)
    await expect(restarted.token(id, endpoint)).rejects.toMatchObject({ status: 404 })
    await expect(restarted.save(endpoint, 'replacement', id)).rejects.toMatchObject({ status: 404 })
    await restarted.remove(id)
    await restarted.remove(unknownId)
    expect(JSON.parse(await readFile(file, 'utf8')).credentials).toEqual({})
    expect((await stat(file)).mode & 0o777).toBe(0o600)
  })

  test('replaces the file atomically and updates the same ID including an explicit endpoint change', async () => {
    const { file, store } = await fixture()
    const id = await store.save(endpoint, 'first-secret')
    const old = await open(file, 'r')
    try {
      expect(await store.save('wss://other.example/rpc', 'second-secret', id)).toBe(id)
      const current = JSON.parse(await readFile(file, 'utf8'))
      expect(current.credentials).toEqual({ [id]: { endpoint: 'wss://other.example/rpc', token: 'second-secret' } })
      expect(JSON.parse(await old.readFile('utf8')).credentials[id].token).toBe('first-secret')
      expect((await old.stat()).ino).not.toBe((await stat(file)).ino)
      expect((await stat(file)).mode & 0o777).toBe(0o600)
      expect(await readdir(dirname(file))).toEqual(['credentials.json'])
      await expect(store.token(id, endpoint)).rejects.toMatchObject({ status: 400 })
      expect(await new CredentialStore(file).token(id, 'wss://other.example/rpc')).toBe('second-secret')
    } finally { await old.close() }
  })

  test('serializes concurrent creates, updates, deletes and reads across instances', async () => {
    const { file, store } = await fixture()
    const other = new CredentialStore(file)
    const ids = await Promise.all(Array.from({ length: 24 }, (_, i) => (i % 2 ? other : store).save(endpoint, 'token-' + i)))
    expect(new Set(ids).size).toBe(24)
    expect(Object.keys(JSON.parse(await readFile(file, 'utf8')).credentials)).toHaveLength(24)
    await Promise.all(ids.map((id, i) => i % 2 ? other.remove(id) : store.save(endpoint, 'updated-' + i, id)))
    const persisted = JSON.parse(await readFile(file, 'utf8')).credentials
    expect(Object.keys(persisted)).toHaveLength(12)
    for (let i = 0; i < ids.length; i += 2) expect(persisted[ids[i]!].token).toBe('updated-' + i)
    const id = ids[0]!
    const update = store.save(endpoint, 'last-secret', id)
    const followingRead = other.token(id, endpoint)
    await update
    expect(await followingRead).toBe('last-secret')
  })

  test('a failed atomic rename preserves the old file, removes the private temporary file and permits retry', async () => {
    const { file, store } = await fixture()
    const id = await store.save(endpoint, 'original-secret')
    const original = await readFile(file, 'utf8')
    let attempted = false
    const renameFailure = spyOn(fs, 'rename').mockImplementation(async (source, destination) => {
      attempted = true
      expect(destination).toBe(file)
      expect((await stat(source)).mode & 0o777).toBe(0o600)
      expect(await readFile(file, 'utf8')).toBe(original)
      throw new Error('synthetic error including replacement-secret and ' + file)
    })
    try { await storageError(store.save(endpoint, 'replacement-secret', id), 'replacement-secret', file) } finally { renameFailure.mockRestore() }
    expect(attempted).toBe(true)
    expect(await readFile(file, 'utf8')).toBe(original)
    expect(await readdir(dirname(file))).toEqual(['credentials.json'])
    expect(await store.token(id, endpoint)).toBe('original-secret')
    await store.save(endpoint, 'retry-secret', id)
    expect(await new CredentialStore(file).token(id, endpoint)).toBe('retry-secret')
  })

  test('unknown updates fail, missing deletes are idempotent, and neither creates a file', async () => {
    const { file, store } = await fixture()
    await expect(store.save(endpoint, 'secret', unknownId)).rejects.toMatchObject({ status: 404 })
    await store.remove(unknownId)
    await expect(lstat(dirname(file))).rejects.toMatchObject({ code: 'ENOENT' })
    const id = await store.save(endpoint, 'after-failure')
    expect(await store.token(id, endpoint)).toBe('after-failure')
  })

  test('matches exactly after endpoint normalization, including path, port and transport', async () => {
    const { store } = await fixture()
    const id = await store.save(endpoint, 'bound-secret')
    expect(await store.token(id, ' WSS://DAEMON.EXAMPLE:443/rpc ')).toBe('bound-secret')
    for (const wrong of ['ws://daemon.example/rpc', 'wss://daemon.example:444/rpc', 'wss://daemon.example/rpc/', 'wss://daemon.example/other', 'wss://other.example/rpc', 'unix:///tmp/example.sock']) {
      await expect(store.token(id, wrong)).rejects.toMatchObject({ status: 400 })
    }
    const unix = await store.save('unix:///tmp/daemon.sock', 'unix-secret')
    expect(await store.token(unix, 'unix:///tmp/daemon.sock')).toBe('unix-secret')
    await expect(store.token(unix, 'unix:///tmp/other.sock')).rejects.toMatchObject({ status: 400 })
  })

  test('fails closed on malformed or invalid-schema stores without leaking or overwriting contents', async () => {
    const { file, store } = await fixture()
    await mkdir(dirname(file), { recursive: true, mode: 0o700 })
    const invalid = [
      '{ broken secret-in-invalid-json', '', 'null', '[]',
      JSON.stringify({ version: 2, credentials: {} }),
      JSON.stringify({ version: 1, credentials: [] }),
      JSON.stringify({ version: 1, credentials: { invalid: { endpoint, token: 'secret-in-invalid-json' } } }),
      JSON.stringify({ version: 1, credentials: { [unknownId]: { endpoint: 'wss://user:secret-in-invalid-json@host', token: 'valid' } } }),
      JSON.stringify({ version: 1, credentials: { [unknownId]: { endpoint, token: 'secret-in-invalid-json\r\n' } } }),
      JSON.stringify({ version: 1, credentials: { [unknownId]: { endpoint, token: 'x'.repeat(8193) } } }),
    ]
    for (const raw of invalid) {
      await writeFile(file, raw, { mode: 0o600 })
      await storageError(store.save(endpoint, 'incoming-secret'), 'secret-in-invalid-json', 'incoming-secret', file)
      await storageError(store.token(unknownId, endpoint), 'secret-in-invalid-json', file)
      await storageError(store.remove(unknownId), 'secret-in-invalid-json', file)
      expect(await readFile(file, 'utf8')).toBe(raw)
    }
    await writeFile(file, JSON.stringify({ version: 1, credentials: {} }))
    expect(await store.save(endpoint, 'recovered')).toMatch(/^[a-f0-9]{64}$/)
  })

  test.each([false, true])('rejects linked credential files, including dangling links: %s', async dangling => {
    const { root, file, store } = await fixture()
    await mkdir(dirname(file), { recursive: true, mode: 0o700 })
    const target = join(root, 'outside-secret.json')
    if (!dangling) await writeFile(target, 'outside-secret', { mode: 0o600 })
    await symlink(target, file)
    await storageError(store.save(endpoint, 'incoming-secret'), 'incoming-secret', target)
    await storageError(store.token(unknownId, endpoint), target)
    await storageError(store.remove(unknownId), target)
    expect((await lstat(file)).isSymbolicLink()).toBe(true)
    if (!dangling) expect(await readFile(target, 'utf8')).toBe('outside-secret')
    else await expect(lstat(target)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  test('rejects a symlink in an ancestor after a store has already been used', async () => {
    const { root, file, store } = await fixture()
    const id = await store.save(endpoint, 'parent-secret')
    const original = await readFile(file, 'utf8')
    const moved = join(root, 'moved')
    await rename(join(root, 'private'), moved)
    await symlink(moved, join(root, 'private'))
    await storageError(store.token(id, endpoint), 'parent-secret')
    await storageError(store.save(endpoint, 'replacement', id), 'replacement')
    await storageError(store.remove(id), 'parent-secret')
    expect(await readFile(join(moved, 'nested', 'credentials.json'), 'utf8')).toBe(original)
  })

  test('rejects non-private permissions, hard links and non-file targets', async () => {
    const { root, file, store } = await fixture()
    const id = await store.save(endpoint, 'protected-secret')
    await chmod(file, 0o644)
    await storageError(store.token(id, endpoint), 'protected-secret')
    await storageError(store.save(endpoint, 'changed', id), 'changed')
    await storageError(store.remove(id), 'protected-secret')
    await chmod(file, 0o600)
    const hardlink = join(root, 'hardlink')
    await link(file, hardlink)
    await storageError(store.token(id, endpoint), 'protected-secret')
    await rm(hardlink)
    expect(await store.token(id, endpoint)).toBe('protected-secret')
    await rm(file)
    await mkdir(file)
    await storageError(store.save(endpoint, 'changed'), 'changed', file)
  })
})

describe('credential input validation', () => {
  test('preserves optional/empty tokens and trims valid strings at the existing limit', () => {
    expect(credentialToken(undefined)).toBe('')
    expect(credentialToken('')).toBe('')
    expect(credentialToken('  opaque token  ')).toBe('opaque token')
    expect(credentialToken('x'.repeat(8192), true)).toHaveLength(8192)
    expect(() => credentialToken(undefined, true)).toThrow(CredentialError)
    for (const bad of [null, 123, {}, [], 'x'.repeat(8193), 'secret\r', 'secret\n']) expect(() => credentialToken(bad)).toThrow(CredentialError)
  })

  test('rejects malformed IDs and unsafe or overlong endpoints', () => {
    for (const bad of [undefined, null, 123, {}, '', 'a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), '../credentials']) expect(() => credentialId(bad)).toThrow(CredentialError)
    for (const bad of [undefined, null, 123, '', 'wss://host/' + 'x'.repeat(2048), 'https://host', 'wss://user:secret@host', 'wss://host/?token=secret', 'wss://host/#secret', 'unix:///tmp/%xy']) expect(() => credentialEndpoint(bad)).toThrow(CredentialError)
  })
})
