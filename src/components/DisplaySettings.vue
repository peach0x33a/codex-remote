<script setup lang="ts">
import ToggleSwitch from './ToggleSwitch.vue'
import { useStoredChoice, oneOf } from '../composables/useStoredChoice'
import { computed, nextTick, onUnmounted, ref, useId, watch } from 'vue'
import { PhTextAa, PhBell, PhTextAlignLeft, PhGearSix, PhPalette, PhCpu, PhShieldCheck, PhDatabase } from '@phosphor-icons/vue'
import type { BackgroundMode, ImageBackgroundSettings, ThemePreference } from '../lib/ui-preferences'
import BackgroundSettings from './BackgroundSettings.vue'
import BaseDialog from './BaseDialog.vue'
import CodexSettings from './CodexSettings.vue'
import NotificationSettings from './NotificationSettings.vue'
import type { TaskNotifications } from '../composables/useTaskNotifications'
import CustomSelect from './CustomSelect.vue'
import ValueSlider from './ValueSlider.vue'
import TypographySettings from './TypographySettings.vue'
import type { TypographyControls } from '../composables/useTypography'
import type { ConfigRequest } from '../lib/codex-config'
import type { Model } from '../../shared/protocol'
const props = defineProps<{ typography: TypographyControls; notifications: TaskNotifications; configRequest: ConfigRequest; models: Model[]; connected: boolean; deviceKey: string; deviceName?: string; modelValue: number; theme: ThemePreference; autoConnect: boolean; autoWrap: boolean; backgroundMode: BackgroundMode; imageBackground: ImageBackgroundSettings; backgroundUrl: string; backgroundName: string; backgroundBusy: boolean; backgroundError: string }>()
const emit = defineEmits<{ 'update:modelValue': [width: number]; 'update:theme': [theme: ThemePreference]; 'update:autoConnect': [enabled: boolean]; 'update:autoWrap': [enabled: boolean]; 'update:backgroundMode': [mode: BackgroundMode]; 'update:imageBackground': [value: ImageBackgroundSettings]; previewWidth: [value: number | null]; previewImageBackground: [value: ImageBackgroundSettings | null]; uploadBackground: [file: File]; removeBackground: [] }>()
const options = [{ value: 840, label: '紧凑' }, { value: 1080, label: '舒适' }, { value: 1280, label: '宽屏' }, { value: 0, label: '铺满窗口' }]
const widthOptions = computed(() => {
  const items = options.map(option => ({ value: String(option.value), label: option.label }))
  if (!options.some(option => option.value === props.modelValue)) items.push({ value: String(props.modelValue), label: '自定义' })
  return items
})
const themes: { value: ThemePreference; label: string }[] = [{ value: 'light', label: '浅色' }, { value: 'dark', label: '暗色' }, { value: 'system', label: '跟随系统' }]
const open = ref(false), trigger = ref<HTMLButtonElement>()
const dialogId = useId()
const settingsBody = ref<HTMLElement>()
let sectionAnimation: Animation | undefined
onUnmounted(() => sectionAnimation?.cancel())
const section = useStoredChoice<string>('codex-remote.settings-section.v1', 'general', oneOf(['general', 'appearance', 'typography', 'notifications', 'codex-model', 'codex-execution', 'codex-context'] as const)), codexVisited = ref(section.value.startsWith('codex-'))
function clearPreviews() { props.typography.clearPreview(); emit('previewWidth', null); emit('previewImageBackground', null); props.notifications.previewVolume(null) }
watch([open, section], clearPreviews)
onUnmounted(clearPreviews)
const codexSettings = ref<InstanceType<typeof CodexSettings>>()
const localPages = [{ id: 'general', label: '常规与内容', icon: PhGearSix }, { id: 'appearance', label: '外观与背景', icon: PhPalette }, { id: 'typography', label: '字体与字号', icon: PhTextAa }, { id: 'notifications', label: '通知与音效', icon: PhBell }]
const codexPages = [{ id: 'codex-model', label: '模型与回复', icon: PhCpu }, { id: 'codex-execution', label: '执行与权限', icon: PhShieldCheck }, { id: 'codex-context', label: '上下文', icon: PhDatabase }]
const codexSection = computed(() => section.value === 'codex-execution' ? '执行' : section.value === 'codex-context' ? '上下文' : '模型')
const codexTitle = computed(() => codexPages.find(page => page.id === section.value)?.label || '')
const onCodexPage = computed(() => section.value.startsWith('codex-'))
const confirmingDiscard = ref(false)
watch(section, async () => {
  await nextTick(); sectionAnimation?.cancel()
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !settingsBody.value?.animate) return
  sectionAnimation = settingsBody.value.animate([{ opacity: .55, transform: 'translateY(5px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 180, easing: 'cubic-bezier(.16,1,.3,1)' })
})
function selectSection(id: string) { section.value = id; if (id.startsWith('codex-')) codexVisited.value = true }
defineExpose({ show: () => { open.value = true } })
function requestClose() {
  if (codexSettings.value?.saving) return
  if (codexSettings.value?.dirty && !confirmingDiscard.value) { confirmingDiscard.value = true; return }
  void close()
}
function keepEditing() { confirmingDiscard.value = false; if (!onCodexPage.value) selectSection('codex-model') }
async function close() {
  confirmingDiscard.value = false
  open.value = false
  // BaseDialog closes its native dialog after its own nextTick.
  await nextTick(); await nextTick()
  if (!open.value) trigger.value?.focus()
}

</script>
<template>
  <button ref="trigger" type="button" class="text-button settings-entry" :class="{ 'is-open': open }" aria-label="设置" title="设置" aria-haspopup="dialog" :aria-expanded="open" :aria-controls="dialogId" @click="open = true" @keydown.down.prevent="open = true"><PhGearSix :size="18" /><span>设置</span></button>
  <Teleport to="body">
    <BaseDialog :id="dialogId" class="display-settings-dialog" :open="open" :dismissible="!codexSettings?.saving" title="设置" aria-label="设置" @close="requestClose">
      <div class="settings-layout">
        <nav class="settings-nav" aria-label="设置分类">
          <div class="settings-nav-group" role="group" aria-label="网页设置"><h3>网页设置</h3><button v-for="page in localPages" :key="page.id" type="button" :aria-current="section === page.id ? 'true' : undefined" @click="selectSection(page.id)"><component :is="page.icon" :size="18" /><span>{{ page.label }}</span></button></div>
          <div class="settings-nav-group" role="group" aria-label="Codex 设置"><h3>Codex 设置</h3><button v-for="page in codexPages" :key="page.id" type="button" :aria-current="section === page.id ? 'true' : undefined" @click="selectSection(page.id)"><component :is="page.icon" :size="18" /><span>{{ page.label }}</span></button></div>
        </nav>
        <div ref="settingsBody" class="settings-body">
        <TypographySettings v-show="section === 'typography'" :controls="typography" />
        <NotificationSettings v-show="section === 'notifications'" :notifications="notifications" />
        <CodexSettings v-if="open && codexVisited" ref="codexSettings" v-show="onCodexPage" :key="deviceKey" :section="codexSection" :title="codexTitle" :request="configRequest" :models="models" :connected="connected" :device-name="deviceName" />
        <section v-show="section === 'general'" class="settings-section" :aria-labelledby="dialogId + '-connection'">
          <div class="settings-heading"><h3 :id="dialogId + '-connection'">连接</h3></div>
          <div class="settings-toggle-row">
            <div><label :for="dialogId + '-auto-connect'">自动连接</label><p :id="dialogId + '-auto-connect-description'">打开页面时连接上次使用的设备</p></div>
            <ToggleSwitch :id="dialogId + '-auto-connect'" class="settings-switch" label="自动连接" :model-value="autoConnect" :aria-describedby="dialogId + '-auto-connect-description'" @update:model-value="emit('update:autoConnect', $event)" />
          </div>
        </section>
        <section v-show="section === 'appearance'" class="settings-section" :aria-labelledby="dialogId + '-appearance'">
          <div class="settings-heading width-setting"><h3 :id="dialogId + '-appearance'">外观</h3><CustomSelect label="颜色主题" :model-value="theme" :options="themes" @update:model-value="emit('update:theme', $event)" /></div>
        </section>
        <section v-show="section === 'appearance'" class="settings-section" aria-label="背景">
          <BackgroundSettings @preview-image-settings="emit('previewImageBackground', $event)" :model-value="backgroundMode" :image-settings="imageBackground" @update:image-settings="emit('update:imageBackground', $event)" :src="backgroundUrl" :name="backgroundName" :busy="backgroundBusy" :error="backgroundError" @update:model-value="emit('update:backgroundMode', $event)" @upload="emit('uploadBackground', $event)" @remove="emit('removeBackground')" />
        </section>
        <section v-show="section === 'general'" class="settings-section" :aria-labelledby="dialogId + '-width'">
          <div class="settings-heading width-setting"><h3 :id="dialogId + '-width'">内容宽度</h3>
            <CustomSelect label="内容宽度" :model-value="String(modelValue)" :options="widthOptions" @update:model-value="emit('update:modelValue', Number($event))" />
          </div>
          <ValueSlider @preview="emit('previewWidth', $event)" class="width-slider" label="自定义内容宽度" :min="720" :max="1600" :step="40" unit="px" :model-value="modelValue || 1080" @update:model-value="emit('update:modelValue', $event)" />
        </section>
        <section v-show="section === 'general'" class="settings-section" :aria-labelledby="dialogId + '-content'">
          <div class="settings-heading"><h3 :id="dialogId + '-content'">内容</h3></div>
          <div class="settings-toggle-row">
            <div><label :for="dialogId + '-auto-wrap'"><PhTextAlignLeft :size="16" />启用自动换行</label><p :id="dialogId + '-auto-wrap-description'">命令和工具输出按当前宽度折行显示</p></div>
            <ToggleSwitch :id="dialogId + '-auto-wrap'" class="settings-switch" label="启用自动换行" :model-value="autoWrap" :aria-describedby="dialogId + '-auto-wrap-description'" @update:model-value="emit('update:autoWrap', $event)" />
          </div>
        </section>
        </div>
      </div>
      <footer v-if="confirmingDiscard" class="settings-footer is-warning">
        <div class="settings-feedback" role="alert"><p>Codex 设置有未保存的更改，关闭后将丢失。</p></div>
        <div class="settings-footer-actions"><button type="button" class="button secondary" @click="close">放弃更改</button><button type="button" class="button primary" @click="keepEditing">继续编辑</button></div>
      </footer>
      <footer v-else-if="onCodexPage" class="settings-footer">
        <div class="settings-feedback">
          <p v-if="codexSettings?.error" class="settings-error" role="alert">{{ codexSettings.error }}</p>
          <p v-else-if="codexSettings?.notice" role="status">{{ codexSettings.notice }}</p>
          <p v-else-if="codexSettings?.dirty">有未保存的更改</p>
          <p v-else>保存到当前设备，新建会话时生效</p>
          <small v-if="codexSettings?.filePath" :title="codexSettings.filePath">{{ codexSettings.filePath }}</small>
        </div>
        <button type="button" class="button primary" :disabled="!codexSettings?.canSave" @click="codexSettings?.save()">{{ codexSettings?.saving ? '正在保存…' : '保存 Codex 设置' }}</button>
      </footer>
    </BaseDialog>
  </Teleport>
</template>
<style scoped>
.settings-entry { padding: 4px 8px; min-height: 36px; border-radius: var(--radius-sm); }
.settings-entry:hover, .settings-entry.is-open { background: var(--hover); color: var(--ink); }
.settings-entry:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.settings-footer { display: flex; flex-shrink: 0; align-items: center; justify-content: space-between; gap: 16px; padding: 16px 24px; border-top: 1px solid var(--line-soft); background: var(--surface); }
.settings-feedback { min-width: 0; font-size: calc(12px * var(--ui-font-scale, 1)); line-height: 1.6; color: var(--muted); }
.settings-feedback p { margin: 0; overflow-wrap: anywhere; }
.settings-feedback small { display: block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.settings-feedback .settings-error { color: var(--danger); }
.settings-footer > button, .settings-footer-actions { flex-shrink: 0; }
.settings-footer-actions { display: flex; gap: 8px; }
.settings-footer.is-warning .settings-feedback { color: var(--ink-soft); font-size: calc(13px * var(--ui-font-scale, 1)); }
.display-settings-dialog { width: min(1040px, calc(100vw - 32px)); height: min(760px, calc(100dvh - 32px)); max-height: calc(100dvh - 32px); overflow: hidden; border-radius: var(--radius-xl); background: var(--surface); }
.display-settings-dialog :deep(.dialog-inner) { display: flex; flex-direction: column; height: 100%; max-height: inherit; padding: 0; }
.display-settings-dialog :deep(.dialog-header) { flex-shrink: 0; align-items: center; margin: 0; padding: 20px 24px; border-bottom: 1px solid var(--line-soft); }
.display-settings-dialog :deep(.dialog-header h2) { font-size: calc(18px * var(--ui-font-scale, 1)); letter-spacing: normal; }
.display-settings-dialog :deep(.dialog-header > .icon-button) { width: 44px; height: 44px; margin: -6px -10px -6px 0; }
.settings-layout { display: flex; flex: 1; min-height: 0; }
.settings-nav { flex: 0 0 204px; padding: 20px 12px; border-right: 1px solid var(--line-soft); overflow-y: auto; background: var(--sidebar); }
.settings-nav-group + .settings-nav-group { margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--line-soft); }
.settings-nav-group h3 { margin: 0 10px 8px; font-size: calc(12px * var(--ui-font-scale, 1)); color: var(--muted); font-weight: 500; }
.settings-nav-group button { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 40px; padding: 8px 10px; border-radius: var(--radius-sm); text-align: left; color: var(--ink-soft); font-size: calc(14px * var(--ui-font-scale, 1)); transition: background-color 160ms var(--ease), color 160ms var(--ease); }
.settings-nav-group button:hover, .settings-nav-group button[aria-current="true"] { background: var(--hover); color: var(--ink); }
.settings-nav-group button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.settings-nav-group svg { flex-shrink: 0; }
.settings-body { flex: 1; min-width: 0; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 0 24px; }
.settings-section { min-width: 0; padding: 20px 0; }
.settings-section { border-bottom: 1px solid var(--line-soft); }
.settings-toggle-row { display: flex; align-items: center; justify-content: space-between; gap: 20px; min-height: 44px; }
.settings-toggle-row label { color: var(--ink); font-size: calc(14px * var(--ui-font-scale, 1)); cursor: pointer; }
.settings-toggle-row p { margin: 4px 0 0; color: var(--muted); font-size: calc(12px * var(--ui-font-scale, 1)); line-height: 1.6; }
@media (prefers-reduced-motion: reduce) { .settings-nav-group button { transition: none; } }
.settings-heading, .settings-section :deep(.display-heading) { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0; margin: 0 0 12px; font-size: calc(14px * var(--ui-font-scale, 1)); }
.settings-heading h3, .settings-section :deep(.display-heading strong) { margin: 0; font-size: calc(14px * var(--ui-font-scale, 1)); font-weight: 600; }
.settings-heading > span, .settings-section :deep(.display-heading > span) { color: var(--muted); font-size: calc(12px * var(--ui-font-scale, 1)); font-variant-numeric: tabular-nums; }
.width-setting :deep(.custom-select) { min-width: 0; max-width: 70%; }
.width-setting :deep(.custom-select-trigger) { max-width: 100%; gap: 8px; font-size: calc(13px * var(--ui-font-scale, 1)); }
.width-setting :deep(.custom-select-trigger > span) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.width-slider { margin: 16px 0 0; gap: 6px; }
.settings-section :deep(input:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
.settings-section :deep(.background-preview) { margin: 12px 0 0; }
.settings-section :deep(.background-upload) { min-height: 44px; margin: 4px 0 0; }
.settings-section :deep(.background-preview .text-button), .settings-section :deep(.background-reset) { min-height: 44px; }
.settings-section :deep(.background-note), .settings-section :deep(.background-error) { margin: 4px 0 0; font-size: calc(12px * var(--ui-font-scale, 1)); }
.settings-section :deep(.background-adjustments) { grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 24px; margin: 12px 0 0; padding-top: 16px; }
.settings-section :deep(.background-reset) { grid-column: 1 / -1; }
.settings-section :deep(.background-color input) { height: 36px; }
@media (max-width: 560px) {
  .settings-footer { padding: 12px; gap: 8px; }
  .settings-footer > button, .settings-footer-actions .button { padding-inline: 12px; }
  .display-settings-dialog { width: calc(100vw - 24px); max-height: calc(100dvh - 24px); border-radius: var(--radius-lg); }
  .display-settings-dialog :deep(.dialog-header) { padding: 18px 16px; }
  .settings-body { padding: 0 12px; }
  /* Stack the two navigation groups as scrollable rows so the content keeps the full width. */
  .settings-layout { flex-direction: column; }
  .settings-nav { flex: none; padding: 8px 12px; border-right: 0; border-bottom: 1px solid var(--line-soft); overflow: visible; }
  .settings-nav-group { display: flex; align-items: center; gap: 4px; overflow-x: auto; scrollbar-width: none; }
  .settings-nav-group + .settings-nav-group { margin-top: 4px; padding-top: 4px; }
  .settings-nav-group h3 { flex: 0 0 56px; margin: 0; }
  .settings-nav-group button { flex: 0 0 auto; width: auto; gap: 6px; min-height: 44px; padding: 8px 10px; font-size: calc(13px * var(--ui-font-scale, 1)); white-space: nowrap; }
  .settings-section { padding: 18px 0; }
  .settings-section :deep(.background-adjustments) { grid-template-columns: 1fr; }
}
</style>
