<script setup lang="ts">
import { ref } from 'vue'
import { PhDownloadSimple } from '@phosphor-icons/vue'
const props = defineProps<{ available: boolean; update: () => Promise<void> }>()
const emit = defineEmits<{ error: [message: string] }>()
const updating = ref(false)
async function apply() {
  if (!props.available || updating.value) return
  updating.value = true
  try { await props.update() }
  catch { emit('error', '更新失败，请稍后点击重试。') }
  finally { updating.value = false }
}
</script>
<template>
  <div v-if="available" class="update-banner" role="status">
    <PhDownloadSimple :size="18" aria-hidden="true" />
    <span>{{ updating ? '正在更新应用…' : '新版本可用。' }}</span>
    <button class="text-button update-banner-button" type="button" :disabled="updating" :aria-busy="updating" @click="apply"><span v-if="updating" class="spinner" />{{ updating ? '正在更新…' : '更新' }}</button>
  </div>
</template>
<style scoped>
.update-banner > span { flex: 1; overflow-wrap: anywhere; }
.update-banner > svg { flex-shrink: 0; }
.update-banner-button { flex-shrink: 0; gap: var(--space-2); padding: var(--space-2) var(--space-3); min-height: 36px; color: inherit; }
</style>
