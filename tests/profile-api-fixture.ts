import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CredentialStore, CredentialError } from '../server/credentials'
import type { ConnectionProfile } from '../shared/protocol'
import type { ProfileSnapshot } from '../shared/profiles'

/** Real private-file store behind an in-memory HTTP transport, isolated per test. */
export async function createProfileApi(initial: ConnectionProfile[] = []) {
  const root = await mkdtemp(join(tmpdir(), 'codex-profile-runtime-'))
  const file = join(root, 'credentials.json'), store = new CredentialStore(file)
  for (const profile of initial) await store.saveProfile(profile, true)
  const pending = new Set<Promise<Response>>()
  const api = {
    store, file, snapshot: await store.profiles() as ProfileSnapshot,
    credentials: new Map<string, { endpoint: string; token: string }>(),
    failSave: false, failDelete: false as boolean | string,
    calls: [] as { method: string; body: Record<string, any> }[],
    async idle() { while (pending.size) await Promise.all([...pending]) },
    async dispose() { await api.idle(); await rm(root, { recursive: true, force: true }) },
    handle(init?: RequestInit): Promise<Response> {
      const operation = (async () => {
        const method = init?.method || 'GET', body = init?.body ? JSON.parse(String(init.body)) : {}
        api.calls.push({ method, body })
        try {
          if (method === 'POST' && body.action !== 'import' && api.failSave) return Response.json({ error: '保存失败' }, { status: 503 })
          const old = api.snapshot.profiles.find(profile => profile.id === body.id)
          if (old?.credentialId && (api.failDelete === true || api.failDelete === old.credentialId) && (method === 'DELETE' || method === 'POST' && (body.token || body.clearToken || body.rememberToken === false))) return Response.json({ error: '删除失败' }, { status: 503 })
          const result = method === 'GET' ? await store.profiles() : method === 'PATCH' ? await store.selectProfile(body.selectedId) : method === 'DELETE' ? await store.removeProfile(body.id) : await store.saveProfile(body, body.action === 'import')
          api.snapshot = result
          const disk = await readFile(file, 'utf8').then(JSON.parse).catch(() => ({ credentials: {} }))
          api.credentials.clear()
          for (const [id, value] of Object.entries(disk.credentials)) api.credentials.set(id, value as { endpoint: string; token: string })
          return Response.json(result)
        } catch (error) { return Response.json({ error: (error as Error).message }, { status: error instanceof CredentialError ? error.status : 500 }) }
      })()
      pending.add(operation)
      void operation.finally(() => pending.delete(operation))
      return operation
    },
  }
  return api
}
