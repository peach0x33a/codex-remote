import { expect, test } from 'bun:test'
import { CONFIG_FIELDS, fieldOptions, readCodexConfig, saveCodexConfig, userConfigLayer, type ConfigRequest, type ConfigSnapshot } from '../../src/lib/codex-config'
const models = [{ id: 'm', model: 'm', displayName: 'Model', isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: 'high', description: '' }], serviceTiers: [{ id: 'fast', name: 'Fast' }] }]
const snapshot = (): ConfigSnapshot => ({ config: { model: 'm', approval_policy: 'on-request', unrelated: 'keep' }, origins: {}, layers: [{ name: { type: 'user', file: '/device/config.toml' }, version: 'v1' }], requirements: null })
function transport(respond: (method: string, params: Record<string, unknown>) => unknown) { const calls: { method: string; params: Record<string, unknown> }[] = []; const request: ConfigRequest = async <T>(method: string, params: Record<string, unknown>) => { calls.push({ method, params }); return await respond(method, params) as T }; return { request, calls } }
test('loads the config and managed requirements without writing', async () => {
  const t = transport(method => method === 'config/read' ? snapshot() : { requirements: { allowedSandboxModes: ['read-only'] } })
  const result = await readCodexConfig(t.request)
  expect(result.requirements?.allowedSandboxModes).toEqual(['read-only'])
  expect(t.calls).toEqual([{ method: 'config/read', params: { includeLayers: true } }, { method: 'configRequirements/read', params: {} }])
})
test('writes only dirty keys with version protection and no live permission reload', async () => {
  const t = transport(() => ({ status: 'ok', version: 'v2', filePath: '/device/config.toml' }))
  await saveCodexConfig(t.request, snapshot(), { model_verbosity: 'low', model_auto_compact_token_limit: '120000', service_tier: '' }, models)
  expect(t.calls).toEqual([{ method: 'config/batchWrite', params: { edits: [{ keyPath: 'model_verbosity', value: 'low', mergeStrategy: 'replace' }, { keyPath: 'model_auto_compact_token_limit', value: 120000, mergeStrategy: 'replace' }, { keyPath: 'service_tier', value: null, mergeStrategy: 'replace' }], expectedVersion: 'v1', filePath: '/device/config.toml', reloadUserConfig: false } }])
})
test.each(['-1', '0', '1.5', 'Infinity', '9007199254740992'])('rejects invalid token limits %s before any write', async raw => {
  const t = transport(() => ({}))
  await expect(saveCodexConfig(t.request, snapshot(), { model_context_window: raw }, models)).rejects.toThrow('正整数')
  expect(t.calls).toHaveLength(0)
})
test('respects server restrictions and refuses arbitrary config keys', async () => {
  const s = snapshot(); s.requirements = { allowedSandboxModes: ['read-only'] }
  const field = CONFIG_FIELDS.find(f => f.key === 'sandbox_mode')!
  expect(fieldOptions(field, s, models, 'm').find(o => o.value === 'danger-full-access')?.disabled).toBe(true)
  const t = transport(() => ({}))
  await expect(saveCodexConfig(t.request, s, { sandbox_mode: 'danger-full-access' }, models)).rejects.toThrow('策略限制')
  await expect(saveCodexConfig(t.request, s, { api_key: 'secret' }, models)).rejects.toThrow('不支持的配置项')
  expect(t.calls).toHaveLength(0)
})
test('does not add a noisy default override option to Codex dropdowns', () => {
  const field = CONFIG_FIELDS.find(item => item.key === 'approval_policy')!
  const options = fieldOptions(field, snapshot(), models, 'm')
  expect(options.some(option => option.label.includes('不覆盖'))).toBe(false)
  expect(options.map(option => option.value)).toEqual(['on-request', 'never'])
})
test('refuses missing writable versions and never writes to project or profile layers', async () => {
  const s = snapshot(); s.layers = [{ name: { type: 'project', file: '/project/config.toml' }, version: 'project' }, { name: { type: 'user', file: '/device/config.toml', profile: 'personal' }, version: 'profile' }]
  expect(userConfigLayer(s)).toBeUndefined()
  const t = transport(() => ({}))
  await expect(saveCodexConfig(t.request, s, { model_verbosity: 'low' }, models)).rejects.toThrow('可写')
  expect(t.calls).toHaveLength(0)
})
test('does not retry version conflicts or unsupported endpoints', async () => {
  const t = transport(() => { throw new Error('configVersionConflict') })
  await expect(saveCodexConfig(t.request, snapshot(), { model_verbosity: 'low' }, models)).rejects.toThrow('configVersionConflict')
  expect(t.calls).toHaveLength(1)
})
test('retains the overridden write status and validates incomplete responses', async () => {
  const t = transport(() => ({ status: 'okOverridden', version: 'v2', filePath: '/device/config.toml' }))
  expect((await saveCodexConfig(t.request, snapshot(), { model_verbosity: 'low' }, models)).status).toBe('okOverridden')
  await expect(saveCodexConfig(transport(() => ({})).request, snapshot(), { model_verbosity: 'low' }, models)).rejects.toThrow('未确认')
  await expect(readCodexConfig(transport(() => ({})).request)).rejects.toThrow('配置无效')
})
