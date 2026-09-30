<script setup lang="ts">
import { nextTick, ref, useId } from 'vue'
import { PhSlidersHorizontal, PhCheck, PhSun, PhMoon, PhDesktop } from '@phosphor-icons/vue'
import type { BackgroundMode, ImageBackgroundSettings, ThemePreference } from '../lib/ui-preferences'
import BackgroundSettings from './BackgroundSettings.vue'
import BaseDialog from './BaseDialog.vue'
defineProps<{ modelValue: number; theme: ThemePreference; autoConnect: boolean; backgroundMode: BackgroundMode; imageBackground: ImageBackgroundSettings; backgroundUrl: string; backgroundName: string; backgroundBusy: boolean; backgroundError: string }>()
const emit = defineEmits<{ 'update:modelValue': [width: number]; 'update:theme': [theme: ThemePreference]; 'update:autoConnect': [enabled: boolean]; 'update:backgroundMode': [mode: BackgroundMode]; 'update:imageBackground': [value: ImageBackgroundSettings]; uploadBackground: [file: File]; removeBackground: [] }>()
const options = [{ value: 840, label: '紧凑' }, { value: 1080, label: '舒适' }, { value: 1280, label: '宽屏' }, { value: 0, label: '铺满窗口' }]
const themes = [{ value: 'light', label: '浅色', icon: PhSun }, { value: 'dark', label: '暗色', icon: PhMoon }, { value: 'system', label: '跟随系统', icon: PhDesktop }] as const
const open = ref(false), trigger = ref<HTMLButtonElement>()
const dialogId = useId()
defineExpose({ show: () => { open.value = true } })
async function close() {
  open.value = false
  // BaseDialog closes its native dialog after its own nextTick.
  await nextTick(); await nextTick()
  if (!open.value) trigger.value?.focus()
}
function navigateOptions(event: KeyboardEvent) {
  const target = event.target
  if (!(target instanceof HTMLElement) || target.getAttribute('role') !== 'menuitemradio') return
  const choices = [...(target.closest('[role="menu"]')?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]:not(:disabled)') || [])]
  if (!choices.length) return
  const index = choices.indexOf(target as HTMLButtonElement)
  const next: Record<string, number> = { ArrowRight: (index + 1) % choices.length, ArrowDown: (index + 1) % choices.length, ArrowLeft: (index - 1 + choices.length) % choices.length, ArrowUp: (index - 1 + choices.length) % choices.length, Home: 0, End: choices.length - 1 }
  if (event.key in next) { event.preventDefault(); choices[next[event.key]]?.focus() }
}
</script>
<template>
  <button ref="trigger" type="button" class="composer-control display-settings-trigger" :class="{ 'is-open': open }" aria-label="设置" title="设置" aria-haspopup="dialog" :aria-expanded="open" :aria-controls="dialogId" @click="open = true" @keydown.down.prevent="open = true"><PhSlidersHorizontal :size="18" /></button>
  <Teleport to="body">
    <BaseDialog :id="dialogId" class="display-settings-dialog" :open="open" title="设置" aria-label="设置" @close="close">
      <div class="settings-body" @keydown="navigateOptions">
        <section class="settings-section" :aria-labelledby="dialogId + '-connection'">
          <div class="settings-heading"><h3 :id="dialogId + '-connection'">连接</h3></div>
          <div class="settings-toggle-row">
            <div><label :for="dialogId + '-auto-connect'">自动连接</label><p :id="dialogId + '-auto-connect-description'">打开页面时连接上次使用的设备</p></div>
            <button :id="dialogId + '-auto-connect'" type="button" class="settings-switch" role="switch" aria-label="自动连接" :aria-checked="autoConnect" :aria-describedby="dialogId + '-auto-connect-description'" @click="emit('update:autoConnect', !autoConnect)"><span aria-hidden="true" /></button>
          </div>
        </section>
        <section class="settings-section" :aria-labelledby="dialogId + '-appearance'">
          <div class="settings-heading"><h3 :id="dialogId + '-appearance'">外观</h3></div>
          <div class="theme-options" role="menu" aria-label="颜色主题">
            <button v-for="option in themes" :key="option.value" type="button" class="composer-menu-item" role="menuitemradio" :aria-checked="theme === option.value" @click="emit('update:theme', option.value)"><component :is="option.icon" :size="16" /><span>{{ option.label }}</span><PhCheck v-if="theme === option.value" :size="16" /></button>
          </div>
        </section>
        <section class="settings-section" aria-label="背景">
          <BackgroundSettings :model-value="backgroundMode" :image-settings="imageBackground" @update:image-settings="emit('update:imageBackground', $event)" :src="backgroundUrl" :name="backgroundName" :busy="backgroundBusy" :error="backgroundError" @update:model-value="emit('update:backgroundMode', $event)" @upload="emit('uploadBackground', $event)" @remove="emit('removeBackground')" />
        </section>
        <section class="settings-section" :aria-labelledby="dialogId + '-width'">
          <div class="settings-heading"><h3 :id="dialogId + '-width'">内容宽度</h3><span>{{ modelValue ? modelValue + ' px' : '自适应' }}</span></div>
          <div class="width-options" role="menu" aria-label="内容宽度">
            <button v-for="option in options" :key="option.value" type="button" role="menuitemradio" class="composer-menu-item" :aria-checked="modelValue === option.value" @click="emit('update:modelValue', option.value)"><span>{{ option.label }}</span><PhCheck v-if="modelValue === option.value" :size="16" /></button>
          </div>
          <label class="width-slider"><span>自定义宽度</span><input type="range" min="720" max="1600" step="40" :value="modelValue || 1080" aria-label="自定义内容宽度" @input="emit('update:modelValue', Number(($event.target as HTMLInputElement).value))" /></label>
        </section>
      </div>
    </BaseDialog>
  </Teleport>
</template>
<style scoped>
.display-settings-dialog { width: min(720px, calc(100vw - 32px)); max-height: min(860px, calc(100dvh - 32px)); overflow: hidden; border-radius: var(--radius-xl); background: var(--surface); }
.display-settings-dialog :deep(.dialog-inner) { display: flex; flex-direction: column; max-height: inherit; padding: 0; }
.display-settings-dialog :deep(.dialog-header) { flex-shrink: 0; align-items: center; margin: 0; padding: 20px 24px; border-bottom: 1px solid var(--line-soft); }
.display-settings-dialog :deep(.dialog-header h2) { font-size: 18px; letter-spacing: normal; }
.display-settings-dialog :deep(.dialog-header > .icon-button) { width: 44px; height: 44px; margin: -6px -10px -6px 0; }
.settings-body { min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 0 24px; }
.settings-section { min-width: 0; padding: 20px 0; }
.settings-section + .settings-section { border-top: 1px solid var(--line-soft); }
.settings-toggle-row { display: flex; align-items: center; justify-content: space-between; gap: 20px; min-height: 44px; }
.settings-toggle-row label { color: var(--ink); font-size: 14px; cursor: pointer; }
.settings-toggle-row p { margin: 4px 0 0; color: var(--muted); font-size: 12px; line-height: 1.6; }
.settings-switch { display: grid; place-items: center; position: relative; flex-shrink: 0; width: 44px; height: 44px; border-radius: var(--radius-sm); }
.settings-switch::before { content: ''; width: 38px; height: 22px; border-radius: var(--radius-round); background: var(--muted); transition: background-color 160ms var(--ease); }
.settings-switch > span { position: absolute; left: 6px; width: 16px; height: 16px; border-radius: var(--radius-round); background: var(--surface); transition: transform 160ms var(--ease); }
.settings-switch[aria-checked="true"]::before { background: var(--accent); }
.settings-switch[aria-checked="true"] > span { transform: translateX(16px); }
.settings-switch:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { .settings-switch::before, .settings-switch > span { transition: none; } }
.settings-heading, .settings-section :deep(.display-heading) { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0; margin: 0 0 12px; font-size: 14px; }
.settings-heading h3, .settings-section :deep(.display-heading strong) { margin: 0; font-size: 14px; font-weight: 600; }
.settings-heading > span, .settings-section :deep(.display-heading > span) { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
.theme-options, .width-options { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
.width-options { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.settings-section .composer-menu-item { min-height: 44px; gap: 8px; padding: 10px 12px; border-radius: var(--radius-sm); font-size: 13px; color: var(--ink-soft); }
.settings-section .composer-menu-item > span { flex: 1; }
.settings-section .composer-menu-item > svg { flex-shrink: 0; }
.settings-section .composer-menu-item[aria-checked="true"], .settings-section :deep(.background-option[aria-checked="true"]) { background: var(--hover); color: var(--ink); }
.width-slider { margin: 16px 0 0; gap: 6px; }
.width-slider input { min-height: 32px; margin: 0; }
.settings-section :deep(input:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
.settings-section :deep(.background-options) { margin: 0; gap: 6px; }
.settings-section :deep(.background-option) { flex-direction: row; min-height: 44px; gap: 8px; border-radius: var(--radius-sm); font-size: 13px; }
.settings-section :deep(.background-preview) { margin: 12px 0 0; }
.settings-section :deep(.background-upload) { min-height: 44px; margin: 4px 0 0; }
.settings-section :deep(.background-preview .text-button), .settings-section :deep(.background-reset) { min-height: 44px; }
.settings-section :deep(.background-note), .settings-section :deep(.background-error) { margin: 4px 0 0; font-size: 12px; }
.settings-section :deep(.background-adjustments) { grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 24px; margin: 12px 0 0; padding-top: 16px; }
.settings-section :deep(.background-reset) { grid-column: 1 / -1; }
.settings-section :deep(.background-color input) { height: 36px; }
@media (max-width: 560px) {
  .display-settings-dialog { width: calc(100vw - 24px); max-height: calc(100dvh - 24px); border-radius: var(--radius-lg); }
  .display-settings-dialog :deep(.dialog-header) { padding: 18px 16px; }
  .settings-body { padding: 0 16px; }
  .settings-section { padding: 18px 0; }
  .theme-options { grid-template-columns: 1fr; gap: 2px; }
  .width-options { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .settings-section :deep(.background-adjustments) { grid-template-columns: 1fr; }
}
</style>
