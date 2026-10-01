<script setup lang="ts">
import { ref } from 'vue'
import { PhArrowRight, PhDownloadSimple } from '@phosphor-icons/vue'
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
  <Transition name="toast">
    <div v-if="available" class="update-toast" role="status">
      <button class="icon-button small update-toast-button" type="button" :disabled="updating" :aria-label="updating ? '正在更新应用' : '新版本可用，点击更新应用'" :aria-describedby="updating ? undefined : 'update-toast-tooltip'" :aria-busy="updating" title="新版本可用 · 点击更新" @click="apply">
        <span v-if="updating" class="spinner" /><PhDownloadSimple v-else :size="19" />
      </button>
      <div id="update-toast-tooltip" class="update-toast-tooltip" role="tooltip"><span class="update-toast-copy"><strong>新版本可用</strong><span>{{ updating ? '正在更新…' : '点击更新' }}</span></span><PhArrowRight v-if="!updating" :size="17" aria-hidden="true" /></div>
    </div>
  </Transition>
</template>
<style scoped>
.update-toast { position: relative; flex: 0 0 auto; z-index: 20; }
.update-toast-button { color: var(--accent); }
.update-toast-button:hover:not(:disabled), .update-toast-button:focus-visible { background: var(--hover); color: var(--ink); }
.update-toast-button:disabled { opacity: 1; cursor: default; }
.update-toast-button > svg, .update-toast .spinner { flex-shrink: 0; }
.update-toast-tooltip { position: absolute; top: calc(100% + 8px); right: 0; z-index: 30; display: flex; align-items: center; gap: 12px; min-width: 164px; padding: 10px 12px; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); box-shadow: var(--shadow-pop); color: var(--ink); opacity: 0; visibility: hidden; transform: translateY(-4px); transition: opacity 140ms var(--ease), transform 140ms var(--ease), visibility 140ms; pointer-events: none; }
.update-toast:hover .update-toast-tooltip, .update-toast:focus-within .update-toast-tooltip { opacity: 1; visibility: visible; transform: translateY(0); }
.update-toast-copy { display: grid; gap: 2px; font-size: calc(12px * var(--ui-font-scale, 1)); line-height: 1.5; }
.update-toast-copy strong { font-size: calc(13px * var(--ui-font-scale, 1)); font-weight: 550; }
.update-toast-copy > span { color: var(--accent); }
@media (max-width: 760px) { .update-toast-tooltip { right: 0; max-width: calc(100vw - 24px); } }
</style>
