/** Parse the exact browser origins allowed to use this deployment. */
export function parseAppOrigins(value: string | undefined): string[] {
  if (!value?.trim()) return []
  const entries = value.split(',').map(entry => entry.trim()).filter(Boolean)
  if (!entries.length) throw new Error('APP_ORIGIN 至少需要一个完整的 http(s) 源地址，多个地址用逗号分隔。')
  const origins = entries.map(entry => {
    let url: URL
    try { url = new URL(entry) } catch {
      throw new Error('APP_ORIGIN 必须是完整的 http(s) 源地址，多个地址用逗号分隔。')
    }
    if (!/^https?:\/\/[^/?#\s\\]+\/?$/i.test(entry) || !['http:', 'https:'].includes(url.protocol) ||
      entry.includes('@') || url.hostname.includes('*') || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('APP_ORIGIN 只能包含协议、主机和端口，不能包含凭证、通配符、路径、查询或片段。')
    }
    return url.origin
  })
  return [...new Set(origins)]
}
