export type RemoteSkill = { name: string; description: string; path: string; scope: string; enabled: boolean; displayName?: string }
export type SkillCatalog = { skills: RemoteSkill[]; errors: string[] }
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const normalized = (path: string) => path.replaceAll('\\', '/').replace(/\/+$/, '')
export function parseSkills(value: unknown, cwd: string): SkillCatalog {
  if (!record(value) || !Array.isArray(value.data) || value.data.length > 32) throw new Error('技能列表响应无效。')
  const skills = new Map<string, RemoteSkill>(), errors: string[] = []
  for (const entry of value.data) {
    if (!record(entry) || typeof entry.cwd !== 'string' || !Array.isArray(entry.skills) || entry.skills.length > 5000 || !Array.isArray(entry.errors)) throw new Error('技能列表响应无效。')
    if (cwd && normalized(entry.cwd) !== normalized(cwd)) throw new Error('技能列表不属于当前工作目录。')
    for (const item of entry.skills) {
      if (!record(item) || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 300 || typeof item.path !== 'string' || !/^(?:\/|[a-z]:[\\/])/i.test(item.path) || /[\x00-\x1f]/.test(item.path) || typeof item.description !== 'string' || typeof item.enabled !== 'boolean' || typeof item.scope !== 'string') throw new Error('技能元数据无效。')
      const detail = record(item.interface) ? item.interface : undefined
      skills.set(item.path, { name: item.name, path: item.path, description: typeof detail?.shortDescription === 'string' ? detail.shortDescription : typeof item.shortDescription === 'string' ? item.shortDescription : item.description, scope: item.scope, enabled: item.enabled, displayName: typeof detail?.displayName === 'string' ? detail.displayName : undefined })
    }
    for (const error of entry.errors) if (record(error) && typeof error.message === 'string') errors.push(error.message)
  }
  return { skills: [...skills.values()], errors }
}
export function filterSkills(skills: RemoteSkill[], query: string) {
  const needle = query.trim().toLocaleLowerCase()
  return skills.filter(skill => !needle || [skill.name, skill.displayName, skill.description].some(text => text?.toLocaleLowerCase().includes(needle)))
}
