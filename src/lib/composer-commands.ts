import type { ModelServiceTier } from '../../shared/protocol'

// Actions implemented by this web client. The App Server does not enumerate
// the TUI's local slash commands; skill metadata comes separately from skills/list.
export const COMPOSER_COMMANDS = [
  { id: 'goal', label: '/goal', description: '设置或管理目标', requiresConnection: true },
  { id: 'new', label: '/new', description: '开启新对话' },
  { id: 'model', label: '/model', description: '选择模型', requiresConnection: true },
  { id: 'effort', label: '/effort', description: '调整思考强度', requiresConnection: true },
  { id: 'permissions', label: '/permissions', description: '调整权限', requiresConnection: true },
  { id: 'skills', label: '/skills', description: '浏览并选择当前项目的技能', requiresConnection: true },
  { id: 'rename', label: '/rename', description: '重命名当前对话', requiresConnection: true },
  { id: 'archive', label: '/archive', description: '归档当前对话', requiresConnection: true },
  { id: 'resume', label: '/resume', description: '查找并打开已有会话', requiresConnection: true },
  { id: 'agents', label: '/agents', description: '打开任务中心', requiresConnection: true },
  { id: 'diff', label: '/diff', description: '查看当前会话的文件变更', requiresConnection: true },
  { id: 'mention', label: '/mention', description: '提及当前项目中的文件', requiresConnection: true },
  { id: 'compact', label: '/compact', description: '压缩当前会话的上下文', requiresConnection: true },
  { id: 'status', label: '/status', description: '查看当前会话的上下文用量', requiresConnection: true },
  { id: 'cd', label: '/cd', description: '选择工作目录', requiresConnection: true },
  { id: 'pwd', label: '/pwd', description: '显示当前工作目录', requiresConnection: true },
  { id: 'copy', label: '/copy', description: '复制最近一条回复', requiresConnection: true },
  { id: 'project', label: '/project', description: '选择工作目录', requiresConnection: true },
  { id: 'tasks', label: '/tasks', description: '打开任务中心', requiresConnection: true },
  { id: 'settings', label: '/settings', description: '打开设置' },
  { id: 'help', label: '/help', description: '使用指南' },
] as const
export type ComposerCommandId = typeof COMPOSER_COMMANDS[number]['id']
export type ComposerServiceTierCommand = { id: string; label: string; description: string; serviceTier: string }
export type ComposerCommand = typeof COMPOSER_COMMANDS[number] | ComposerServiceTierCommand
export function composerCommands(query: string, connected: boolean, serviceTiers: ModelServiceTier[] = []): ComposerCommand[] {
  const needle = query.trim().toLocaleLowerCase()
  const commands: ComposerCommand[] = []
  for (const command of COMPOSER_COMMANDS) {
    if (('requiresConnection' in command) && !connected) continue
    commands.push(command)
    if (command.id === 'model' && connected) {
      for (const tier of serviceTiers) commands.push({ id: 'service-tier:' + tier.id, label: '/' + (['priority', 'fast'].includes(tier.id.toLowerCase()) ? 'fast' : tier.id.toLowerCase()), description: tier.description || '切换服务速度', serviceTier: tier.id })
    }
  }
  return commands.filter(command => {
    if (!needle) return true
    const value = 'serviceTier' in command ? command.label.slice(1) : command.id
    return value.toLocaleLowerCase().includes(needle) || command.description.toLocaleLowerCase().includes(needle)
  })
}
export function composerPlaceholder(model?: string, effort?: string) {
  const modelName = model?.trim().toLocaleLowerCase()
  const effortName = effort?.trim().toLocaleLowerCase()
  return modelName === 'gpt-6-astra' && ['xhigh', 'max', 'ultra'].includes(effortName || '') ? '与神对话' : '向 Codex 提问，或描述你想完成的任务'
}
export function submittedCommand(text: string): { name: string; argument: string } | undefined {
  const match = text.trim().match(/^\/([a-z][a-z-]*)(?:\s+([\s\S]*))?$/i)
  return match ? { name: match[1]!.toLowerCase(), argument: match[2]?.trim() || '' } : undefined
}
// Matches the native TUI's file completion: a path in prompt text, with spaces quoted.
export function fileMentionText(path: string) {
  return /\s/.test(path) && !path.includes('"') ? '"' + path + '"' : path
}
