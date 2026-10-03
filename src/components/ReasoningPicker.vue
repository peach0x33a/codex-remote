<script setup lang="ts">
import { computed, ref } from 'vue'
import { PhArrowCounterClockwise, PhCaretDown, PhLightning } from '@phosphor-icons/vue'
import ComposerPopover from './ComposerPopover.vue'
import EffortSlider from './EffortSlider.vue'
import type { Model, ModelServiceTier } from '../../shared/protocol'
const props = defineProps<{ modelValue: string; model?: Model; serviceTier?: string | null; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: string]; 'update:serviceTier': [value: string | null] }>()
const popover = ref<InstanceType<typeof ComposerPopover>>()
const serviceTiers = computed<ModelServiceTier[]>(() => props.model?.serviceTiers?.length ? props.model.serviceTiers : (props.model?.additionalSpeedTiers || []).map(id => ({ id, name: id })))
const fastTier = computed(() => serviceTiers.value.find(tier => tier.id === 'priority') || serviceTiers.value.find(tier => tier.id === 'fast'))
const fastEnabled = computed(() => (props.serviceTier === undefined ? props.model?.defaultServiceTier : props.serviceTier) === fastTier.value?.id && !!fastTier.value)
function toggleFast() { if (!props.disabled && fastTier.value) emit('update:serviceTier', fastEnabled.value ? null : fastTier.value.id) }
defineExpose({ show: () => popover.value?.show() })
const names: Record<string, [string, string]> = { none: ['即时', '直接回答，无需额外推理'], minimal: ['极速', '快速处理轻量任务'], low: ['轻度', '快速响应，适合日常任务'], medium: ['标准', '平衡思考深度与响应速度'], high: ['深度', '花更多时间推理复杂问题'], xhigh: ['超高', '充分推理，适合高难度任务'], max: ['Max', '投入更多计算处理最复杂的任务'], ultra: ['Ultra', '最高强度，使用额度消耗更快'] }
const options = computed(() => (props.model?.supportedReasoningEfforts || []).map(o => ({ value: o.reasoningEffort, label: names[o.reasoningEffort]?.[0] || o.reasoningEffort, description: names[o.reasoningEffort]?.[1] || o.description })))
const selected = computed(() => props.modelValue || props.model?.defaultReasoningEffort || options.value[0]?.value || '')
const current = computed(() => options.value.find(o => o.value === selected.value))
</script>
<template>
  <ComposerPopover ref="popover" label="思考强度" trigger-class="reasoning-trigger" align="end" :width="280" :disabled="disabled || (options.length < 2 && !fastTier)">
    <template #trigger><PhLightning v-if="fastEnabled" class="service-tier-mark" :size="13" weight="fill" aria-hidden="true" /><span>{{ current?.label || '思考' }}</span><span v-if="fastEnabled" class="sr-only">，快速模式已开启</span><PhCaretDown :size="12" /></template>
    <div class="model-power">
      <div class="model-power-heading">
        <button v-if="fastTier" type="button" class="icon-button small service-tier-trigger" :class="{ selected: fastEnabled }" aria-label="快速模式" :title="fastEnabled ? '关闭快速模式' : '开启快速模式'" :aria-pressed="fastEnabled" :disabled="disabled" @click="toggleFast"><PhLightning :size="18" :weight="fastEnabled ? 'fill' : 'regular'" aria-hidden="true" /></button>
        <span class="model-power-effort">{{ current?.label || '思考' }}</span>
        <button v-if="modelValue" type="button" class="icon-button small model-reset" aria-label="重置为默认强度" @click="emit('update:modelValue', '')"><PhArrowCounterClockwise :size="16" /></button>
      </div>
      <p class="model-description">{{ current?.description }}</p>
      <EffortSlider v-if="options.length" :model-value="selected" :options="options" @update:model-value="emit('update:modelValue', $event)" @done="popover?.hide()" />
    </div>
  </ComposerPopover>
</template>

<style scoped>
.service-tier-trigger { position: absolute; left: -3px; }
.service-tier-trigger.selected { color: var(--accent); }
:global(.reasoning-trigger .service-tier-mark) { color: var(--accent); }
@media (pointer: coarse) { .model-power-heading { min-height: 44px; } .service-tier-trigger { min-width: 44px; min-height: 44px; } }
</style>
