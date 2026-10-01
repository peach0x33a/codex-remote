import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { deleteCredential, storeCredential } from '../../src/lib/credentials'

const endpoint = 'wss://daemon.example/rpc'
const token = 'synthetic-client-token'
const credentialId = 'a'.repeat(64)
let request: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>
let storageAccesses: number
let originalStorage: PropertyDescriptor | undefined

beforeEach(() => {
  // No test may fall through to an actual network request.
  request = spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected fetch'))
  storageAccesses = 0
  originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { storageAccesses++; throw new Error('Browser storage must not be used') } })
})

afterEach(() => {
  request.mockRestore()
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage)
  else Reflect.deleteProperty(globalThis, 'localStorage')
  expect(storageAccesses).toBe(0)
})

const operations = [
  { method: 'POST', incomplete: '连接令牌未保存', run: () => storeCredential(endpoint, token) },
  { method: 'DELETE', incomplete: '连接令牌未清除', run: () => deleteCredential(credentialId) },
] as const

describe('credential client compatibility', () => {
  for (const { method, incomplete, run } of operations) {
    test.each([
      ['old bridge', () => Response.json({ error: '接口不存在。' }, { status: 404 })],
      ['unpunctuated error', () => Response.json({ error: '接口不存在' }, { status: 404 })],
      ['generic JSON error', () => Response.json({ error: 'Not Found' }, { status: 404 })],
      ['HTML error', () => new Response('<html>Not Found</html>', { status: 404 })],
      ['empty error', () => new Response(null, { status: 404 })],
      ['malformed JSON error', () => new Response('{broken', { status: 404 })],
      ['missing error field', () => Response.json({}, { status: 404 })],
    ] as const)(method + ' explains a missing API for %s', async (_name, response) => {
      request.mockResolvedValue(response())
      await expect(run()).rejects.toThrow(incomplete + '：当前 Bun 后端未提供凭据接口（/api/credentials）。请更新并重启 Bun 后端后重试；仅刷新页面或重启 Vite 无法更新后端。')
      expect(request).toHaveBeenCalledTimes(1)
    })

    test.each([
      [404, '保存的连接凭证不存在。'],
      [404, '此凭据已被移除，请重新填写。'],
      [400, '无效的访问令牌。'],
      [401, '请先输入此应用的访问密码。'],
      [403, '请求来源不受信任，请从配置的应用地址打开。'],
      [500, '无法访问保存的连接凭证。请检查服务器凭证存储配置。'],
    ] as const)(method + ' preserves a specific %d error: %s', async (status, error) => {
      request.mockResolvedValue(Response.json({ error }, { status }))
      await expect(run()).rejects.toThrow(error)
      expect(request).toHaveBeenCalledTimes(1)
    })

    test(method + ' reports an unreadable server error without claiming a missing route', async () => {
      request.mockResolvedValue(new Response('unavailable', { status: 503 }))
      await expect(run()).rejects.toThrow(incomplete + '，请重试。')
    })

    test(method + ' rejects network failures without exposing the token', async () => {
      request.mockRejectedValue(new Error('failed request containing ' + token))
      await expect(run()).rejects.toThrow(incomplete + '，请检查 Bun 服务后重试。')
      expect(request).toHaveBeenCalledTimes(1)
    })
  }

  test('a failed save rejects and the same draft can be retried explicitly', async () => {
    request.mockResolvedValueOnce(Response.json({ error: '接口不存在。' }, { status: 404 }))
      .mockResolvedValueOnce(Response.json({ credentialId }))
    await expect(storeCredential(endpoint, token)).rejects.toThrow('连接令牌未保存')
    expect(request).toHaveBeenCalledTimes(1)
    expect(await storeCredential(endpoint, token)).toBe(credentialId)
    expect(request).toHaveBeenCalledTimes(2)
    for (const [url, options] of request.mock.calls) {
      expect(url).toBe('/api/credentials')
      expect(options?.method).toBe('POST')
      expect(options?.headers).toEqual({ 'Content-Type': 'application/json' })
      expect(JSON.parse(options?.body as string)).toEqual({ endpoint, token })
      expect(options?.signal).toBeInstanceOf(AbortSignal)
    }
  })

  test.each([null, {}, { credentialId: '' }, { credentialId: 'invalid' }, { credentialId: 'a'.repeat(63) }, { credentialId: 'A'.repeat(64) }, { ok: true }])(
    'does not pretend a save succeeded with invalid data %j', async data => {
      request.mockResolvedValue(Response.json(data))
      await expect(storeCredential(endpoint, token)).rejects.toThrow('保存令牌的响应无效，请检查 Bun 服务版本。')
    },
  )

  test('does not pretend an HTML success response saved the token', async () => {
    request.mockResolvedValue(new Response('<html>App shell</html>'))
    await expect(storeCredential(endpoint, token)).rejects.toThrow('保存令牌的响应无效，请检查 Bun 服务版本。')
  })

  test.each([null, {}, { ok: false }, { ok: 'true' }, { credentialId }])(
    'does not pretend a delete succeeded with invalid data %j', async data => {
      request.mockResolvedValue(Response.json(data))
      await expect(deleteCredential(credentialId)).rejects.toThrow('清除令牌的响应无效，请检查 Bun 服务版本。')
    },
  )

  test('deletes only after an explicit success acknowledgement', async () => {
    request.mockResolvedValue(Response.json({ ok: true }))
    await expect(deleteCredential(credentialId)).resolves.toBeUndefined()
    expect(request).toHaveBeenCalledTimes(1)
    const [url, options] = request.mock.calls[0]!
    expect(url).toBe('/api/credentials')
    expect(options?.method).toBe('DELETE')
    expect(options?.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(options?.body as string)).toEqual({ credentialId })
  })
})
