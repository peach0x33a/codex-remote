declare module 'markdown-it-task-lists' {
  import type { PluginWithOptions } from 'markdown-it'
  const plugin: PluginWithOptions<{ enabled?: boolean; label?: boolean }>
  export default plugin
}
declare module 'markdown-it-texmath' {
  import type { PluginWithOptions } from 'markdown-it'
  const plugin: PluginWithOptions<{ engine: unknown; delimiters: string[]; katexOptions: Record<string, unknown> }>
  export default plugin
}
