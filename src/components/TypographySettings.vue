<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import CustomSelect from './CustomSelect.vue'
import ValueSlider from './ValueSlider.vue'
import { DEFAULT_TYPOGRAPHY } from '../lib/typography'
import type { TypographyControls } from '../composables/useTypography'
const props = defineProps<{ controls: TypographyControls }>()
const settings = computed(() => props.controls.preferences.value)
const customUi = ref(false), customCode = ref(false), uiDraft = ref(''), codeDraft = ref('')
const uiOptions = [{ value: '', label: '默认字体' }, { value: 'system-ui', label: '系统字体' }, { value: 'Noto Sans CJK SC', label: '思源黑体' }, { value: 'Microsoft YaHei', label: '微软雅黑' }, { value: 'serif', label: '衬线字体' }, { value: '__custom__', label: '自定义' }]
const codeOptions = [{ value: '', label: '默认等宽字体' }, { value: 'JetBrains Mono', label: 'JetBrains Mono' }, { value: 'Cascadia Code', label: 'Cascadia Code' }, { value: 'Fira Code', label: 'Fira Code' }, { value: 'Source Code Pro', label: 'Source Code Pro' }, { value: '__custom__', label: '自定义' }]
const uiChoice = computed(() => customUi.value || !uiOptions.some(option => option.value === settings.value.uiFont) ? '__custom__' : settings.value.uiFont)
const codeChoice = computed(() => customCode.value || !codeOptions.some(option => option.value === settings.value.codeFont) ? '__custom__' : settings.value.codeFont)
watch(() => settings.value.uiFont, value => { uiDraft.value = value }, { immediate: true })
watch(() => settings.value.codeFont, value => { codeDraft.value = value }, { immediate: true })
function choose(kind: 'ui' | 'code', value: string) {
  if (kind === 'ui') customUi.value = value === '__custom__'; else customCode.value = value === '__custom__'
  if (value !== '__custom__') props.controls.update(kind === 'ui' ? { uiFont: value } : { codeFont: value })
}
function commit(kind: 'ui' | 'code') { props.controls.update(kind === 'ui' ? { uiFont: uiDraft.value } : { codeFont: codeDraft.value }); uiDraft.value = settings.value.uiFont; codeDraft.value = settings.value.codeFont }
function reset() { customUi.value = false; customCode.value = false; props.controls.update({ ...DEFAULT_TYPOGRAPHY }) }
</script>
<template>
  <section class="typography-settings" aria-label="字体与字号">
    <h3>字体与字号</h3>
    <div class="font-group">
      <div class="font-row"><h4>UI 字体</h4><CustomSelect label="UI 字体" :model-value="uiChoice" :options="uiOptions" @update:model-value="choose('ui', $event)" /></div>
      <label v-if="uiChoice === '__custom__'" class="font-custom">字体名称<input v-model="uiDraft" aria-label="自定义 UI 字体" placeholder="例如：Noto Sans CJK SC" maxlength="160" @change="commit('ui')" @keydown.enter.prevent="commit('ui')" /></label>
      <ValueSlider label="UI 字号" :model-value="settings.uiSize" :min="12" :max="20" unit="px" @preview="controls.previewSize('uiSize', $event)" @update:model-value="controls.update({ uiSize: $event })" />
      <p class="ui-font-preview">界面文字预览 · Codex Remote 0123456789</p>
    </div>
    <div class="font-group">
      <div class="font-row"><h4>代码块字体</h4><CustomSelect label="代码块字体" :model-value="codeChoice" :options="codeOptions" @update:model-value="choose('code', $event)" /></div>
      <label v-if="codeChoice === '__custom__'" class="font-custom">字体名称<input v-model="codeDraft" aria-label="自定义代码块字体" placeholder="例如：JetBrains Mono" maxlength="160" @change="commit('code')" @keydown.enter.prevent="commit('code')" /></label>
      <ValueSlider label="代码块字号" :model-value="settings.codeSize" :min="10" :max="24" unit="px" @preview="controls.previewSize('codeSize', $event)" @update:model-value="controls.update({ codeSize: $event })" />
      <pre class="code-font-preview"><code>const message = '代码预览';
console.log(message, 1234567890);</code></pre>
    </div>
    <p class="font-note">使用本机已安装的字体；未安装时回退到默认字体。</p>
    <button type="button" class="text-button" @click="reset">重置字体设置</button>
  </section>
</template>
<style scoped>
.typography-settings { padding: 24px 0; }
.typography-settings h3 { margin: 0 0 20px; font-size: calc(20px * var(--ui-font-scale, 1)); font-weight: 600; color: var(--ink); }
.font-group { min-width: 0; padding: 16px 0; }
.font-group + .font-group { border-top: 1px solid var(--line-soft); }
.font-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
.font-row h4 { font-size: calc(14px * var(--ui-font-scale, 1)); font-weight: 500; margin: 0; }
.font-row :deep(.custom-select) { max-width: 70%; min-width: 0; }
.font-row :deep(.custom-select-trigger) { max-width: 100%; }
.font-row :deep(.custom-select-trigger > span) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.font-custom { display: grid; gap: 6px; margin: 0 0 16px; color: var(--muted); font-size: calc(12px * var(--ui-font-scale, 1)); }
.font-custom input { width: 100%; min-height: 40px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface); color: var(--ink); padding: 8px 10px; }
.ui-font-preview { margin: 10px 0 0; font-size: calc(14px * var(--ui-font-scale, 1)); color: var(--ink-soft); line-height: 1.7; overflow-wrap: anywhere; }
.code-font-preview { margin: 10px 0 0; background: var(--sidebar); }
.font-note { margin: 16px 0 8px; color: var(--muted); font-size: calc(12px * var(--ui-font-scale, 1)); line-height: 1.6; }
</style>
