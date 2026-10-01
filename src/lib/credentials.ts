// Legacy credential API compatibility. Device saves now use the atomic /api/profiles API.
async function credentialRequest(method: 'POST' | 'DELETE', body: Record<string, string>) {
  const incomplete = method === 'POST' ? '连接令牌未保存' : '连接令牌未清除'
  let response: Response
  try {
    response = await fetch('/api/credentials', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) })
  } catch { throw new Error(incomplete + '，请检查 Bun 服务后重试。') }
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const message = typeof data?.error === 'string' ? data.error.trim() : ''
    // Older bridges use this route-level 404; credential-level 404s must remain distinct.
    if (response.status === 404 && (!message || /^(接口不存在[。.]?|not found[.]?)$/i.test(message))) {
      throw new Error(incomplete + '：当前 Bun 后端未提供凭据接口（/api/credentials）。请更新并重启 Bun 后端后重试；仅刷新页面或重启 Vite 无法更新后端。')
    }
    throw new Error(message || incomplete + '，请重试。')
  }
  return data
}
export async function storeCredential(endpoint: string, token: string): Promise<string> {
  const data = await credentialRequest('POST', { endpoint, token })
  if (typeof data?.credentialId !== 'string' || !/^[a-f0-9]{64}$/.test(data.credentialId)) throw new Error('保存令牌的响应无效，请检查 Bun 服务版本。')
  return data.credentialId
}
export async function deleteCredential(credentialId: string): Promise<void> {
  const data = await credentialRequest('DELETE', { credentialId })
  if (data?.ok !== true) throw new Error('清除令牌的响应无效，请检查 Bun 服务版本。')
}
