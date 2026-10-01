import type { Model } from '../../shared/protocol'
export class ConfigValidationError extends Error {}
export type ConfigRequest = <T>(method: string, params: Record<string, unknown>) => Promise<T>
type Layer = { name: { type: string; file?: string; profile?: string | null }; version: string; config?: Record<string, unknown>; disabledReason?: string }
export type ConfigSnapshot = { config: Record<string, unknown>; layers?: Layer[]; origins?: Record<string, Layer>; requirements: Record<string, unknown> | null }
export type ConfigField = { key: string; label: string; section: '模型' | '执行' | '上下文'; kind?: 'number'; options?: { value: string; label: string; disabled?: boolean }[]; requirement?: string }
const choices = (...values: string[]) => values.map(value => ({ value, label: value }))
export const CONFIG_FIELDS: ConfigField[] = [
  { key: 'model', label: '默认模型', section: '模型' },
  { key: 'model_reasoning_effort', label: '默认思考强度', section: '模型' },
  { key: 'service_tier', label: '默认服务等级', section: '模型' },
  { key: 'model_verbosity', label: '回复详细程度', section: '模型', options: [{ value: 'low', label: '简洁' }, { value: 'medium', label: '标准' }, { value: 'high', label: '详细' }] },
  { key: 'model_reasoning_summary', label: '思考摘要', section: '模型', options: choices('auto', 'concise', 'detailed', 'none') },
  { key: 'approval_policy', label: '审批策略', section: '执行', requirement: 'allowedApprovalPolicies', options: [{ value: 'on-request', label: '按需请求' }, { value: 'never', label: '从不请求审批' }] },
  { key: 'sandbox_mode', label: '沙箱范围', section: '执行', requirement: 'allowedSandboxModes', options: [{ value: 'read-only', label: '只读' }, { value: 'workspace-write', label: '工作区可写' }, { value: 'danger-full-access', label: '完全访问' }] },
  { key: 'web_search', label: '网络搜索', section: '执行', requirement: 'allowedWebSearchModes', options: [{ value: 'disabled', label: '关闭' }, { value: 'cached', label: '缓存搜索' }, { value: 'live', label: '实时搜索' }] },
  { key: 'model_context_window', label: '上下文窗口上限（tokens）', section: '上下文', kind: 'number' },
  { key: 'model_auto_compact_token_limit', label: '自动压缩阈值（tokens）', section: '上下文', kind: 'number' },
]
export function userConfigLayer(snapshot: ConfigSnapshot) { return snapshot.layers?.find(layer => layer.name.type === 'user' && !layer.name.profile && !layer.disabledReason) }
export function fieldOptions(field: ConfigField, snapshot: ConfigSnapshot, models: Model[], modelName: unknown): { value: string; label: string; disabled?: boolean }[] {
  const model = models.find(item => item.model === modelName) || models.find(item => item.isDefault)
  let options = field.options || (field.key === 'model' ? models.map(item => ({ value: item.model, label: item.displayName || item.model }))
    : field.key === 'model_reasoning_effort' ? (model?.supportedReasoningEfforts || []).map(item => ({ value: item.reasoningEffort, label: item.reasoningEffort === 'max' ? 'Max' : item.reasoningEffort === 'ultra' ? 'Ultra' : item.reasoningEffort }))
    : (model?.serviceTiers || (model?.additionalSpeedTiers || []).map(id => ({ id, name: id }))).map(item => ({ value: item.id, label: item.name })))
  const allowed = field.requirement && snapshot.requirements?.[field.requirement]
  options = options.map(option => ({ ...option, disabled: Array.isArray(allowed) && !allowed.includes(option.value) }))
  return options
}
export async function readCodexConfig(request: ConfigRequest): Promise<ConfigSnapshot> {
  const [snapshot, policy] = await Promise.all([request<Omit<ConfigSnapshot, 'requirements'>>('config/read', { includeLayers: true }), request<{ requirements: Record<string, unknown> | null }>('configRequirements/read', {})])
  if (!snapshot || !snapshot.config || typeof snapshot.config !== 'object' || Array.isArray(snapshot.config)) throw new Error('设备返回的配置无效。')
  if (!policy || !('requirements' in policy)) throw new Error('无法读取设备的配置限制。')
  return { ...snapshot, requirements: policy.requirements }
}
export async function saveCodexConfig(request: ConfigRequest, snapshot: ConfigSnapshot, changed: Record<string, string>, models: Model[]) {
  const layer = userConfigLayer(snapshot)
  if (!layer?.version || !layer.name.file) throw new Error('设备未提供可写的用户配置层，请刷新或升级服务端。')
  const edits = Object.entries(changed).map(([key, raw]) => {
    const field = CONFIG_FIELDS.find(item => item.key === key)
    if (!field) throw new ConfigValidationError('不支持的配置项：' + key)
    let value: string | number | null = raw === '' ? null : raw
    if (field.kind === 'number' && raw !== '') { value = Number(raw); if (!Number.isSafeInteger(value) || value <= 0) throw new ConfigValidationError(field.label + '必须是正整数。') }
    else if (raw !== '') {
      const option = fieldOptions(field, snapshot, models, changed.model ?? snapshot.config.model).find(item => item.value === raw)
      if (!option || option.disabled) throw new ConfigValidationError(field.label + '不支持该值或受设备策略限制。')
    }
    return { keyPath: key, value, mergeStrategy: 'replace' }
  })
  if (!edits.length) throw new ConfigValidationError('没有需要保存的更改。')
  const result = await request<{ status: string; version: string; filePath: string; overriddenMetadata?: { message?: string } }>('config/batchWrite', { edits, filePath: layer.name.file, expectedVersion: layer.version, reloadUserConfig: false })
  if (!result || !['ok', 'okOverridden'].includes(result.status) || typeof result.version !== 'string') throw new Error('保存结果未确认，请刷新配置后检查；未自动重试。')
  return result
}
