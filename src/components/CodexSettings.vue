<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import { PhArrowClockwise } from '@phosphor-icons/vue'
import CustomSelect from './CustomSelect.vue'
import { ConfigValidationError, CONFIG_FIELDS, fieldOptions, readCodexConfig, saveCodexConfig, userConfigLayer, type ConfigField, type ConfigRequest, type ConfigSnapshot } from '../lib/codex-config'
import type { Model } from '../../shared/protocol'
const props = defineProps<{ section: ConfigField['section']; title: string; request: ConfigRequest; models: Model[]; connected: boolean; deviceName?: string }>()
const snapshot = ref<ConfigSnapshot>(), changes = ref<Record<string, string>>({})
const loading = ref(false), saving = ref(false), error = ref(''), notice = ref(''), uncertain = ref(false)
let generation = 0
onBeforeUnmount(() => { generation++ })
const fields = computed(() => CONFIG_FIELDS.filter(field => field.section === props.section))
const writable = computed(() => !!snapshot.value && !!userConfigLayer(snapshot.value)?.version)
const dirty = computed(() => Object.keys(changes.value).length > 0)
const filePath = computed(() => snapshot.value && userConfigLayer(snapshot.value)?.name.file)
function baseline(key: string) { const value = snapshot.value?.config[key]; return typeof value === 'string' || typeof value === 'number' ? String(value) : '' }
function value(key: string) { return changes.value[key] ?? baseline(key) }
function change(key: string, next: string) { if (next === baseline(key)) delete changes.value[key]; else changes.value[key] = next; notice.value = '' }
function options(field: ConfigField) {
  if (!snapshot.value) return []
  const list = fieldOptions(field, snapshot.value, props.models, value('model'))
  const current = value(field.key)
  if (current && !list.some(option => option.value === current)) list.push({ value: current, label: current + '（当前值，不在可选列表中）', disabled: true })
  return list
}
function complex(field: ConfigField) { const current = snapshot.value?.config[field.key]; return current != null && typeof current === 'object' }
function source(field: ConfigField) {
  const origin = snapshot.value?.origins?.[field.key]?.name
  if (!origin || origin.type === 'user' && !origin.profile) return ''
  return '生效来源：' + ({ project: '项目配置', sessionFlags: '启动参数', system: '系统配置', enterpriseManaged: '组织策略', packagedDefaults: '内置默认' }[origin.type] || origin.profile || origin.type)
}
async function load() {
  if (!props.connected || saving.value) return
  const epoch = ++generation
  loading.value = true; error.value = ''; notice.value = ''
  try { const result = await readCodexConfig(props.request); if (epoch !== generation) return; snapshot.value = result; changes.value = {}; uncertain.value = false }
  catch (cause) { if (epoch === generation) { snapshot.value = undefined; error.value = cause instanceof Error ? cause.message : String(cause) } }
  finally { if (epoch === generation) loading.value = false }
}
async function save() {
  if (!snapshot.value || !dirty.value || saving.value || loading.value || uncertain.value) return
  const epoch = generation
  saving.value = true; error.value = ''; notice.value = ''
  try {
    const result = await saveCodexConfig(props.request, snapshot.value, changes.value, props.models)
    if (epoch !== generation) return
    changes.value = {}
    notice.value = result.status === 'okOverridden' ? '已保存，但部分设置被更高优先级配置覆盖。' : '已保存，新建 Codex 会话时生效。'
    try { const fresh = await readCodexConfig(props.request); if (epoch === generation) snapshot.value = fresh }
    catch { if (epoch === generation) { uncertain.value = true; error.value = '已保存，但未能重新读取配置，请刷新后继续修改。' } }
  } catch (cause) { if (epoch === generation) { uncertain.value = !(cause instanceof ConfigValidationError); error.value = (cause instanceof Error ? cause.message : String(cause)) + (uncertain.value ? ' 请刷新配置后检查。' : '') } }
  finally { if (epoch === generation) saving.value = false }
}
onMounted(load)
const canSave = computed(() => writable.value && dirty.value && !saving.value && !loading.value && !uncertain.value)
defineExpose({ save, canSave, saving, dirty, filePath, error, notice })
</script>
<template>
  <section class="codex-settings" :aria-label="title" :aria-busy="loading || saving">
    <div class="codex-settings-heading"><h3>{{ title }}</h3><span>{{ deviceName || '当前设备' }}</span><button type="button" class="icon-button small" aria-label="刷新 Codex 配置" title="重新读取" :disabled="!connected || loading || saving" @click="load"><PhArrowClockwise :size="16" :class="{ spinning: loading }" /></button></div>
    <p v-if="!connected" class="settings-state">连接设备后可读取和修改 Codex 设置。</p>
    <p v-else-if="loading" class="settings-state" role="status">正在读取 Codex 配置…</p>
    <template v-else-if="snapshot">
      <p v-if="!writable" class="settings-state">这台设备不允许从网页修改 Codex 配置，以下内容仅供查看。</p>
      <div class="codex-settings-rows">
        <div v-for="field in fields" :key="field.key" class="codex-setting-row">
          <div class="codex-setting-label"><span>{{ field.label }}</span><small v-if="source(field)">{{ source(field) }}</small></div>
          <span v-if="complex(field)" class="settings-state">自定义策略</span>
          <input v-else-if="field.kind === 'number'" type="number" min="1" step="1" inputmode="numeric" placeholder="默认" :aria-label="field.label" :value="value(field.key)" :disabled="!writable || saving || uncertain" @input="change(field.key, ($event.target as HTMLInputElement).value)" />
          <CustomSelect v-else :label="field.label" placeholder="未设置" :model-value="value(field.key)" :options="options(field)" :disabled="!writable || saving || uncertain" @update:model-value="change(field.key, $event)" />
        </div>
      </div>
      <p v-if="section === '执行'" class="settings-hint">完全访问允许在沙箱外执行操作；从不请求审批不会自动授予更多权限。</p>
      <p v-if="section === '上下文'" class="settings-hint">留空使用模型默认值；填写数值不会扩展模型实际支持的上下文容量。</p>
    </template>
  </section>
</template>
<style scoped>
/* Mirrors the flat .settings-section rhythm of the website settings panes. */
.codex-settings { padding: 20px 0; }
.codex-settings-heading { display: flex; align-items: center; gap: 8px; margin: 0 0 4px; }
.codex-settings-heading h3 { flex: 1; margin: 0; font-size: calc(14px * var(--ui-font-scale, 1)); font-weight: 600; }
.codex-settings-heading > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: calc(12px * var(--ui-font-scale, 1)); }
.settings-hint { margin: 12px 0 0; color: var(--muted); font-size: calc(12px * var(--ui-font-scale, 1)); line-height: 1.6; }
.codex-setting-row { display: flex; align-items: center; justify-content: space-between; gap: 24px; min-height: 64px; padding: 10px 0; }
.codex-setting-row + .codex-setting-row { border-top: 1px solid var(--line-soft); }
.codex-setting-label { min-width: 0; font-size: calc(14px * var(--ui-font-scale, 1)); color: var(--ink); }
.codex-setting-label small { display: block; margin-top: 4px; font-size: calc(12px * var(--ui-font-scale, 1)); color: var(--muted); }
.codex-setting-row :deep(.custom-select) { min-width: 0; max-width: 55%; }
.codex-setting-row :deep(.custom-select-trigger) { width: 100%; gap: 8px; font-size: calc(13px * var(--ui-font-scale, 1)); }
.codex-setting-row :deep(.custom-select-trigger > span) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.codex-setting-row :deep(.custom-select-menu) { max-height: 250px; overflow-y: auto; }
.codex-setting-row input { width: 160px; max-width: 50%; padding: 0 12px; min-height: 44px; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); color: var(--ink); }
.codex-setting-row input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.settings-state { color: var(--muted); font-size: calc(13px * var(--ui-font-scale, 1)); line-height: 1.7; }
@media (max-width: 560px) { .codex-setting-row { gap: 12px; flex-wrap: wrap; } .codex-setting-row :deep(.custom-select) { max-width: 100%; } }
</style>
