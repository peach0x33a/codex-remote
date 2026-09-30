export const COMPOSER_COMMANDS = [
  { id: 'goal', label: '/goal', description: '设置或管理目标', requiresConnection: true },
  { id: 'new', label: '/new', description: '开启新对话' },
  { id: 'model', label: '/model', description: '选择模型', requiresConnection: true },
  { id: 'effort', label: '/effort', description: '调整思考强度', requiresConnection: true },
  { id: 'permissions', label: '/permissions', description: '调整权限', requiresConnection: true },
  { id: 'project', label: '/project', description: '选择工作目录', requiresConnection: true },
  { id: 'tasks', label: '/tasks', description: '打开任务中心', requiresConnection: true },
  { id: 'settings', label: '/settings', description: '打开设置' },
  { id: 'help', label: '/help', description: '使用指南' },
] as const
export type ComposerCommandId = typeof COMPOSER_COMMANDS[number]['id']
export function composerCommands(query: string, connected: boolean) {
  const needle = query.trim().toLocaleLowerCase()
  return COMPOSER_COMMANDS.filter(command => (!('requiresConnection' in command) || connected) &&
    (!needle || command.id.includes(needle) || command.description.includes(needle)))
}
export function submittedCommand(text: string): { name: string; argument: string } | undefined {
  const match = text.trim().match(/^\/([a-z][a-z-]*)(?:\s+([\s\S]*))?$/i)
  return match ? { name: match[1]!.toLowerCase(), argument: match[2]?.trim() || '' } : undefined
}
// Matches the native TUI's file completion: a path in prompt text, with spaces quoted.
export function fileMentionText(path: string) {
  return /\s/.test(path) && !path.includes('"') ? '"' + path + '"' : path
}
