<script setup lang="ts">
import { computed } from 'vue'
import { PhArrowClockwise, PhWarningCircle } from '@phosphor-icons/vue'
import { turnFailureMessage, type TurnFailureInfo } from '../lib/turn-failure'

const props = withDefaults(defineProps<{ failure: TurnFailureInfo | null; loading?: boolean; disabled?: boolean; retryable?: boolean; autoRetryStatus?: string; autoRetryPending?: boolean }>(), { loading: false, disabled: false, retryable: true })
const emit = defineEmits<{ retry: []; cancelAutoRetry: [] }>()
const message = computed(() => turnFailureMessage(props.failure))
const details = computed(() => props.failure?.additionalDetails?.trim() || undefined)
function retry() { if (props.retryable && message.value && !props.loading && !props.disabled) emit('retry') }
</script>

<template>
  <div v-if="message" class="turn-failure" :aria-busy="loading">
    <span class="turn-failure-description" role="status" aria-live="polite" aria-atomic="true">
      <PhWarningCircle class="turn-failure-icon" :size="16" aria-hidden="true" />
      <span class="turn-failure-message" :title="details">{{ message }}</span>
    </span>
    <div class="turn-failure-actions"><span v-if="autoRetryStatus" class="turn-failure-auto" role="status">{{ autoRetryStatus }}</span><button v-if="autoRetryPending" type="button" class="turn-failure-retry" @click="emit('cancelAutoRetry')">取消自动重试</button><button v-if="retryable" type="button" class="turn-failure-retry" :disabled="loading || disabled" @click="retry"><PhArrowClockwise :size="14" aria-hidden="true" />{{ loading ? '重试中…' : '重试' }}</button></div>
  </div>
</template>

<style scoped>
.turn-failure { display: flex; align-items: flex-start; flex-wrap: wrap; gap: 4px 10px; min-width: 0; font-size: calc(13px * var(--ui-font-scale, 1)); line-height: 1.65; }
.turn-failure-description { display: flex; align-items: flex-start; flex: 1 1 200px; min-width: 0; gap: 7px; color: var(--muted); }
.turn-failure-icon { flex: 0 0 auto; margin-top: 3px; color: var(--danger); }
.turn-failure-actions { display: flex; align-items: center; flex-wrap: wrap; justify-content: flex-end; gap: var(--space-2); margin-left: auto; }
.turn-failure-auto { color: var(--muted); font-size: calc(12px * var(--ui-font-scale, 1)); }
.turn-failure-message { min-width: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.turn-failure-retry { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; gap: 4px; min-height: 28px; margin-top: -3px; padding: 2px 5px; border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--muted); font: inherit; cursor: pointer; }
.turn-failure-retry:hover:not(:disabled) { color: var(--ink); background: var(--hover); }
.turn-failure-retry:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.turn-failure-retry:disabled { opacity: .5; cursor: default; }
@media (max-width: 760px) { .turn-failure { flex-direction: column; align-items: stretch; }.turn-failure-description { flex: 0 1 auto; width: 100%; }.turn-failure-actions { align-self: flex-end; }.turn-failure-retry { margin-top: 0; } }
@media (pointer: coarse) { .turn-failure-retry { min-height: 44px; margin-top: 0; padding-inline: 8px; } }
</style>
