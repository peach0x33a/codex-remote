<script setup lang="ts">
import { ref } from 'vue'
import { PhArrowRight, PhDownloadSimple } from '@phosphor-icons/vue'
const props = defineProps<{ available: boolean; blocked: boolean; update: () => Promise<void> }>()
const emit = defineEmits<{ error: [message: string] }>()
const updating = ref(false)
async function apply() {
  if (!props.available || props.blocked || updating.value) return
  updating.value = true
  try { await props.update() }
  catch { emit('error', '更新失败，请稍后点击重试。') }
  finally { updating.value = false }
}
</script>
<template>
  <Transition name="toast">
    <div v-if="available" class="update-toast" role="status">
      <button type="button" :disabled="blocked || updating" :aria-label="updating ? '正在更新应用' : blocked ? '新版本可用，任务结束后可更新' : '新版本可用，点击更新应用'" :aria-busy="updating" @click="apply">
        <span v-if="updating" class="spinner" /><PhDownloadSimple v-else :size="19" />
        <span class="update-toast-copy"><strong>新版本可用</strong><span>{{ updating ? '正在更新…' : blocked ? '任务结束后可更新' : '点击更新' }}</span></span>
        <PhArrowRight v-if="!blocked && !updating" :size="17" />
      </button>
    </div>
  </Transition>
</template>
<style scoped>
.update-toast { position: fixed; top: max(72px, calc(env(safe-area-inset-top) + 64px)); right: max(20px, env(safe-area-inset-right)); z-index: 15; max-width: calc(100vw - 32px); border-radius: var(--radius-lg); background: var(--surface); box-shadow: var(--shadow-pop); color: var(--ink); overflow: hidden; }
.update-toast > button { display: flex; align-items: center; gap: 12px; padding: 12px 16px; width: 100%; min-height: 48px; text-align: left; color: inherit; transition: background-color 160ms ease; }
.update-toast > button:hover:not(:disabled) { background: var(--hover); }
.update-toast > button:focus-visible { outline-offset: -3px; }
.update-toast > button:disabled { opacity: 1; cursor: default; }
.update-toast > button > svg, .update-toast .spinner { flex-shrink: 0; color: var(--accent); }
.update-toast-copy { display: grid; gap: 2px; font-size: 12px; line-height: 1.5; }
.update-toast-copy strong { font-size: 13px; font-weight: 550; }
.update-toast-copy > span { color: var(--accent); }
.update-toast > button:disabled .update-toast-copy > span { color: var(--muted); }
@media (max-width: 760px) { .update-toast { right: max(12px, env(safe-area-inset-right)); } }
</style>
