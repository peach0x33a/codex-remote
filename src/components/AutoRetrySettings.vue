<script setup lang="ts">
import { RETRY_ATTEMPT_OPTIONS, RETRY_CATEGORIES, RETRY_DELAY_OPTIONS, type AutoRetryPreferences, type RetryCategory } from '../lib/auto-retry'
import ToggleSwitch from './ToggleSwitch.vue'
import CustomSelect from './CustomSelect.vue'
const props = defineProps<{ preferences: AutoRetryPreferences; error?: string }>()
const emit = defineEmits<{ update: [patch: Partial<AutoRetryPreferences>] }>()
function toggleCategory(category: RetryCategory, enabled: boolean) {
  emit('update', { categories: enabled ? [...props.preferences.categories, category] : props.preferences.categories.filter(item => item !== category) })
}
const delays = RETRY_DELAY_OPTIONS.map(value => ({ value: String(value), label: value + ' 秒' }))
const attempts = RETRY_ATTEMPT_OPTIONS.map(value => ({ value: String(value), label: value + ' 次' }))
</script>
<template>
  <section class="auto-retry-settings" aria-label="失败与重试">
    <h3>失败与重试</h3>
    <div class="auto-retry-row"><div><span>自动重试</span><p>选中的错误终止请求后，自动发送“继续”。手动停止保持停止。</p></div><ToggleSwitch label="自动重试" :model-value="preferences.enabled" @update:model-value="emit('update', { enabled: $event })" /></div>
    <div class="auto-retry-row"><span>重试间隔</span><CustomSelect label="重试间隔" :model-value="String(preferences.delaySeconds)" :options="delays" @update:model-value="emit('update', { delaySeconds: Number($event) })" /></div>
    <div class="auto-retry-row"><div><span>最多自动重试</span><p>连续失败达到上限后，等待你手动处理。</p></div><CustomSelect label="最多自动重试" :model-value="String(preferences.maxAttempts)" :options="attempts" @update:model-value="emit('update', { maxAttempts: Number($event) })" /></div>
    <h4>错误类别</h4>
    <div v-for="category in RETRY_CATEGORIES" :key="category.id" class="auto-retry-row"><div><span>{{ category.label }}</span><p>{{ category.detail }}</p></div><ToggleSwitch :label="'自动重试：' + category.label" :model-value="preferences.categories.includes(category.id)" @update:model-value="toggleCategory(category.id, $event)" /></div>
    <p v-if="preferences.enabled && !preferences.categories.length" class="auto-retry-note" role="status">请至少选择一种错误类别。</p>
    <p class="auto-retry-note">设置保存在当前浏览器。保持页面打开，当前会话连接正常时生效；沿用当前会话的模型与权限。</p>
    <p v-if="error" class="auto-retry-error" role="alert">{{ error }}</p>
  </section>
</template>
<style scoped>
.auto-retry-settings { padding: var(--space-6) 0; }
.auto-retry-settings h3 { margin: 0 0 var(--space-4); color: var(--ink); font-size: calc(20px * var(--ui-font-scale, 1)); font-weight: 600; }
.auto-retry-settings h4 { margin: var(--space-6) 0 var(--space-2); color: var(--muted); font-size: calc(13px * var(--ui-font-scale, 1)); font-weight: 500; }
.auto-retry-row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); min-height: 64px; padding: var(--space-3) 0; border-bottom: 1px solid var(--line-soft); }
.auto-retry-row > div:first-child { min-width: 0; }
.auto-retry-row span { color: var(--ink); font-size: calc(14px * var(--ui-font-scale, 1)); }
.auto-retry-row p, .auto-retry-note, .auto-retry-error { margin: var(--space-1) 0 0; color: var(--muted); font-size: calc(12px * var(--ui-font-scale, 1)); line-height: 1.65; overflow-wrap: anywhere; }
.auto-retry-row :deep(.custom-select) { flex-shrink: 0; }
.auto-retry-note { margin-top: var(--space-4); }
.auto-retry-error { color: var(--danger); margin-top: var(--space-3); }
</style>
