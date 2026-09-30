export function normalizeEndpoint(input: string): string {
  const text = input.trim()
  if (!text) throw new Error('请输入 App Server 地址。')
  let url: URL
  try { url = new URL(text) } catch { throw new Error('地址格式不正确，请使用 ws://、wss:// 或 unix:/// 开头的完整地址。') }
  if (!['ws:', 'wss:', 'unix:'].includes(url.protocol)) throw new Error('仅支持 ws://、wss:// 或 unix:/// 地址。')
  if (url.username || url.password || url.search || url.hash) throw new Error('请移除地址中的用户名、密码、查询参数和片段；令牌应填在单独的访问令牌字段。')
  if (url.protocol === 'unix:') {
    const path = decodeURIComponent(url.pathname)
    if (url.hostname || !path.startsWith('/') || path === '/' || /[\0\r\n]/.test(path)) throw new Error('Unix socket 必须是 Bun 服务器上的绝对文件路径。')
    if (path.includes(':')) throw new Error('Unix socket 路径不能含冒号，请使用不含冒号的 socket 文件路径。')
    return 'unix://' + url.pathname
  }
  if (!url.hostname) throw new Error('地址缺少主机名。')
  return url.toString()
}

export function endpointLabel(endpoint: string): string {
  try {
    const url = new URL(endpoint)
    return url.protocol === 'unix:' ? decodeURIComponent(url.pathname) : url.host + (url.pathname === '/' ? '' : url.pathname)
  } catch { return endpoint }
}
