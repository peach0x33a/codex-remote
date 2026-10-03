<script setup lang="ts">
import { onUnmounted, ref } from 'vue'
import { PhDownloadSimple, PhUploadSimple } from '@phosphor-icons/vue'
const props = defineProps<{ exportSettings: () => Promise<Blob>; importSettings: (file: File) => Promise<void>; disabled: boolean }>()
const input = ref<HTMLInputElement>(), busy = ref(false), error = ref(''), notice = ref('')
const urls = new Set<string>()
onUnmounted(() => { for (const url of urls) URL.revokeObjectURL(url) })
async function exportFile() {
  if (busy.value || props.disabled) return
  busy.value = true; error.value = ''; notice.value = ''
  try {
    const blob = await props.exportSettings(), url = URL.createObjectURL(blob)
    urls.add(url)
    const link = document.createElement('a'); link.href = url; link.download = 'codex-remote-appearance.json'
    document.body.append(link); link.click(); link.remove()
    setTimeout(() => { URL.revokeObjectURL(url); urls.delete(url) }, 30_000)
    notice.value = '外观设置已导出。'
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '导出失败，请重试。' }
  finally { busy.value = false }
}
async function importFile(event: Event) {
  const target = event.target as HTMLInputElement, file = target.files?.[0]; target.value = ''
  if (!file || busy.value || props.disabled) return
  busy.value = true; error.value = ''; notice.value = ''
  try { await props.importSettings(file); notice.value = '外观设置已导入并应用。' }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '导入失败，请重试。' }
  finally { busy.value = false }
}
</script>
<template>
  <div class="appearance-transfer" :aria-busy="busy">
    <h3>导入与导出</h3>
    <p>包含背景图片或图片地址、字体名称与字号、主题、内容宽度和换行设置。导入后替换当前外观。</p>
    <div class="appearance-transfer-actions">
      <button type="button" class="button secondary" :disabled="busy || disabled" @click="exportFile"><PhDownloadSimple :size="17" />导出外观设置</button>
      <button type="button" class="button secondary" :disabled="busy || disabled" @click="input?.click()"><PhUploadSimple :size="17" />导入外观设置</button>
    </div>
    <input ref="input" class="sr-only" type="file" aria-label="导入外观设置文件" accept=".json,application/json" tabindex="-1" :disabled="busy || disabled" @change="importFile" />
    <p v-if="error" class="appearance-transfer-error" role="alert">{{ error }}</p>
    <p v-else-if="notice" role="status">{{ notice }}</p>
  </div>
</template>
<style scoped>
h3 { margin: 0 0 12px; font-size: calc(14px * var(--ui-font-scale, 1)); font-weight: 600; }
p { margin: 0 0 12px; color: var(--muted); font-size: calc(12px * var(--ui-font-scale, 1)); line-height: 1.7; overflow-wrap: anywhere; }
.appearance-transfer-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.appearance-transfer-actions .button { min-height: 44px; padding-inline: 14px; }
.appearance-transfer-actions + input + p { margin: 12px 0 0; }
.appearance-transfer-error { color: var(--danger); }
</style>
