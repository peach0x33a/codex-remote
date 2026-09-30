<script setup lang="ts">
import { computed, ref } from 'vue'
import { PhCaretDown, PhCheck } from '@phosphor-icons/vue'
import ComposerPopover from './ComposerPopover.vue'
import type { Model } from '../../shared/protocol'
const props = defineProps<{ modelValue: string; models: Model[]; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const popover = ref<InstanceType<typeof ComposerPopover>>()
const current = computed(() => props.models.find(m => m.model === props.modelValue) || (!props.modelValue ? props.models.find(m => m.isDefault) || props.models[0] : undefined))
const label = computed(() => (current.value?.displayName || props.modelValue || '选择模型').replace(/^GPT-/, ''))
function choose(value: string) { emit('update:modelValue', value); popover.value?.hide() }
defineExpose({ show: () => popover.value?.show() })
</script>
<template>
  <ComposerPopover ref="popover" label="选择模型" trigger-class="model-trigger" align="end" :width="304" :disabled="disabled || !models.length">
    <template #trigger><span class="model-trigger-name">{{ label }}</span><PhCaretDown :size="12" /></template>
    <div class="model-list" role="menu" aria-label="可用模型"><div class="model-list-heading">选择模型</div><button class="composer-menu-item" role="menuitemradio" type="button" :aria-checked="!modelValue" @click="choose('')"><span><strong>默认</strong><small>使用服务器推荐模型</small></span><PhCheck v-if="!modelValue" :size="17" /></button><div class="menu-separator" /><button v-for="m in models" :key="m.id" class="composer-menu-item" role="menuitemradio" type="button" :aria-checked="modelValue === m.model" @click="choose(m.model)"><span><strong>{{ m.displayName || m.model }}</strong><small v-if="m.description">{{ m.description }}</small></span><PhCheck v-if="modelValue === m.model" :size="17" /></button></div>
  </ComposerPopover>
</template>
