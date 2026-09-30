<script setup lang="ts">
import { computed, ref } from 'vue'
import { PhCheck, PhHand, PhLockSimple, PhShieldCheck, PhSlidersHorizontal, PhSparkle, PhWarningCircle } from '@phosphor-icons/vue'
import ComposerPopover from './ComposerPopover.vue'
import BaseDialog from './BaseDialog.vue'
import type { PermissionMode } from '../lib/permissions'
const props = defineProps<{ modelValue: PermissionMode; disabled?: boolean; unavailable: Partial<Record<PermissionMode, string>> }>()
const emit = defineEmits<{ 'update:modelValue': [value: PermissionMode] }>()
const popover = ref<InstanceType<typeof ComposerPopover>>()
defineExpose({ show: () => popover.value?.show() })
const confirmFull = ref(false)
const options = [
  { value: 'ask' as const, label: '请求批准', short: '请求批准', description: '编辑外部文件和使用互联网时始终询问', icon: PhHand },
  { value: 'auto' as const, label: '帮我批准', short: '帮我批准', description: '仅对检测到的风险操作请求批准', icon: PhShieldCheck },
  { value: 'full' as const, label: '完全访问权限', short: '完全访问', description: '可不受限制地访问互联网和你电脑上的任何文件', icon: PhSparkle },
  { value: 'readOnly' as const, label: '只读', short: '只读', description: '仅查看文件，修改与外部访问需要批准', icon: PhLockSimple },
]
const selected = computed(() => options.find(o => o.value === props.modelValue))
function choose(value: PermissionMode) { popover.value?.hide(); if (value === 'full' && props.modelValue !== 'full') confirmFull.value = true; else emit('update:modelValue', value) }
function confirm() { emit('update:modelValue', 'full'); confirmFull.value = false }
</script>
<template>
  <ComposerPopover ref="popover" label="更改权限" trigger-class="permission-trigger" :width="360" :disabled="disabled">
    <template #trigger><component :is="selected?.icon || PhSlidersHorizontal" :size="16" /><span>{{ selected?.short || '自定义' }}</span></template>
    <div class="permission-heading"><span>应如何批准 Codex 操作？</span><a href="https://learn.chatgpt.com/docs/permission-modes" target="_blank" rel="noopener noreferrer">了解更多</a></div>
    <div role="menu" aria-label="权限模式">
      <template v-for="option in options" :key="option.value">
        <div v-if="option.value === 'readOnly'" class="menu-separator" />
        <button type="button" class="composer-menu-item permission-option" role="menuitemradio" :aria-checked="modelValue === option.value" :disabled="!!unavailable[option.value]" @click="choose(option.value)"><component :is="option.icon" :size="18" /><span><strong>{{ option.label }}</strong><small>{{ unavailable[option.value] || option.description }}</small></span><PhCheck v-if="modelValue === option.value" :size="17" /></button>
      </template>
      <div v-if="modelValue === 'custom'" class="composer-menu-item permission-option"><PhSlidersHorizontal :size="18" /><span><strong>自定义 (config.toml)</strong><small>沿用该会话在服务器上的权限配置</small></span><PhCheck :size="17" /></div>
    </div>
  </ComposerPopover>
  <BaseDialog :open="confirmFull" title="允许完全访问？" description="Codex 将不再请求你的批准。" @close="confirmFull = false">
    <div class="permission-confirm"><PhWarningCircle :size="24" /><p>可读取、修改或删除电脑上的文件，运行命令并访问网络。这可能造成数据丢失或敏感信息泄露。</p></div>
    <div class="dialog-actions"><span class="spacer" /><button type="button" class="button secondary" @click="confirmFull = false">取消</button><button type="button" class="button primary" @click="confirm">确认开启</button></div>
  </BaseDialog>
</template>
